const ethers = require("ethers");
const { findOpp } = require("./modes");
const { Token } = require("sushi/currency");
const { rotateAccounts } = require("./account");
const { arbAbis, orderbookAbi } = require("./abis");
const { SpanStatusCode } = require("@opentelemetry/api");
const {
    getIncome,
    getEthPrice,
    quoteOrders,
    bundleOrders,
    PoolBlackList,
    promiseTimeout,
    getTotalIncome,
    getSpanException,
    getActualClearAmount,
    quoteSingleOrder,
} = require("./utils");

/**
 * Specifies reason that order process halted
 */
const ProcessPairHaltReason = {
    NoWalletFund: 1,
    FailedToQuote: 2,
    FailedToGetGasPrice: 3,
    FailedToGetEthPrice: 4,
    FailedToGetPools: 5,
    TxFailed: 6,
    TxMineFailed: 7,
    UnexpectedError: 8,
};

/**
 * Specifies status of an processed order report
 */
const ProcessPairReportStatus = {
    ZeroOutput: 1,
    NoOpportunity: 2,
    FoundOpportunity: 3,
};

/**
 * Main function that processes all given orders and tries clearing them against onchain liquidity and reports the result
 *
 * @param {object} config - The configuration object
 * @param {any[]} ordersDetails - The order details queried from subgraph
 * @param {import("@opentelemetry/sdk-trace-base").Tracer} tracer
 * @param {import("@opentelemetry/api").Context} ctx
 */
const processOrders = async(
    config,
    ordersDetails,
    tracer,
    ctx,
) => {
    const viemClient = config.viemClient;
    const dataFetcher = config.dataFetcher;
    const accounts = config.accounts;
    const mainAccount = config.mainAccount;

    // instantiating arb contract
    const arb = new ethers.Contract(config.arbAddress, arbAbis);
    let genericArb;
    if (config.genericArbAddress) {
        genericArb = new ethers.Contract(config.genericArbAddress, arbAbis);
    }

    // prepare orders
    const bundledOrders = bundleOrders(
        ordersDetails,
        config.shuffle,
        true,
    );
    await quoteOrders(
        bundledOrders,
        config.isTest ? config.quoteRpc : config.rpc
    );
    if (!bundledOrders.length) return;

    let avgGasCost;
    const reports = [];
    const fetchedPairPools = [];
    for (const orderbookOrders of bundledOrders) {
        // instantiating orderbook contract
        const orderbook = new ethers.Contract(orderbookOrders[0].orderbook, orderbookAbi);

        for (const pairOrders of orderbookOrders) {
            for (let i = 0; i < pairOrders.takeOrders.length; i++) {
                const orderPairObject = {
                    orderbook: pairOrders.orderbook,
                    buyToken: pairOrders.buyToken,
                    buyTokenSymbol: pairOrders.buyToken,
                    buyTokenDecimals: pairOrders.buyTokenDecimals,
                    sellToken: pairOrders.sellToken,
                    sellTokenSymbol: pairOrders.sellTokenSymbol,
                    sellTokenDecimals: pairOrders.sellTokenDecimals,
                    takeOrders: [pairOrders.takeOrders[i]]
                };
                const signer = accounts.length ? accounts[0] : mainAccount;
                const flashbotSigner = config.flashbotRpc
                    ? new ethers.Wallet(
                        signer.privateKey,
                        new ethers.providers.JsonRpcProvider(config.flashbotRpc)
                    )
                    : undefined;

                const pair = `${pairOrders.buyTokenSymbol}/${pairOrders.sellTokenSymbol}`;

                // instantiate a span for this pair
                const span = tracer.startSpan(`order_${pair}`, undefined, ctx);

                // process the pair
                try {
                    const result = await processPair({
                        config,
                        orderPairObject,
                        viemClient,
                        dataFetcher,
                        signer,
                        flashbotSigner,
                        arb,
                        genericArb,
                        orderbook,
                        pair,
                        mainAccount,
                        accounts,
                        fetchedPairPools,
                        orderbooksOrders: bundledOrders
                    });

                    // keep track of avggas cost
                    if (result.gasCost) {
                        if (!avgGasCost) {
                            avgGasCost = result.gasCost;
                        } else {
                            avgGasCost = avgGasCost.add(result.gasCost).div(2);
                        }
                    }

                    reports.push(result.report);

                    // set the span attributes with the values gathered at processPair()
                    span.setAttributes(result.spanAttributes);

                    // set the otel span status based on report status
                    if (result.report.status === ProcessPairReportStatus.ZeroOutput) {
                        span.setStatus({ code: SpanStatusCode.OK, message: "zero max output" });
                    } else if (result.report.status === ProcessPairReportStatus.NoOpportunity) {
                        span.setStatus({ code: SpanStatusCode.OK, message: "no opportunity" });
                    } else if (result.report.status === ProcessPairReportStatus.FoundOpportunity) {
                        span.setStatus({ code: SpanStatusCode.OK, message: "found opportunity" });
                    } else {
                        // set the span status to unexpected error
                        span.setStatus({ code: SpanStatusCode.ERROR, message: "unexpected error" });
                    }
                } catch(e) {

                    // keep track of avggas cost
                    if (e.gasCost) {
                        if (!avgGasCost) {
                            avgGasCost = e.gasCost;
                        } else {
                            avgGasCost = avgGasCost.add(e.gasCost).div(2);
                        }
                    }

                    // set the span attributes with the values gathered at processPair()
                    span.setAttributes(e.spanAttributes);

                    // record otel span status based on reported reason
                    if (e.reason) {
                        // report the error reason along with the rest of report
                        reports.push({
                            ...e.report,
                            error: e.error,
                            reason: e.reason,
                        });

                        // set the otel span status based on returned reason
                        if (e.reason === ProcessPairHaltReason.NoWalletFund) {
                            // in case that wallet has no more funds, terminate the process by breaking the loop
                            if (e.error) span.recordException(getSpanException(e.error));
                            const message = `Recieved insufficient funds error, current balance: ${
                                e.spanAttributes["details.currentWalletBalance"]
                                    ? ethers.utils.formatUnits(
                                        ethers.BigNumber.from(
                                            e.spanAttributes["details.currentWalletBalance"]
                                        )
                                    )
                                    : "failed to get balance"
                            }`;
                            span.setStatus({ code: SpanStatusCode.ERROR, message });
                            span.end();
                            throw message;
                        } else if (e.reason === ProcessPairHaltReason.FailedToQuote) {
                            if (e.error) {
                                span.recordException(getSpanException(e.error));
                            }
                            span.setStatus({ code: SpanStatusCode.ERROR, message: e.error ?? "failed to quote order" });
                        } else if (e.reason === ProcessPairHaltReason.FailedToGetGasPrice) {
                            if (e.error) span.recordException(getSpanException(e.error));
                            span.setStatus({ code: SpanStatusCode.ERROR, message: pair + ": failed to get gas price" });
                        } else if (e.reason === ProcessPairHaltReason.FailedToGetPools) {
                            if (e.error) span.recordException(getSpanException(e.error));
                            span.setStatus({ code: SpanStatusCode.ERROR, message: pair + ": failed to get pool details" });
                        } else if (e.reason === ProcessPairHaltReason.FailedToGetEthPrice) {
                            // set OK status because a token might not have a pool and as a result eth price cannot
                            // be fetched for it and if it is set to ERROR it will constantly error on each round
                            // resulting in lots of false positives
                            if (e.error) span.setAttribute("errorDetails", JSON.stringify(getSpanException(e.error)));
                            span.setStatus({ code: SpanStatusCode.OK, message: "failed to get eth price" });
                        } else {
                            // set the otel span status as OK as an unsuccessfull clear, this can happen for example
                            // because of mev front running or false positive opportunities, etc
                            if (e.error) span.setAttribute("errorDetails", JSON.stringify(getSpanException(e.error)));
                            span.setStatus({ code: SpanStatusCode.OK });
                            span.setAttribute("unsuccessfullClear", true);
                        }
                    } else {
                        // record the error for the span
                        if (e.error) span.recordException(getSpanException(e.error));

                        // report the unexpected error reason
                        reports.push({
                            ...e.report,
                            error: e.error,
                            reason: ProcessPairHaltReason.UnexpectedError,
                        });
                        // set the span status to unexpected error
                        span.setStatus({ code: SpanStatusCode.ERROR, message: pair + ": unexpected error" });
                    }
                }
                span.end();

                // rotate the accounts once they are used once
                rotateAccounts(accounts);
            }
        }
    }
    return { reports, avgGasCost };
};

/**
 * Processes an pair order by trying to clear it against an onchain liquidity and reporting the result
 */
async function processPair(args) {
    const {
        config,
        orderPairObject,
        viemClient,
        dataFetcher,
        signer,
        flashbotSigner,
        arb,
        genericArb,
        orderbook,
        pair,
        fetchedPairPools,
        orderbooksOrders,
    } = args;

    const spanAttributes = {};
    const result = {
        reason: undefined,
        error: undefined,
        report: undefined,
        gasCost: undefined,
        spanAttributes,
    };

    spanAttributes["details.orders"] = orderPairObject.takeOrders.map(v => v.id);
    spanAttributes["details.pair"] = pair;

    const fromToken = new Token({
        chainId: config.chain.id,
        decimals: orderPairObject.sellTokenDecimals,
        address: orderPairObject.sellToken,
        symbol: orderPairObject.sellTokenSymbol
    });
    const toToken = new Token({
        chainId: config.chain.id,
        decimals: orderPairObject.buyTokenDecimals,
        address: orderPairObject.buyToken,
        symbol: orderPairObject.buyTokenSymbol
    });

    try {
        await quoteSingleOrder(
            orderPairObject,
            config.isTest ? config.quoteRpc : config.rpc
        );
        if (orderPairObject.takeOrders[0].quote.maxOutput.isZero()) {
            result.report = {
                status: ProcessPairReportStatus.ZeroOutput,
                tokenPair: pair,
                buyToken: orderPairObject.buyToken,
                sellToken: orderPairObject.sellToken,
            };
            return result;
        }
    } catch(e) {
        result.error = e;
        result.reason = ProcessPairHaltReason.FailedToQuote;
        throw result;
    }

    // get gas price
    let gasPrice;
    try {
        const gasPriceBigInt = await viemClient.getGasPrice();
        gasPrice = ethers.BigNumber.from(gasPriceBigInt);
        spanAttributes["details.gasPrice"] = gasPrice.toString();
    } catch(e) {
        result.reason = ProcessPairHaltReason.FailedToGetGasPrice;
        result.error = e;
        throw result;
    }

    // get pool details
    if (!fetchedPairPools.includes(pair)) {
        try {
            const options = {
                fetchPoolsTimeout: 90000,
                memoize: true,
            };
            // pin block number for test case
            if (config.isTest && config.testBlockNumber) {
                options.blockNumber = config.testBlockNumber;
            }
            await dataFetcher.fetchPoolsForToken(
                fromToken,
                toToken,
                PoolBlackList,
                options
            );
            fetchedPairPools.push(
                `${orderPairObject.buyTokenSymbol}/${orderPairObject.sellTokenSymbol}`
            );
            fetchedPairPools.push(
                `${orderPairObject.sellTokenSymbol}/${orderPairObject.buyTokenSymbol}`
            );
        } catch(e) {
            result.reason = ProcessPairHaltReason.FailedToGetPools;
            result.error = e;
            throw result;
        }
    }

    // get in/out tokens to eth price
    let inputToEthPrice, outputToEthPrice;
    try {
        const options = {
            fetchPoolsTimeout: 30000,
            memoize: true,
        };
        // pin block number for test case
        if (config.isTest && config.testBlockNumber) {
            options.blockNumber = config.testBlockNumber;
        }
        inputToEthPrice = await getEthPrice(
            config,
            orderPairObject.buyToken,
            orderPairObject.buyTokenDecimals,
            gasPrice,
            dataFetcher,
            options,
            false,
        );
        outputToEthPrice = await getEthPrice(
            config,
            orderPairObject.sellToken,
            orderPairObject.sellTokenDecimals,
            gasPrice,
            dataFetcher,
            options,
            false,
        );
        if (!inputToEthPrice || !outputToEthPrice) {
            result.reason = ProcessPairHaltReason.FailedToGetEthPrice;
            return Promise.reject(result);
        }
        else {
            spanAttributes["details.ethPriceToInput"] = inputToEthPrice;
            spanAttributes["details.ethPriceToOutput"] = outputToEthPrice;
        }
    } catch(e) {
        result.reason = ProcessPairHaltReason.FailedToGetEthPrice;
        result.error = e;
        throw result;
    }

    // execute process to find opp through different modes
    let rawtx, oppBlockNumber;
    try {
        const findOppResult = await findOpp({
            orderPairObject,
            dataFetcher,
            arb,
            genericArb,
            fromToken,
            toToken,
            signer,
            gasPrice,
            config,
            viemClient,
            inputToEthPrice,
            outputToEthPrice,
            orderbooksOrders,
        });
        ({ rawtx, oppBlockNumber } = findOppResult.value);

        // record span attrs
        for (attrKey in findOppResult.spanAttributes) {
            if (attrKey !== "oppBlockNumber" && attrKey !== "foundOpp") {
                spanAttributes["details." + attrKey] = findOppResult.spanAttributes[attrKey];
            }
            else {
                spanAttributes[attrKey] = findOppResult.spanAttributes[attrKey];
            }
        }
    } catch (e) {
        // record all span attributes
        for (attrKey in e.spanAttributes) {
            spanAttributes["details." + attrKey] = e.spanAttributes[attrKey];
        }
        if ("rawtx" in e) {
            result.report = {
                status: ProcessPairReportStatus.NoOpportunity,
                tokenPair: pair,
                buyToken: orderPairObject.buyToken,
                sellToken: orderPairObject.sellToken,
            };
            return result;
        } else {
            result.reason = ProcessPairHaltReason.NoWalletFund;
            throw result;
        }
    }

    // from here on we know an opp is found, so record it in report and in otel span attributes
    result.report = {
        status: ProcessPairReportStatus.FoundOpportunity,
        tokenPair: pair,
        buyToken: orderPairObject.buyToken,
        sellToken: orderPairObject.sellToken,
    };
    spanAttributes["foundOpp"] = true;

    // get block number
    let blockNumber;
    try {
        blockNumber = Number(await viemClient.getBlockNumber());
        spanAttributes["details.blockNumber"] = blockNumber;
        spanAttributes["details.blockNumberDiff"] = blockNumber - oppBlockNumber;
    } catch(e) {
        // dont reject if getting block number fails but just record it,
        // since an opp is found and can ultimately be cleared
        spanAttributes["details.blockNumberError"] = JSON.stringify(getSpanException(e));
    }

    // submit the tx
    let tx, txUrl;
    try {
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
        spanAttributes["details.txUrl"] = txUrl;
        spanAttributes["details.tx"] = JSON.stringify(tx);
    } catch(e) {
        // record rawtx in case it is not already present in the error
        if (!JSON.stringify(e).includes(rawtx.data)) spanAttributes[
            "details.rawTx"
        ] = JSON.stringify(rawtx);
        result.error = e;
        result.reason = ProcessPairHaltReason.TxFailed;
        throw result;
    }

    // wait for tx receipt
    try {
        const receipt = config.timeout
            ? await promiseTimeout(
                tx.wait(2),
                config.timeout,
                `Transaction failed to mine after ${config.timeout}ms`
            )
            : await tx.wait(2);

        if (receipt.status === 1) {
            spanAttributes["didClear"] = true;

            const clearActualAmount = getActualClearAmount(
                rawtx.to,
                orderbook.address,
                receipt
            );
            const inputTokenIncome = getIncome(signer.address, receipt, orderPairObject.buyToken);
            const outputTokenIncome = getIncome(signer.address, receipt, orderPairObject.sellToken);
            const income = getTotalIncome(
                inputTokenIncome,
                outputTokenIncome,
                inputToEthPrice,
                outputToEthPrice,
                orderPairObject.buyTokenDecimals,
                orderPairObject.sellTokenDecimals
            );

            const actualGasCost = ethers.BigNumber.from(
                receipt.effectiveGasPrice
            ).mul(receipt.gasUsed);
            const netProfit = income
                ? income.sub(actualGasCost)
                : undefined;

            if (income) {
                spanAttributes["details.income"] = ethers.utils.formatUnits(
                    income,
                    orderPairObject.buyTokenDecimals
                );
                spanAttributes["details.netProfit"] = ethers.utils.formatUnits(
                    netProfit,
                    orderPairObject.buyTokenDecimals
                );
            }
            result.report = {
                status: ProcessPairReportStatus.FoundOpportunity,
                txUrl,
                tokenPair: pair,
                buyToken: orderPairObject.buyToken,
                sellToken: orderPairObject.sellToken,
                clearedAmount: clearActualAmount?.toString(),
                actualGasCost: ethers.utils.formatUnits(actualGasCost),
                income,
                netProfit,
                clearedOrders: orderPairObject.takeOrders.map(
                    v => v.id
                ),
            };

            // keep track of gas consumption of the account and bounty token
            result.gasCost = actualGasCost;
            signer.BALANCE = signer.BALANCE.sub(actualGasCost);
            if (!signer.BOUNTY.includes(orderPairObject.buyToken)) {
                signer.BOUNTY.push(orderPairObject.buyToken);
            }

            return result;
        }
        else {
            // keep track of gas consumption of the account
            const actualGasCost = ethers.BigNumber.from(receipt.effectiveGasPrice)
                .mul(receipt.gasUsed);
            signer.BALANCE = signer.BALANCE.sub(actualGasCost);
            result.report = {
                status: ProcessPairReportStatus.FoundOpportunity,
                txUrl,
                tokenPair: pair,
                buyToken: orderPairObject.buyToken,
                sellToken: orderPairObject.sellToken,
            };
            if (actualGasCost) {
                result.report.actualGasCost = ethers.utils.formatUnits(actualGasCost);
            }
            spanAttributes["details.receipt"] = JSON.stringify(receipt);
            result.reason = ProcessPairHaltReason.TxMineFailed;
            return Promise.reject(result);
        }
    } catch(e) {
        // keep track of gas consumption of the account
        let actualGasCost;
        try {
            actualGasCost = ethers.BigNumber.from(e.receipt.effectiveGasPrice)
                .mul(e.receipt.gasUsed);
            signer.BALANCE = signer.BALANCE.sub(actualGasCost);
        } catch {
            /**/
        }
        result.report = {
            status: ProcessPairReportStatus.FoundOpportunity,
            txUrl,
            tokenPair: pair,
            buyToken: orderPairObject.buyToken,
            sellToken: orderPairObject.sellToken,
        };
        if (actualGasCost) {
            result.report.actualGasCost = ethers.utils.formatUnits(actualGasCost);
        }
        result.error = e;
        result.reason = ProcessPairHaltReason.TxMineFailed;
        throw result;
    }
}

module.exports = {
    processOrders,
    processPair,
    ProcessPairHaltReason,
    ProcessPairReportStatus,
};
