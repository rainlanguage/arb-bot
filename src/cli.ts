import { clear } from ".";
import { config } from "dotenv";
import { getGasPrice } from "./gas";
import { startup } from "./cli/startup";
import { getOrderChanges } from "./query";
import { AppOptions } from "./config/yaml";
import { BigNumber, ethers } from "ethers";
import { RainSolverLogger } from "./logger";
import { RainSolverConfig } from "./config";
import { Context } from "@opentelemetry/api";
import { sleep, withBigintSerializer } from "./utils";
import { ErrorSeverity, errorSnapshot } from "./error";
import { getDataFetcher, getMetaInfo } from "./client";
import { trace, Tracer, context, SpanStatusCode } from "@opentelemetry/api";
import { sweepToEth, manageAccounts, sweepToMainWallet, getBatchEthBalance } from "./account";
import { ViemClient, BundledOrders, OperationState, ProcessPairReportStatus } from "./types";
import {
    downscaleProtection,
    prepareOrdersForRound,
    handleAddOrderbookOwnersProfileMap,
    handleRemoveOrderbookOwnersProfileMap,
} from "./order";

config();

export const arbRound = async (
    tracer: Tracer,
    roundCtx: Context,
    options: AppOptions,
    config: RainSolverConfig,
    bundledOrders: BundledOrders[][],
    state: OperationState,
) => {
    return await tracer.startActiveSpan("process-orders", {}, roundCtx, async (span) => {
        const ctx = trace.setSpan(context.active(), span);
        options;
        try {
            let txs;
            let foundOpp = false;
            let didClear = false;
            const { reports = [], avgGasCost = undefined } = await clear(
                config,
                bundledOrders,
                state,
                tracer,
                ctx,
            );
            if (reports && reports.length) {
                txs = reports.map((v) => v.txUrl).filter((v) => !!v);
                if (txs.length) {
                    foundOpp = true;
                    span.setAttribute("txUrls", txs);
                    span.setAttribute("foundOpp", true);
                } else if (
                    reports.some((v) => v.status === ProcessPairReportStatus.FoundOpportunity)
                ) {
                    foundOpp = true;
                    span.setAttribute("foundOpp", true);
                }
                if (
                    reports.some(
                        (v) => v.status === ProcessPairReportStatus.FoundOpportunity && !v.reason,
                    )
                ) {
                    didClear = true;
                    span.setAttribute("didClear", true);
                }
            } else {
                span.setAttribute("didClear", false);
            }
            if (avgGasCost) {
                span.setAttribute("avgGasCost", ethers.utils.formatUnits(avgGasCost));
            }
            span.setStatus({ code: SpanStatusCode.OK });
            span.end();
            return { txs, foundOpp, didClear, avgGasCost };
        } catch (e: any) {
            if (e?.startsWith?.("Failed to batch quote orders")) {
                span.setAttribute("severity", ErrorSeverity.LOW);
                span.setStatus({ code: SpanStatusCode.ERROR, message: e });
            } else {
                const snapshot = errorSnapshot("Unexpected error occured", e);
                span.setAttribute("severity", ErrorSeverity.HIGH);
                span.setStatus({ code: SpanStatusCode.ERROR, message: snapshot });
            }
            span.recordException(e);
            span.setAttribute("didClear", false);
            span.setAttribute("foundOpp", false);
            span.end();
            return { txs: [], foundOpp: false, didClear: false, avgGasCost: undefined };
        }
    });
};

export const main = async (argv: any, version?: string) => {
    const logger = new RainSolverLogger();

    // parse cli args and startup bot configuration
    const { state, config, options, watchedTokens, startupTimestamp, orderbooksOwnersProfileMap } =
        await logger.tracer.startActiveSpan("startup", async (startupSpan) => {
            const ctx = trace.setSpan(context.active(), startupSpan);
            try {
                const result = await startup(argv, version, logger.tracer, ctx);
                startupSpan.setStatus({ code: SpanStatusCode.OK });
                startupSpan.end();
                return result;
            } catch (e: any) {
                const snapshot = errorSnapshot("", e);
                startupSpan.setAttribute("severity", ErrorSeverity.HIGH);
                startupSpan.setStatus({ code: SpanStatusCode.ERROR, message: snapshot });
                startupSpan.recordException(e);

                // end this span and wait for it to finish
                startupSpan.end();
                await sleep(20000);

                // reject the promise that makes the cli process to exit with error
                return Promise.reject(e);
            }
        });

    const lastReadOrdersMap = options.subgraph.map((v) => ({
        sg: v,
        skip: 0,
    }));
    const day = 24 * 60 * 60 * 1000;
    let lastGasReset = Date.now() + day;
    let lastInterval = Date.now() + options.poolUpdateInterval * 60_000;
    let lastUsedAccountIndex = config.accounts.length;
    let avgGasCost: BigNumber | undefined;
    let counter = 1;
    const wgc: ViemClient[] = [];
    const wgcBuffer: { address: string; count: number }[] = [];
    const botMinBalance = ethers.utils.parseUnits(options.botMinBalance);

    // run bot's processing orders in a loop
    // eslint-disable-next-line no-constant-condition
    while (true) {
        await logger.tracer.startActiveSpan(`round-${counter}`, async (roundSpan) => {
            const roundCtx = trace.setSpan(context.active(), roundSpan);
            const newMeta = await getMetaInfo(config, options.subgraph);
            roundSpan.setAttributes({
                ...newMeta,
                "meta.mainAccount": config.mainAccount.account.address,
                "meta.gitCommitHash": process?.env?.GIT_COMMIT ?? "N/A",
                "meta.dockerTag": process?.env?.DOCKER_TAG ?? "N/A",
                "meta.trackedTokens": JSON.stringify(config.watchedTokens),
                "meta.configurations": JSON.stringify(
                    {
                        ...options,
                        key: options.key ? "***" : "N/A",
                        mnemonic: options.mnemonic ? "***" : "N/A",
                    },
                    withBigintSerializer,
                ),
            });

            await logger.tracer.startActiveSpan(
                "check-wallet-balance",
                {},
                roundCtx,
                async (walletSpan) => {
                    try {
                        const botGasBalance = ethers.BigNumber.from(
                            await config.viemClient.getBalance({
                                address: config.mainAccount.account.address,
                            }),
                        );
                        config.mainAccount.BALANCE = botGasBalance;
                        if (botMinBalance.gt(botGasBalance)) {
                            const header = `bot main wallet ${
                                config.mainAccount.account.address
                            } is low on gas, expected at least: ${
                                options.botMinBalance
                            }, current: ${ethers.utils.formatUnits(botGasBalance)}, `;
                            const fill = config.accounts.length
                                ? `that wallet is the one that funds the multi wallet, there are still ${
                                      config.accounts.length + 1
                                  } wallets with enough balance in circulation that clear orders, please consider toping up soon`
                                : "it will still work with remaining gas as far as it can, please topup as soon as possible";
                            walletSpan.setStatus({
                                code: SpanStatusCode.ERROR,
                                message: header + fill,
                            });
                            walletSpan.setAttribute(
                                "severity",
                                config.accounts.length ? ErrorSeverity.MEDIUM : ErrorSeverity.HIGH,
                            );
                        }
                    } catch (error) {
                        walletSpan.setStatus({
                            code: SpanStatusCode.ERROR,
                            message:
                                "Failed to check main wallet balance: " + errorSnapshot("", error),
                        });
                        walletSpan.setAttribute("severity", ErrorSeverity.LOW);
                    }
                    walletSpan.end();
                },
            );
            // remove pool memoizer cache on each interval
            let update = false;
            const now = Date.now();
            if (lastInterval <= now) {
                lastInterval = now + options.poolUpdateInterval * 60_000;
                update = true;
            }
            try {
                const bundledOrders = prepareOrdersForRound(orderbooksOwnersProfileMap, true);
                if (update) {
                    await getDataFetcher(config.viemClient, state.rpc, config.lps);
                }
                roundSpan.setAttribute("details.rpc", state.rpc.urls);
                await getGasPrice(config, state);
                const roundResult = await arbRound(
                    logger.tracer,
                    roundCtx,
                    options,
                    config,
                    bundledOrders,
                    state,
                );
                let txs, foundOpp, didClear, roundAvgGasCost;
                if (roundResult) {
                    txs = roundResult.txs;
                    foundOpp = roundResult.foundOpp;
                    didClear = roundResult.didClear;
                    roundAvgGasCost = roundResult.avgGasCost;
                }
                if (txs && txs.length) {
                    roundSpan.setAttribute("txUrls", txs);
                    roundSpan.setAttribute("foundOpp", true);
                } else if (didClear) {
                    roundSpan.setAttribute("foundOpp", true);
                    roundSpan.setAttribute("didClear", true);
                } else if (foundOpp) {
                    roundSpan.setAttribute("foundOpp", true);
                    roundSpan.setAttribute("didClear", false);
                } else {
                    roundSpan.setAttribute("foundOpp", false);
                    roundSpan.setAttribute("didClear", false);
                }

                // fecth account's balances
                if (foundOpp && config.accounts.length) {
                    try {
                        const balances = await getBatchEthBalance(
                            config.accounts.map((v) => v.account.address),
                            config.viemClient as any as ViemClient,
                        );
                        config.accounts.forEach((v, i) => (v.BALANCE = balances[i]));
                    } catch {
                        /**/
                    }
                }

                // keep avg gas cost
                if (roundAvgGasCost) {
                    const _now = Date.now();
                    if (lastGasReset <= _now) {
                        lastGasReset = _now + day;
                        avgGasCost = undefined;
                    }
                    if (avgGasCost) {
                        avgGasCost = avgGasCost.add(roundAvgGasCost).div(2);
                    } else {
                        avgGasCost = roundAvgGasCost;
                    }
                }
                if (avgGasCost && config.accounts.length) {
                    // manage account by removing those that have ran out of gas
                    // and issuing a new one into circulation
                    lastUsedAccountIndex = await manageAccounts(
                        config,
                        options,
                        avgGasCost,
                        lastUsedAccountIndex,
                        wgc,
                        state,
                        logger.tracer,
                        roundCtx,
                    );
                }

                // sweep tokens and wallets every 100 rounds
                if (counter % 100 === 0) {
                    // try to sweep wallets that still have non transfered tokens to main wallet
                    if (wgc.length) {
                        for (let k = wgc.length - 1; k >= 0; k--) {
                            try {
                                await sweepToMainWallet(
                                    wgc[k],
                                    config.mainAccount,
                                    state,
                                    config,
                                    logger.tracer,
                                    roundCtx,
                                );
                                if (!wgc[k].BOUNTY.length) {
                                    const index = wgcBuffer.findIndex(
                                        (v) => v.address === wgc[k].account.address,
                                    );
                                    if (index > -1) wgcBuffer.splice(index, 1);
                                    wgc.splice(k, 1);
                                } else {
                                    // retry to sweep garbage wallet 3 times before letting it go
                                    const index = wgcBuffer.findIndex(
                                        (v) => v.address === wgc[k].account.address,
                                    );
                                    if (index > -1) {
                                        wgcBuffer[index].count++;
                                        if (wgcBuffer[index].count >= 2) {
                                            wgcBuffer.splice(index, 1);
                                            wgc.splice(k, 1);
                                        }
                                    } else {
                                        wgcBuffer.push({
                                            address: wgc[k].account.address,
                                            count: 0,
                                        });
                                    }
                                }
                            } catch {
                                /**/
                            }
                        }
                    }
                    // try to sweep main wallet's tokens back to eth
                    try {
                        await sweepToEth(config, state, logger.tracer, roundCtx);
                    } catch {
                        /**/
                    }
                }
                roundSpan.setStatus({ code: SpanStatusCode.OK });
            } catch (error: any) {
                const snapshot = errorSnapshot("", error);
                roundSpan.setAttribute("severity", ErrorSeverity.HIGH);
                roundSpan.setAttribute("didClear", false);
                roundSpan.recordException(error);
                roundSpan.setStatus({ code: SpanStatusCode.ERROR, message: snapshot });
            }
            if (config.accounts.length) {
                const accountsWithBalance: Record<string, string> = {};
                config.accounts.forEach(
                    (v) =>
                        (accountsWithBalance[v.account.address] = ethers.utils.formatUnits(
                            v.BALANCE,
                        )),
                );
                roundSpan.setAttribute("circulatingAccounts", JSON.stringify(accountsWithBalance));
                roundSpan.setAttribute("lastAccountIndex", lastUsedAccountIndex);
            }
            if (avgGasCost) {
                roundSpan.setAttribute("avgGasCost", ethers.utils.formatUnits(avgGasCost));
            }

            try {
                // handle order changes (add/remove)
                roundSpan.setAttribute(
                    "watch-new-orders",
                    JSON.stringify({
                        hasRead: lastReadOrdersMap,
                        startTime: startupTimestamp,
                    }),
                );
                let ordersDidChange = false;
                const results = await Promise.allSettled(
                    lastReadOrdersMap.map((v) =>
                        getOrderChanges(
                            v.sg,
                            startupTimestamp,
                            v.skip,
                            roundSpan,
                            options.sgFilter,
                        ),
                    ),
                );
                for (let i = 0; i < results.length; i++) {
                    const res = results[i];
                    if (res.status === "fulfilled") {
                        if (res.value.addOrders.length || res.value.removeOrders.length) {
                            ordersDidChange = true;
                        }
                        lastReadOrdersMap[i].skip += res.value.count;
                        try {
                            await handleAddOrderbookOwnersProfileMap(
                                orderbooksOwnersProfileMap,
                                res.value.addOrders.map((v) => v.order),
                                config.viemClient as any as ViemClient,
                                watchedTokens,
                                options.ownerProfile,
                                roundSpan,
                            );
                        } catch {
                            /**/
                        }
                        try {
                            await handleRemoveOrderbookOwnersProfileMap(
                                orderbooksOwnersProfileMap,
                                res.value.removeOrders.map((v) => v.order),
                                roundSpan,
                            );
                        } catch {
                            /**/
                        }
                    }
                }

                // in case there are new orders or removed order, re evaluate owners limits
                if (ordersDidChange) {
                    await downscaleProtection(
                        orderbooksOwnersProfileMap,
                        config.viemClient as any as ViemClient,
                        options.ownerProfile,
                    );
                }
            } catch {
                /**/
            }

            // report rpcs performance for round
            for (const rpc in state.rpc.metrics) {
                await logger.tracer.startActiveSpan("rpc-report", {}, roundCtx, async (span) => {
                    const record = state.rpc.metrics[rpc];
                    span.setAttributes({
                        "rpc-url": rpc,
                        "request-count": record.req,
                        "success-count": record.success,
                        "failure-count": record.failure,
                        "timeout-count": record.timeout,
                        "avg-request-interval": record.avgRequestIntervals,
                        "latest-success-rate": record.progress.successRate / 100,
                        "selection-weight": record.progress.selectionWeight,
                    });
                    record.reset();
                    span.end();
                });
            }
            // report write rpcs performance
            if (state.writeRpc) {
                for (const rpc in state.writeRpc.metrics) {
                    await logger.tracer.startActiveSpan(
                        "rpc-report",
                        {},
                        roundCtx,
                        async (span) => {
                            const record = state.writeRpc!.metrics[rpc];
                            span.setAttributes({
                                "rpc-url": rpc,
                                "request-count": record.req,
                                "success-count": record.success,
                                "failure-count": record.failure,
                                "timeout-count": record.timeout,
                                "avg-request-interval": record.avgRequestIntervals,
                                "latest-success-rate": record.progress.successRate / 100,
                                "selection-weight": record.progress.selectionWeight,
                            });
                            record.reset();
                            span.end();
                        },
                    );
                }
            }

            // eslint-disable-next-line no-console
            console.log(`Starting next round in ${options.sleep / 1000} seconds...`, "\n");
            roundSpan.end();
            await sleep(options.sleep);
            // give otel some time to export
            await sleep(3000);
        });
        counter++;

        // for preview CI
        // break out of the loop if in prod preview mode
        // after specified number of rounds are executed
        if (
            process?.env?.IS_PREVIEW === "true" &&
            counter > Number(process?.env?.PREVIEW_ROUNDS ?? 1)
        ) {
            break;
        }
    }

    // flush and close the connection.
    await logger.shutdown();
    await sleep(10000);
};
