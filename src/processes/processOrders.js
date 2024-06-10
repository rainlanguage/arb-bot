const ethers = require("ethers");
const { arbAbis, orderbookAbi } = require("../abis");
const { SpanStatusCode } = require("@opentelemetry/api");
const { bundleOrders, getSpanException } = require("../utils");
const { AttemptOppAndClearHaltReason } = require("./processOpp");
const { ProcessPairHaltReason, processPair } = require("./processPair");

/**
 * Main function that processes all given orders and tries clearing them against onchain liquidity and reports the result
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
    const viemClient        = config.viemClient;
    const dataFetcher       = config.dataFetcher;
    const signer            = config.signer;
    const flashbotSigner    = config.flashbotRpc
        ? new ethers.Wallet(
            signer.privateKey,
            new ethers.providers.JsonRpcProvider(config.flashbotRpc)
        )
        : undefined;

    // instantiating arb contract
    const arb = new ethers.Contract(config.arbAddress, arbAbis);

    // instantiating orderbook contract
    const orderbook = new ethers.Contract(config.orderbookAddress, orderbookAbi);

    // prepare orders
    const bundledOrders = bundleOrders(
        ordersDetails,
        config.shuffle,
    );
    if (!bundledOrders.length) return;

    const allReports = {
        reports: [],
        foundOppsCount: 0,
        clearsCount: 0,
        txUrls: [],
    };
    for (let i = 0; i < bundledOrders.length; i++) {
        const pair = `${bundledOrders[i].buyTokenSymbol}/${bundledOrders[i].sellTokenSymbol}`;

        // process the pair
        try {
            const result = await processPair({
                config,
                orderPairObject: bundledOrders[i],
                viemClient,
                dataFetcher,
                signer,
                flashbotSigner,
                arb,
                orderbook,
                pair,
            });
            allReports.reports.push(...result.reports);

            for (let j = 0; j < result.reports.length; j++) {
                const report = result.reports[j];

                // instantiate a span
                const span = tracer.startSpan(pair, undefined, ctx);
                span.setAttributes(result.sharedSpanAttributes);
                span.setAttributes(report.spanAttributes);

                if (report.txUrl) allReports.txUrls.push(report.txUrl);
                if (report.reason) {
                    // set the otel span status based on returned reason
                    if (report.reason === AttemptOppAndClearHaltReason.NoWalletFund) {
                        span.setStatus({ code: SpanStatusCode.ERROR, message: "empty wallet" });
                        if (report.error) span.recordException(getSpanException(report.error));
                    }
                    else if (report.reason === AttemptOppAndClearHaltReason.NoRoute) {
                        span.setStatus({ code: SpanStatusCode.OK, message: "no route" });
                        if (report.error) span.setAttribute(
                            "details.error",
                            JSON.stringify(getSpanException(report.error))
                        );
                    }
                    else if (report.reason === AttemptOppAndClearHaltReason.NoOpportunity) {
                        span.setStatus({ code: SpanStatusCode.OK, message: "no opportunity" });
                        if (report.error) span.setAttribute(
                            "details.error",
                            JSON.stringify(getSpanException(report.error))
                        );
                    }
                    else if (report.reason === AttemptOppAndClearHaltReason.TxFailed) {
                        allReports.foundOppsCount++;
                        span.setAttribute("foundOpp", true);
                        span.setStatus({ code: SpanStatusCode.OK, message: "failed to send the transaction" });
                        if (report.error) span.setAttribute(
                            "details.error",
                            JSON.stringify(getSpanException(report.error))
                        );
                    }
                    else if (report.reason === AttemptOppAndClearHaltReason.TxMineFailed) {
                        allReports.foundOppsCount++;
                        span.setAttribute("foundOpp", true);
                        span.setStatus({ code: SpanStatusCode.OK, message: "transaction was included in block, but execution failed" });
                        if (report.error) span.setAttribute(
                            "details.error",
                            JSON.stringify(getSpanException(report.error))
                        );
                    }
                    else {
                        span.setStatus({ code: SpanStatusCode.ERROR, message: pair + ": unexpected error" });
                        if (report.error) span.recordException(getSpanException(report.error));
                    }
                } else {
                    allReports.foundOppsCount++;
                    allReports.clearsCount++;
                    span.setAttribute("foundOpp", true);
                    span.setAttribute("didClear", true);
                    span.setStatus({ code: SpanStatusCode.OK, message: "successfully cleared" });
                }
                span.end();
            }

            // terminate if wallet has no more funds
            if (result.reason === ProcessPairHaltReason.NoWalletFund) break;

        } catch(e) {
            // instantiate a span
            const span = tracer.startSpan(pair, undefined, ctx);
            span.setAttributes(e.sharedSpanAttributes);

            // record otel span status based on reported reason
            if (e.reason) {
                // set the otel span status based on returned reason
                if (e.reason === ProcessPairHaltReason.NoWalletFund) {
                    if (e.error) span.recordException(getSpanException(e.error));
                    span.setStatus({ code: SpanStatusCode.ERROR, message: "empty wallet" });
                } else if (e.reason === ProcessPairHaltReason.EmptyVault) {
                    if (e.error) span.setAttribute("details.error", JSON.stringify(getSpanException(e.error)));
                    span.setStatus({ code: SpanStatusCode.OK, message: "all orders have empty vault" });
                } else if (e.reason === ProcessPairHaltReason.FailedToGetVaultBalance) {
                    if (e.error) span.recordException(getSpanException(e.error));
                    span.setStatus({ code: SpanStatusCode.ERROR, message: pair + ": failed to get vault balances" });
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
                    if (e.error) span.setAttribute("details.error", JSON.stringify(getSpanException(e.error)));
                    span.setStatus({ code: SpanStatusCode.OK, message: "failed to get eth price" });
                } else {
                    if (e.error) span.recordException(getSpanException(e.error));
                    span.setStatus({ code: SpanStatusCode.ERROR, message: pair + "unexpected error" });
                }
            } else {
                if (e.error) span.recordException(getSpanException(e.error));
                span.setStatus({ code: SpanStatusCode.ERROR, message: pair + "unexpected error" });
            }
            span.end();
        }
    }
    return allReports;
};


module.exports = {
    processOrders,
};