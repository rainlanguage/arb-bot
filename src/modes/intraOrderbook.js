const ethers = require("ethers");
const { orderbookAbi, erc20Abi } = require("../abis");
const { getWithdrawEnsureBytecode } = require("../config");
const { getSpanException, estimateProfit } = require("../utils");

/**
 * Specifies the reason that dryrun failed
 */
const IntraOrderbookDryrunHaltReason = {
    NoOpportunity: 1,
    NoWalletFund: 2,
};

/**
 * Executes a extimateGas call for an intra-orderbook tx (clear2()), to determine if the tx is successfull ot not
 */
async function dryrun({
    orderPairObject,
    opposingOrder,
    signer,
    gasPrice,
    inputToEthPrice,
    outputToEthPrice,
    config,
    viemClient,
    inputBalance,
    outputBalance,
}) {
    const spanAttributes = {};
    const result = {
        value: undefined,
        reason: undefined,
        spanAttributes,
    };

    const inputBountyVaultId = "1";
    const outputBountyVaultId = "1";
    const obInterface = new ethers.utils.Interface(orderbookAbi);
    const withdrawInputCalldata = obInterface.encodeFunctionData(
        "withdraw2",
        [
            orderPairObject.buyToken,
            inputBountyVaultId,
            ethers.constants.MaxUint256,
            []
        ]
    );
    let withdrawOutputCalldata = obInterface.encodeFunctionData(
        "withdraw2",
        [
            orderPairObject.sellToken,
            outputBountyVaultId,
            ethers.constants.MaxUint256,
            []
        ]
    );
    const clear2Calldata = obInterface.encodeFunctionData(
        "clear2",
        [
            orderPairObject.takeOrders[0].takeOrder.order,
            opposingOrder.takeOrder.order,
            {
                aliceInputIOIndex: orderPairObject.takeOrders[0].takeOrder.inputIOIndex,
                aliceOutputIOIndex: orderPairObject.takeOrders[0].takeOrder.outputIOIndex,
                bobInputIOIndex: opposingOrder.takeOrder.inputIOIndex,
                bobOutputIOIndex: opposingOrder.takeOrder.outputIOIndex,
                aliceBountyVaultId: inputBountyVaultId,
                bobBountyVaultId: outputBountyVaultId,
            },
            [],
            []
        ]
    );
    const rawtx = {
        data: obInterface.encodeFunctionData(
            "multicall",
            [[clear2Calldata, withdrawInputCalldata, withdrawOutputCalldata]]
        ),
        to: orderPairObject.orderbook,
        gasPrice
    };

    // trying to find opp with doing gas estimation, once to get gas and calculate
    // minimum sender output and second time to check the clear2() with withdraw2() and headroom
    let gasLimit, blockNumber;
    try {
        blockNumber = Number(await viemClient.getBlockNumber());
        spanAttributes["blockNumber"] = blockNumber;
        gasLimit = await signer.estimateGas(rawtx);
    }
    catch(e) {
        // reason, code, method, transaction, error, stack, message
        const spanError = getSpanException(e);
        const errorString = JSON.stringify(spanError);
        spanAttributes["error"] = spanError;

        // check for no wallet fund
        if (
            (e.code && e.code === ethers.errors.INSUFFICIENT_FUNDS)
            || errorString.includes("gas required exceeds allowance")
            || errorString.includes("insufficient funds for gas")
        ) {
            result.reason = IntraOrderbookDryrunHaltReason.NoWalletFund;
            spanAttributes["currentWalletBalance"] = signer.BALANCE.toString();
        } else {
            result.reason = IntraOrderbookDryrunHaltReason.NoOpportunity;
        }
        return Promise.reject(result);
    }
    gasLimit = gasLimit.mul("107").div("100");
    rawtx.gasLimit = gasLimit;
    const gasCost = gasLimit.mul(gasPrice);

    // repeat the same process with heaedroom if gas
    // coverage is not 0, 0 gas coverage means 0 minimum
    // sender output which is already called above
    if (config.gasCoveragePercentage !== "0") {
        const headroom = (
            Number(config.gasCoveragePercentage) * 1.05
        ).toFixed();
        const task = {
            evaluable: {
                interpreter: orderPairObject.takeOrders[0].takeOrder.order.evaluable.interpreter,
                store: orderPairObject.takeOrders[0].takeOrder.order.evaluable.store,
                bytecode: getWithdrawEnsureBytecode(
                    signer.address,
                    orderPairObject.buyToken,
                    orderPairObject.sellToken,
                    inputBalance,
                    outputBalance,
                    ethers.utils.parseUnits(inputToEthPrice),
                    ethers.utils.parseUnits(outputToEthPrice),
                    gasCost.mul(headroom).div("100"),
                )
            },
            signedContext: []
        };
        withdrawOutputCalldata = obInterface.encodeFunctionData(
            "withdraw2",
            [
                orderPairObject.sellToken,
                outputBountyVaultId,
                ethers.constants.MaxUint256,
                [task]
            ]
        );
        rawtx.data = obInterface.encodeFunctionData(
            "multicall",
            [[clear2Calldata, withdrawInputCalldata, withdrawOutputCalldata]]
        );

        try {
            blockNumber = Number(await viemClient.getBlockNumber());
            spanAttributes["blockNumber"] = blockNumber;
            await signer.estimateGas(rawtx);
            task.evaluable.bytecode = getWithdrawEnsureBytecode(
                signer.address,
                orderPairObject.buyToken,
                orderPairObject.sellToken,
                inputBalance,
                outputBalance,
                ethers.utils.parseUnits(inputToEthPrice),
                ethers.utils.parseUnits(outputToEthPrice),
                gasCost.mul(config.gasCoveragePercentage).div("100"),
            );
            withdrawOutputCalldata = obInterface.encodeFunctionData(
                "withdraw2",
                [
                    orderPairObject.sellToken,
                    outputBountyVaultId,
                    ethers.constants.MaxUint256,
                    [task]
                ]
            );
            rawtx.data = obInterface.encodeFunctionData(
                "multicall",
                [[clear2Calldata, withdrawInputCalldata, withdrawOutputCalldata]]
            );
        }
        catch(e) {
            const spanError = getSpanException(e);
            const errorString = JSON.stringify(spanError);
            spanAttributes["error"] = spanError;

            // check for no wallet fund
            if (
                (e.code && e.code === ethers.errors.INSUFFICIENT_FUNDS)
                || errorString.includes("gas required exceeds allowance")
                || errorString.includes("insufficient funds for gas")
            ) {
                result.reason = IntraOrderbookDryrunHaltReason.NoWalletFund;
                spanAttributes["currentWalletBalance"] = signer.BALANCE.toString();
            } else {
                result.reason = IntraOrderbookDryrunHaltReason.NoOpportunity;
            }
            return Promise.reject(result);
        }
    }

    // if reached here, it means there was a success and found opp
    spanAttributes["oppBlockNumber"] = blockNumber;
    spanAttributes["foundOpp"] = true;
    delete spanAttributes["blockNumber"];
    result.value = {
        rawtx,
        oppBlockNumber: blockNumber,
        estimatedProfit: estimateProfit(
            orderPairObject,
            ethers.utils.parseUnits(inputToEthPrice),
            ethers.utils.parseUnits(outputToEthPrice),
            opposingOrder,
        )
    };
    return result;
}

/**
 * Tries to find an opp from the same orderbook's opposing orders
 */
async function findOpp({
    orderPairObject,
    signer,
    gasPrice,
    inputToEthPrice,
    outputToEthPrice,
    config,
    viemClient,
    orderbooksOrders,
}) {
    const spanAttributes = {};
    const result = {
        value: undefined,
        reason: undefined,
        spanAttributes,
    };

    const ONE = ethers.utils.parseUnits("1");
    const opposingOrders = orderbooksOrders
        .map(v => {
            if (v[0].orderbook === orderPairObject.orderbook) {
                return v.find(e =>
                    e.buyToken === orderPairObject.sellToken &&
                    e.sellToken === orderPairObject.buyToken
                );
            } else {
                return undefined;
            }
        })
        .find(v => v !== undefined)?.takeOrders
        .filter(v =>
            // not same order
            v.id !== orderPairObject.takeOrders[0].id &&
            // only orders that (priceA x priceB < 1) can be profitbale
            v.quote.ratio.mul(orderPairObject.takeOrders[0].quote.ratio).div(ONE).lt(ONE)
        );

    if (!opposingOrders) throw undefined;

    const allErrorAttributes = [];
    const erc20 = new ethers.utils.Interface(erc20Abi);
    const inputBalance = ethers.BigNumber.from((await viemClient.call({
        to: orderPairObject.buyToken,
        data: erc20.encodeFunctionData("balanceOf", [signer.address])
    })).data);
    const outputBalance = ethers.BigNumber.from((await viemClient.call({
        to: orderPairObject.sellToken,
        data: erc20.encodeFunctionData("balanceOf", [signer.address])
    })).data);
    for (let i = 0; i < opposingOrders.length; i++) {
        try {
            return await dryrun({
                orderPairObject,
                opposingOrder: opposingOrders[i],
                signer,
                gasPrice,
                inputToEthPrice,
                outputToEthPrice,
                config,
                viemClient,
                inputBalance,
                outputBalance,
            });
        } catch(e) {
            if (e.reason === IntraOrderbookDryrunHaltReason.NoWalletFund) {
                result.reason = IntraOrderbookDryrunHaltReason.NoWalletFund;
                spanAttributes["currentWalletBalance"] = e.spanAttributes["currentWalletBalance"];
                return Promise.reject(result);
            } else {
                allErrorAttributes.push(JSON.stringify(e.spanAttributes));
            }
        }
    }
    result.reason = IntraOrderbookDryrunHaltReason.NoOpportunity;
    spanAttributes["intraOrderbook"] = allErrorAttributes;
    return Promise.reject(result);
}

module.exports = {
    dryrun,
    findOpp,
    IntraOrderbookDryrunHaltReason,
};