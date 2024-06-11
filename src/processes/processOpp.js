const ethers = require("ethers");
const { processTx, ProcessTxHaltReason } = require("./processTx");
const { DryrunHaltReason, dryrun, dryrunWithRetries } = require("./dryrun");

/**
 * Specifies the reason of an unsuccessfull attempt to find opp and clear
 */
const AttemptOppAndClearHaltReason = {
    NoOpportunity: 1,
    NoWalletFund: 2,
    NoRoute: 3,
    TxFailed: 4,
    TxMineFailed: 5,
    UnexpectedError: 6,
};

/**
 * Tries to find opportunities and submit them for orders of a token pair and returns the reports
 */
async function attemptOppAndClear({
    orderPairObject,
    dataFetcher,
    fromToken,
    toToken,
    signer,
    flashbotSigner,
    gasPrice,
    arb,
    orderbook,
    ethPrice,
    config,
    pair,
}) {
    const results = [];

    if (config.bundle) {
        const spanAttributes = {};
        const result = {
            order: orderPairObject.takeOrders.map(v => v.id),
            report: undefined,
            reason: undefined,
            error: undefined,
            spanAttributes,
        };
        try {
            let bundleVaultBalance = ethers.constants.Zero;
            for (v of orderPairObject.takeOrders) {
                bundleVaultBalance = bundleVaultBalance.add(v.vaultBalance);
            }
            const dryrunResult = await dryrun({
                mode: 0,
                orderPairObject,
                dataFetcher,
                fromToken,
                toToken,
                signer,
                vaultBalance: bundleVaultBalance,
                gasPrice,
                arb,
                ethPrice,
                config,
            });
            for (attrKey in dryrunResult.spanAttributes) {
                spanAttributes[attrKey] = dryrunResult.spanAttributes[attrKey];
            }
            try {
                const processTxResult = await processTx({
                    orderPairObject,
                    signer,
                    flashbotSigner,
                    arb,
                    orderbook,
                    ethPrice,
                    config,
                    dryrunData: dryrunResult.data,
                    pair,
                });
                for (attrKey in processTxResult.spanAttributes) {
                    spanAttributes[attrKey] = processTxResult.spanAttributes[attrKey];
                }
                result.report = processTxResult.report;
            } catch(e) {
                result.report = e.report;
                for (attrKey in e.spanAttributes) {
                    spanAttributes[attrKey] = e.spanAttributes[attrKey];
                }
                if (e.error) result.error = e.error;
                if (e.reason === ProcessTxHaltReason.TxFailed) {
                    result.reason = AttemptOppAndClearHaltReason.TxFailed;
                } else if (e.reason === ProcessTxHaltReason.TxMineFailed) {
                    result.reason = AttemptOppAndClearHaltReason.TxMineFailed;
                } else {
                    result.reason = AttemptOppAndClearHaltReason.UnexpectedError;
                }
            }
        } catch(e) {
            if (e.reason === DryrunHaltReason.NoWalletFund) {
                result.reason = AttemptOppAndClearHaltReason.NoWalletFund;
            } else if (e.reason === DryrunHaltReason.NoRoute) {
                result.reason = AttemptOppAndClearHaltReason.NoRoute;
            } else if (e.reason === DryrunHaltReason.NoOpportunity) {
                // record all span attributes in case of no opp
                for (attrKey in e.spanAttributes) {
                    spanAttributes[attrKey] = e.spanAttributes[attrKey];
                }
                result.reason = AttemptOppAndClearHaltReason.NoOpportunity;
            } else {
                // record all span attributes in case of unexpected error
                for (attrKey in e.spanAttributes) {
                    spanAttributes[attrKey] = e.spanAttributes[attrKey];
                }
                result.reason = AttemptOppAndClearHaltReason.UnexpectedError;
            }
        }
        results.push(result);
    } else {
        const concurrencyLimit = config.concurrency === "max"
            ? orderPairObject.takeOrders.length
            : config.concurrency;

        // process orders async in batch set by concurrency limit, until run out of orders to process
        const orderPairObjectCopy = JSON.parse(JSON.stringify(orderPairObject));
        while (orderPairObjectCopy.takeOrders.length) {
            const batch = orderPairObjectCopy.takeOrders.splice(0, concurrencyLimit);
            const orders = [];
            const promises = [];
            for (let i = 0; i < batch.length; i++) {
                const order = {
                    buyToken: orderPairObject.buyToken,
                    buyTokenSymbol: orderPairObject.buyTokenSymbol,
                    buyTokenDecimals: orderPairObject.buyTokenDecimals,
                    sellToken: orderPairObject.sellToken,
                    sellTokenSymbol: orderPairObject.sellTokenSymbol,
                    sellTokenDecimals: orderPairObject.sellTokenDecimals,
                    takeOrders: [batch[i]]
                };
                orders.push(order);
                promises.push(
                    dryrunWithRetries({
                        orderPairObject: order,
                        dataFetcher,
                        fromToken,
                        toToken,
                        signer,
                        gasPrice,
                        arb,
                        ethPrice,
                        config,
                    })
                );
            }
            const dryrunResults = await Promise.allSettled(promises);
            for (let i = 0; i < dryrunResults.length; i++) {
                const spanAttributes = {};
                const result = {
                    order: batch[i].id,
                    report: undefined,
                    reason: undefined,
                    error: undefined,
                    spanAttributes,
                };
                if (dryrunResults[i].status === "fulfilled") {
                    for (attrKey in dryrunResults[i].value.spanAttributes) {
                        spanAttributes[attrKey] = dryrunResults[i].value.spanAttributes[attrKey];
                    }
                    try {
                        const processTxResult = await processTx({
                            orderPairObject: orders[i],
                            signer,
                            flashbotSigner,
                            arb,
                            orderbook,
                            ethPrice,
                            config,
                            dryrunData: dryrunResults[i].value.data,
                            pair,
                        });
                        for (attrKey in processTxResult.spanAttributes) {
                            spanAttributes[attrKey] = processTxResult.spanAttributes[attrKey];
                        }
                        result.report = processTxResult.report;
                    } catch(e) {
                        result.report = e.report;
                        for (attrKey in e.spanAttributes) {
                            spanAttributes[attrKey] = e.spanAttributes[attrKey];
                        }
                        if (e.error) result.error = e.error;
                        if (e.reason === ProcessTxHaltReason.TxFailed) {
                            result.reason = AttemptOppAndClearHaltReason.TxFailed;
                        } else if (e.reason === ProcessTxHaltReason.TxMineFailed) {
                            result.reason = AttemptOppAndClearHaltReason.TxMineFailed;
                        } else {
                            result.reason = AttemptOppAndClearHaltReason.UnexpectedError;
                        }
                    }
                } else {
                    if (dryrunResults[i].reason.reason === DryrunHaltReason.NoWalletFund) {
                        result.reason = AttemptOppAndClearHaltReason.NoWalletFund;
                    } else if (dryrunResults[i].reason.reason === DryrunHaltReason.NoRoute) {
                        result.reason = AttemptOppAndClearHaltReason.NoRoute;
                    } else if (dryrunResults[i].reason.reason === DryrunHaltReason.NoOpportunity) {
                        // record all span attributes in case of no opp
                        for (attrKey in dryrunResults[i].reason.spanAttributes) {
                            spanAttributes[
                                attrKey
                            ] = dryrunResults[i].reason.spanAttributes[attrKey];
                        }
                        result.reason = AttemptOppAndClearHaltReason.NoOpportunity;
                    } else {
                        // record all span attributes in case of no opp
                        for (attrKey in dryrunResults[i].reason.spanAttributes) {
                            spanAttributes[
                                attrKey
                            ] = dryrunResults[i].reason.spanAttributes[attrKey];
                        }
                        result.reason = AttemptOppAndClearHaltReason.UnexpectedError;
                    }
                }
                results.push(result);
            }
        }
    }
    return results;
}

module.exports = {
    attemptOppAndClear,
    AttemptOppAndClearHaltReason,
};