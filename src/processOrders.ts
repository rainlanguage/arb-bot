import { ChainId } from "sushi";
import { findOpp } from "./modes";
import { PublicClient } from "viem";
import { Token } from "sushi/currency";
import { createViemClient } from "./config";
import { arbAbis, orderbookAbi } from "./abis";
import { privateKeyToAccount } from "viem/accounts";
import { BigNumber, Contract, ethers } from "ethers";
import { Tracer } from "@opentelemetry/sdk-trace-base";
import { ErrorSeverity, errorSnapshot } from "./error";
import { fundOwnedOrders, rotateAccounts } from "./account";
import { Context, SpanStatusCode } from "@opentelemetry/api";
import {
    Report,
    BotConfig,
    SpanAttrs,
    ViemClient,
    RoundReport,
    BundledOrders,
    BotDataFetcher,
    ProcessPairResult,
} from "./types";
import {
    toNumber,
    getIncome,
    getEthPrice,
    quoteOrders,
    routeExists,
    bundleOrders,
    PoolBlackList,
    getMarketQuote,
    getTotalIncome,
    checkOwnedOrders,
    quoteSingleOrder,
    getActualClearAmount,
    withBigintSerializer,
} from "./utils";

/**
 * Specifies reason that order process halted
 */
export enum ProcessPairHaltReason {
    FailedToQuote = 1,
    FailedToGetGasPrice = 2,
    FailedToGetEthPrice = 3,
    FailedToGetPools = 4,
    TxFailed = 5,
    TxMineFailed = 6,
    UnexpectedError = 7,
}

/**
 * Specifies status of an processed order report
 */
export enum ProcessPairReportStatus {
    ZeroOutput = 1,
    NoOpportunity = 2,
    FoundOpportunity = 3,
}

/**
 * Main function that processes all given orders and tries clearing them against onchain liquidity and reports the result
 * @param config - The configuration object
 * @param ordersDetails - The order details queried from subgraph
 * @param tracer
 * @param ctx
 */
export const processOrders = async (
    config: BotConfig,
    ordersDetails: any[],
    tracer: Tracer,
    ctx: Context,
): Promise<RoundReport> => {
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
    const bundledOrders = bundleOrders(ordersDetails, false, true);

    // check owned vaults and top them up if necessary
    let didPostSpan = false;
    try {
        const ownedOrders = await checkOwnedOrders(config, bundledOrders);
        if (ownedOrders.length) {
            const failedFundings = await fundOwnedOrders(ownedOrders, config);
            const emptyOrders = ownedOrders.filter((v) => v.vaultBalance.isZero());
            if (failedFundings.length || emptyOrders.length) {
                await tracer.startActiveSpan("handle-owned-vaults", {}, ctx, async (span) => {
                    didPostSpan = true;
                    const message: string[] = [];
                    if (emptyOrders.length) {
                        message.push(
                            "Reason: following owned vaults are empty:",
                            ...emptyOrders.map(
                                (v) => `\ntoken: ${v.symbol},\nvaultId: ${v.vaultId}`,
                            ),
                        );
                    }
                    if (failedFundings.length) {
                        failedFundings.forEach((v) => {
                            let msg = v.error;
                            if (v.ownedOrder) {
                                const vaultId =
                                    (v.ownedOrder.vaultId as any) instanceof BigNumber
                                        ? (v.ownedOrder.vaultId as any as BigNumber).toHexString()
                                        : v.ownedOrder.vaultId;
                                msg = `\ntoken: ${v.ownedOrder.symbol},\nvaultId: ${vaultId}\n`;
                            }
                            message.push(msg);
                        });
                        span.setAttribute(
                            "failedFundings",
                            failedFundings.map((v) =>
                                JSON.stringify({
                                    error: v.error,
                                    ...(v.ownedOrder
                                        ? {
                                              orderId: v.ownedOrder.id,
                                              orderbook: v.ownedOrder.orderbook,
                                              vaultId: v.ownedOrder.vaultId,
                                              token: v.ownedOrder.token,
                                              symbol: v.ownedOrder.symbol,
                                          }
                                        : {}),
                                }),
                            ),
                        );
                    }
                    span.setAttribute("severity", ErrorSeverity.MEDIUM);
                    span.setStatus({ code: SpanStatusCode.ERROR, message: message.join("\n") });
                    span.end();
                });
            }
        }
    } catch (e: any) {
        if (!didPostSpan) {
            await tracer.startActiveSpan("handle-owned-vaults", {}, ctx, async (span) => {
                span.setAttribute("severity", ErrorSeverity.HIGH);
                span.setStatus({
                    code: SpanStatusCode.ERROR,
                    message: errorSnapshot("Failed to check owned vaults", e),
                });
                span.recordException(e);
                span.end();
            });
        }
    }

    // batch quote orders to establish the orders to loop over
    try {
        await quoteOrders(
            bundledOrders,
            (config as any).isTest ? (config as any).quoteRpc : config.rpc,
        );
    } catch (e) {
        throw errorSnapshot("Failed to batch quote orders", e);
    }

    let avgGasCost: BigNumber | undefined;
    const reports: Report[] = [];
    for (const orderbookOrders of bundledOrders) {
        for (const pairOrders of orderbookOrders) {
            // instantiating orderbook contract
            const orderbook = new ethers.Contract(pairOrders.orderbook, orderbookAbi);

            for (let i = 0; i < pairOrders.takeOrders.length; i++) {
                const orderPairObject = {
                    orderbook: pairOrders.orderbook,
                    buyToken: pairOrders.buyToken,
                    buyTokenSymbol: pairOrders.buyTokenSymbol,
                    buyTokenDecimals: pairOrders.buyTokenDecimals,
                    sellToken: pairOrders.sellToken,
                    sellTokenSymbol: pairOrders.sellTokenSymbol,
                    sellTokenDecimals: pairOrders.sellTokenDecimals,
                    takeOrders: [pairOrders.takeOrders[i]],
                };
                const signer = accounts.length ? accounts[0] : mainAccount;
                const flashbotSigner = config.flashbotRpc
                    ? await createViemClient(
                          config.chain.id as ChainId,
                          [config.flashbotRpc],
                          undefined,
                          privateKeyToAccount(
                              ethers.utils.hexlify(
                                  ethers.utils.hexlify(signer.account.getHdKey().privateKey!),
                              ) as `0x${string}`,
                          ),
                          config.timeout,
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
                        orderbooksOrders: bundledOrders,
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
                        span.setAttribute("severity", ErrorSeverity.HIGH);
                        span.setStatus({ code: SpanStatusCode.ERROR, message: "unexpected error" });
                    }
                } catch (e: any) {
                    // keep track of avg gas cost
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
                        span.setAttribute("severity", ErrorSeverity.MEDIUM);

                        // set the otel span status based on returned reason
                        if (e.reason === ProcessPairHaltReason.FailedToQuote) {
                            let message =
                                "failed to quote order: " + orderPairObject.takeOrders[0].id;
                            if (e.error) {
                                message = errorSnapshot(message, e.error);
                            }
                            span.setStatus({ code: SpanStatusCode.OK, message });
                        } else if (e.reason === ProcessPairHaltReason.FailedToGetGasPrice) {
                            let message = pair + ": failed to get gas price";
                            if (e.error) {
                                message = errorSnapshot(message, e.error);
                                span.recordException(e.error);
                            }
                            span.setAttribute("severity", ErrorSeverity.LOW);
                            span.setStatus({ code: SpanStatusCode.ERROR, message });
                        } else if (e.reason === ProcessPairHaltReason.FailedToGetPools) {
                            let message = pair + ": failed to get pool details";
                            if (e.error) {
                                message = errorSnapshot(message, e.error);
                                span.recordException(e.error);
                            }
                            span.setAttribute("severity", ErrorSeverity.MEDIUM);
                            span.setStatus({ code: SpanStatusCode.ERROR, message });
                        } else if (e.reason === ProcessPairHaltReason.FailedToGetEthPrice) {
                            // set OK status because a token might not have a pool and as a result eth price cannot
                            // be fetched for it and if it is set to ERROR it will constantly error on each round
                            // resulting in lots of false positives
                            let message = "failed to get eth price";
                            if (e.error) {
                                message = errorSnapshot(message, e.error);
                                span.setAttribute("errorDetails", message);
                            }
                            span.setStatus({ code: SpanStatusCode.OK, message });
                        } else {
                            // set the otel span status as OK as an unsuccessfull clear, this can happen for example
                            // because of mev front running or false positive opportunities, etc
                            let message = "transaction failed";
                            if (e.error) {
                                message = errorSnapshot(message, e.error);
                                span.setAttribute("errorDetails", message);
                            }
                            span.setStatus({ code: SpanStatusCode.OK, message });
                            span.setAttribute("unsuccessfullClear", true);
                        }
                    } else {
                        // record the error for the span
                        let message = pair + ": unexpected error";
                        if (e.error) {
                            message = errorSnapshot(message, e.error);
                            span.recordException(e.error);
                        }

                        // report the unexpected error reason
                        reports.push({
                            ...e.report,
                            error: e.error,
                            reason: ProcessPairHaltReason.UnexpectedError,
                        });
                        // set the span status to unexpected error
                        span.setAttribute("severity", ErrorSeverity.HIGH);
                        span.setStatus({ code: SpanStatusCode.ERROR, message });
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
export async function processPair(args: {
    config: BotConfig;
    orderPairObject: BundledOrders;
    viemClient: PublicClient;
    dataFetcher: BotDataFetcher;
    signer: ViemClient;
    flashbotSigner: ViemClient | undefined;
    arb: Contract;
    genericArb: Contract | undefined;
    orderbook: Contract;
    pair: string;
    orderbooksOrders: BundledOrders[][];
}): Promise<ProcessPairResult> {
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
        orderbooksOrders,
    } = args;

    const spanAttributes: SpanAttrs = {};
    const result: ProcessPairResult = {
        reason: undefined,
        error: undefined,
        gasCost: undefined,
        spanAttributes,
        report: {
            status: ProcessPairReportStatus.NoOpportunity,
            tokenPair: pair,
            buyToken: orderPairObject.buyToken,
            sellToken: orderPairObject.sellToken,
        },
    };

    spanAttributes["details.orders"] = orderPairObject.takeOrders.map((v) => v.id);
    spanAttributes["details.pair"] = pair;

    const fromToken = new Token({
        chainId: config.chain.id,
        decimals: orderPairObject.sellTokenDecimals,
        address: orderPairObject.sellToken,
        symbol: orderPairObject.sellTokenSymbol,
    });
    const toToken = new Token({
        chainId: config.chain.id,
        decimals: orderPairObject.buyTokenDecimals,
        address: orderPairObject.buyToken,
        symbol: orderPairObject.buyTokenSymbol,
    });

    try {
        await quoteSingleOrder(
            orderPairObject,
            (config as any).isTest ? (config as any).quoteRpc : config.rpc,
        );
        if (orderPairObject.takeOrders[0].quote?.maxOutput.isZero()) {
            result.report = {
                status: ProcessPairReportStatus.ZeroOutput,
                tokenPair: pair,
                buyToken: orderPairObject.buyToken,
                sellToken: orderPairObject.sellToken,
            };
            return result;
        }
    } catch (e) {
        result.error = e;
        result.reason = ProcessPairHaltReason.FailedToQuote;
        throw result;
    }

    spanAttributes["details.quote"] = JSON.stringify({
        maxOutput: ethers.utils.formatUnits(orderPairObject.takeOrders[0].quote!.maxOutput),
        ratio: ethers.utils.formatUnits(orderPairObject.takeOrders[0].quote!.ratio),
    });

    // get gas price
    let gasPrice;
    try {
        const gasPriceBigInt = await viemClient.getGasPrice();
        gasPrice = ethers.BigNumber.from(gasPriceBigInt).mul("107").div("100");
        spanAttributes["details.gasPrice"] = gasPrice.toString();
    } catch (e) {
        result.reason = ProcessPairHaltReason.FailedToGetGasPrice;
        result.error = e;
        throw result;
    }

    // get pool details
    if (
        !dataFetcher.fetchedPairPools.includes(pair) ||
        !(await routeExists(config, fromToken, toToken, gasPrice))
    ) {
        try {
            const options = {
                fetchPoolsTimeout: 90000,
            };
            // pin block number for test case
            if ((config as any).isTest && (config as any).testBlockNumber) {
                (options as any).blockNumber = (config as any).testBlockNumber;
            }
            await dataFetcher.fetchPoolsForToken(fromToken, toToken, PoolBlackList, options);
            const p1 = `${orderPairObject.buyTokenSymbol}/${orderPairObject.sellTokenSymbol}`;
            const p2 = `${orderPairObject.sellTokenSymbol}/${orderPairObject.buyTokenSymbol}`;
            if (!dataFetcher.fetchedPairPools.includes(p1)) dataFetcher.fetchedPairPools.push(p1);
            if (!dataFetcher.fetchedPairPools.includes(p2)) dataFetcher.fetchedPairPools.push(p2);
        } catch (e) {
            result.reason = ProcessPairHaltReason.FailedToGetPools;
            result.error = e;
            throw result;
        }
    }

    try {
        const marketQuote = getMarketQuote(config, fromToken, toToken, gasPrice);
        if (marketQuote) {
            spanAttributes["details.marketQuote.str"] = marketQuote.price;
            spanAttributes["details.marketQuote.num"] = toNumber(
                ethers.utils.parseUnits(marketQuote.price),
            );
        }
    } catch {
        /**/
    }

    // get in/out tokens to eth price
    let inputToEthPrice, outputToEthPrice;
    try {
        const options = {
            fetchPoolsTimeout: 30000,
        };
        // pin block number for test case
        if ((config as any).isTest && (config as any).testBlockNumber) {
            (options as any).blockNumber = (config as any).testBlockNumber;
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
            if (config.gasCoveragePercentage === "0") {
                inputToEthPrice = "0";
                outputToEthPrice = "0";
            } else {
                result.reason = ProcessPairHaltReason.FailedToGetEthPrice;
                result.error = "no-route";
                return Promise.reject(result);
            }
        } else {
            const p1 = `${orderPairObject.buyTokenSymbol}/${config.nativeWrappedToken.symbol}`;
            const p2 = `${orderPairObject.sellTokenSymbol}/${config.nativeWrappedToken.symbol}`;
            if (!dataFetcher.fetchedPairPools.includes(p1)) dataFetcher.fetchedPairPools.push(p1);
            if (!dataFetcher.fetchedPairPools.includes(p2)) dataFetcher.fetchedPairPools.push(p2);
            spanAttributes["details.inputToEthPrice"] = inputToEthPrice;
            spanAttributes["details.outputToEthPrice"] = outputToEthPrice;
        }
    } catch (e) {
        if (config.gasCoveragePercentage === "0") {
            inputToEthPrice = "0";
            outputToEthPrice = "0";
        } else {
            result.reason = ProcessPairHaltReason.FailedToGetEthPrice;
            result.error = e;
            throw result;
        }
    }

    // execute process to find opp through different modes
    let rawtx, oppBlockNumber, estimatedProfit;
    try {
        const findOppResult = await findOpp({
            orderPairObject,
            dataFetcher,
            arb,
            genericArb,
            fromToken,
            toToken,
            signer,
            gasPrice: gasPrice.toBigInt(),
            config,
            viemClient,
            inputToEthPrice,
            outputToEthPrice,
            orderbooksOrders,
        });
        ({ rawtx, oppBlockNumber, estimatedProfit } = findOppResult.value!);

        if (!rawtx || !oppBlockNumber) throw "undefined tx/block number";

        // record span attrs
        spanAttributes["details.estimatedProfit"] = ethers.utils.formatUnits(estimatedProfit);
        for (const attrKey in findOppResult.spanAttributes) {
            if (attrKey !== "oppBlockNumber" && attrKey !== "foundOpp") {
                spanAttributes["details." + attrKey] = findOppResult.spanAttributes[attrKey];
            } else {
                spanAttributes[attrKey] = findOppResult.spanAttributes[attrKey];
            }
        }
    } catch (e: any) {
        // record all span attributes
        for (const attrKey in e.spanAttributes) {
            spanAttributes["details." + attrKey] = e.spanAttributes[attrKey];
        }
        result.report = {
            status: ProcessPairReportStatus.NoOpportunity,
            tokenPair: pair,
            buyToken: orderPairObject.buyToken,
            sellToken: orderPairObject.sellToken,
        };
        return result;
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
    let blockNumber: number;
    try {
        blockNumber = Number(await viemClient.getBlockNumber());
        spanAttributes["details.blockNumber"] = blockNumber;
        spanAttributes["details.blockNumberDiff"] = blockNumber - oppBlockNumber;
    } catch (e) {
        // dont reject if getting block number fails but just record it,
        // since an opp is found and can ultimately be cleared
        spanAttributes["details.blockNumberError"] = errorSnapshot("failed to get block number", e);
    }

    // submit the tx
    let txhash, txUrl;
    try {
        txhash =
            flashbotSigner !== undefined
                ? await flashbotSigner.sendTransaction(rawtx)
                : await signer.sendTransaction(rawtx);

        txUrl = config.chain.blockExplorers?.default.url + "/tx/" + txhash;
        // eslint-disable-next-line no-console
        console.log("\x1b[33m%s\x1b[0m", txUrl, "\n");
        spanAttributes["details.txUrl"] = txUrl;
    } catch (e) {
        // record rawtx in case it is not already present in the error
        spanAttributes["details.rawTx"] = JSON.stringify(
            {
                ...rawtx,
                from: signer.account.address,
            },
            withBigintSerializer,
        );
        result.error = e;
        result.reason = ProcessPairHaltReason.TxFailed;
        throw result;
    }

    // wait for tx receipt
    try {
        const receipt = await viemClient.waitForTransactionReceipt({
            hash: txhash,
            confirmations: 1,
            timeout: 200_000,
        });

        const actualGasCost = ethers.BigNumber.from(receipt.effectiveGasPrice).mul(receipt.gasUsed);
        signer.BALANCE = signer.BALANCE.sub(actualGasCost);
        if (receipt.status === "success") {
            spanAttributes["didClear"] = true;

            const clearActualAmount = getActualClearAmount(rawtx.to, orderbook.address, receipt);

            const inputTokenIncome = getIncome(
                signer.account.address,
                receipt,
                orderPairObject.buyToken,
            );
            const outputTokenIncome = getIncome(
                signer.account.address,
                receipt,
                orderPairObject.sellToken,
            );
            const income = getTotalIncome(
                inputTokenIncome,
                outputTokenIncome,
                inputToEthPrice,
                outputToEthPrice,
                orderPairObject.buyTokenDecimals,
                orderPairObject.sellTokenDecimals,
            );
            const netProfit = income ? income.sub(actualGasCost) : undefined;

            if (income) {
                spanAttributes["details.income"] = toNumber(income);
                spanAttributes["details.netProfit"] = toNumber(netProfit!);
                spanAttributes["details.actualGasCost"] = toNumber(actualGasCost);
            }
            if (inputTokenIncome) {
                spanAttributes["details.inputTokenIncome"] = ethers.utils.formatUnits(
                    inputTokenIncome,
                    orderPairObject.buyTokenDecimals,
                );
            }
            if (outputTokenIncome) {
                spanAttributes["details.outputTokenIncome"] = ethers.utils.formatUnits(
                    outputTokenIncome,
                    orderPairObject.sellTokenDecimals,
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
                inputTokenIncome: inputTokenIncome
                    ? ethers.utils.formatUnits(inputTokenIncome, toToken.decimals)
                    : undefined,
                outputTokenIncome: outputTokenIncome
                    ? ethers.utils.formatUnits(outputTokenIncome, fromToken.decimals)
                    : undefined,
                netProfit,
                clearedOrders: orderPairObject.takeOrders.map((v) => v.id),
            };

            // keep track of gas consumption of the account and bounty token
            result.gasCost = actualGasCost;
            if (
                inputTokenIncome &&
                inputTokenIncome.gt(0) &&
                !signer.BOUNTY.find((v) => v.address === orderPairObject.buyToken)
            ) {
                signer.BOUNTY.push({
                    address: orderPairObject.buyToken.toLowerCase(),
                    decimals: orderPairObject.buyTokenDecimals,
                    symbol: orderPairObject.buyTokenSymbol,
                });
            }
            if (
                outputTokenIncome &&
                outputTokenIncome.gt(0) &&
                !signer.BOUNTY.find((v) => v.address === orderPairObject.sellToken)
            ) {
                signer.BOUNTY.push({
                    address: orderPairObject.sellToken.toLowerCase(),
                    decimals: orderPairObject.sellTokenDecimals,
                    symbol: orderPairObject.sellTokenSymbol,
                });
            }
            return result;
        } else {
            // keep track of gas consumption of the account
            result.report = {
                status: ProcessPairReportStatus.FoundOpportunity,
                txUrl,
                tokenPair: pair,
                buyToken: orderPairObject.buyToken,
                sellToken: orderPairObject.sellToken,
                actualGasCost: ethers.utils.formatUnits(actualGasCost),
            };
            result.reason = ProcessPairHaltReason.TxMineFailed;
            return Promise.reject(result);
        }
    } catch (e: any) {
        // keep track of gas consumption of the account
        let actualGasCost;
        try {
            actualGasCost = ethers.BigNumber.from(e.receipt.effectiveGasPrice).mul(
                e.receipt.gasUsed,
            );
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
