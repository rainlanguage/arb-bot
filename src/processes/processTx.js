const ethers = require("ethers");
const {
    getIncome,
    promiseTimeout,
    getSpanException,
    getActualClearAmount,
} = require("../utils");

/**
 * Specifies halt reasons for processing the transaction
 */
const ProcessTxHaltReason = {
    TxFailed: 1,
    TxMineFailed: 2,
};

/**
 * Processes a found opportunity into an arb transaction
 */
async function processTx({
    orderPairObject,
    signer,
    flashbotSigner,
    arb,
    orderbook,
    ethPrice,
    config,
    dryrunData,
    pair,
}) {
    const spanAttributes = {};
    const result = {
        reason: undefined,
        error: undefined,
        spanAttributes,
        report: {
            tokenPair: pair,
            buyToken: orderPairObject.buyToken,
            sellToken: orderPairObject.sellToken,
        },
    };

    const {
        rawtx,
        gasCostInToken,
        takeOrdersConfigStruct,
        price,
        routeVisual,
        maximumInput,
        oppBlockNumber,
    } = dryrunData;

    // get block number
    let blockNumber;
    try {
        blockNumber = await signer.provider.getBlockNumber();
        spanAttributes["clearBlockNumber"] = blockNumber;
        // record opp/clear block difference
        spanAttributes["blockDiff"] = blockNumber - oppBlockNumber;
    } catch(e) {
        // dont reject if getting block number fails but just record it,
        // since an opp is found and can ultimately be cleared
        spanAttributes["blockNumberError"] = JSON.stringify(getSpanException(e));
    }

    // submit the tx
    let tx, txUrl;
    try {
        spanAttributes["route"] = routeVisual;
        spanAttributes["maxInput"] = maximumInput.toString();
        spanAttributes["marketPrice"] = ethers.utils.formatEther(price);
        spanAttributes["estimatedGasCostInToken"] = ethers.utils.formatUnits(
            gasCostInToken,
            orderPairObject.buyTokenDecimals
        );

        rawtx.data = arb.interface.encodeFunctionData(
            "arb",
            [
                takeOrdersConfigStruct,
                gasCostInToken.mul(config.gasCoveragePercentage).div("100")
            ]
        );

        tx = config.timeout
            ? await promiseTimeout(
                (flashbotSigner !== undefined
                    ? flashbotSigner.sendTransaction(rawtx)
                    : signer.sendTransaction(rawtx)),
                config.timeout,
                `Transaction failed to get submitted after ${config.timeout}ms`
            )
            : flashbotSigner !== undefined
                ? await flashbotSigner.sendTransaction(rawtx)
                : await signer.sendTransaction(rawtx);

        txUrl = config.chain.blockExplorers.default.url + "/tx/" + tx.hash;
        console.log("\x1b[33m%s\x1b[0m", txUrl, "\n");
        result.report.txUrl = txUrl;
        spanAttributes["txUrl"] = txUrl;
        spanAttributes["tx"] = JSON.stringify(tx);
    } catch(e) {
        // record rawtx in case it is not already present in the error
        if (!JSON.stringify(e).includes(rawtx.data)) spanAttributes[
            "rawTx"
        ] = JSON.stringify(rawtx);
        result.error = e;
        result.reason = ProcessTxHaltReason.TxFailed;
        throw result;
    }

    // wait for tx receipt
    try {
        const receipt = config.timeout
            ? await promiseTimeout(
                tx.wait(),
                config.timeout,
                `Transaction failed to mine after ${config.timeout}ms`
            )
            : await tx.wait();

        if (receipt.status === 1) {
            const clearActualAmount = getActualClearAmount(
                arb.address,
                orderbook.address,
                receipt
            );
            const income = getIncome(await signer.getAddress(), receipt);
            const actualGasCost = ethers.BigNumber.from(
                receipt.effectiveGasPrice
            ).mul(receipt.gasUsed);
            const actualGasCostInToken = ethers.utils.parseUnits(
                ethPrice
            ).mul(
                actualGasCost
            ).div(
                "1" + "0".repeat(
                    36 - orderPairObject.buyTokenDecimals
                )
            );
            const netProfit = income
                ? income.sub(actualGasCostInToken)
                : undefined;

            if (income) {
                spanAttributes["income"] = ethers.utils.formatUnits(
                    income,
                    orderPairObject.buyTokenDecimals
                );
                spanAttributes["netProfit"] = ethers.utils.formatUnits(
                    netProfit,
                    orderPairObject.buyTokenDecimals
                );
            }
            spanAttributes["gasCost"] = ethers.utils.formatUnits(actualGasCost);
            spanAttributes["gasCostInToken"] = ethers.utils.formatUnits(
                actualGasCostInToken,
                orderPairObject.buyTokenDecimals
            );
            result.report = {
                txUrl,
                tokenPair: pair,
                buyToken: orderPairObject.buyToken,
                sellToken: orderPairObject.sellToken,
                clearedAmount: clearActualAmount?.toString(),
                actualGasCost: ethers.utils.formatUnits(actualGasCost),
                actualGasCostInToken: ethers.utils.formatUnits(
                    actualGasCostInToken,
                    orderPairObject.buyTokenDecimals
                ),
                income,
                netProfit,
                clearedOrders: orderPairObject.takeOrders.map(
                    v => v.id
                ),
            };
            return result;
        }
        else {
            spanAttributes["receipt"] = JSON.stringify(receipt);
            result.reason = ProcessTxHaltReason.TxMineFailed;
            return Promise.reject(result);
        }
    } catch(e) {
        result.error = e;
        result.reason = ProcessTxHaltReason.TxMineFailed;
        throw result;
    }
}

module.exports = {
    processTx,
    ProcessTxHaltReason,
};