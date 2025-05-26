import axios from "axios";
import { ChainId } from "sushi";
import { versions } from "process";
import { PublicClient } from "viem";
import { initAccounts } from "./account";
import { AppOptions } from "./config/yaml";
import { RainSolverConfig } from "./config";
import { processOrders } from "./processOrders";
import { Context, Span } from "@opentelemetry/api";
import { checkSgStatus, handleSgResults } from "./sg";
import { Tracer } from "@opentelemetry/sdk-trace-base";
import { getDataFetcher, createViemClient } from "./client";
import { querySgOrders, SgOrder, statusCheckQuery } from "./query";
import { SgFilter, RoundReport, BundledOrders, OperationState } from "./types";

/**
 * Get the order details from a source, i.e array of subgraphs and/or a local json file
 * @param sgs - The subgraph endpoint URL(s) to query for orders' details
 * @param json - Path to a json file containing orders structs
 * @param signer - The ethers signer
 * @param sgFilters - The filters for subgraph query
 * @param span
 */
export async function getOrderDetails(
    sgs: string[],
    sgFilters?: SgFilter,
    span?: Span,
    timeout?: number,
): Promise<SgOrder[]> {
    const hasjson = false;
    const ordersDetails: SgOrder[] = [];
    const isInvalidSg = !Array.isArray(sgs) || sgs.length === 0;

    if (isInvalidSg) throw "type of provided sources for reading orders are invalid";
    else {
        let availableSgs: string[] = [];
        const promises: Promise<any>[] = [];
        if (!isInvalidSg) {
            const validSgs: string[] = [];
            const statusCheckPromises: Promise<any>[] = [];
            sgs.forEach((v) => {
                if (v && typeof v === "string") {
                    statusCheckPromises.push(
                        axios.post(
                            v,
                            { query: statusCheckQuery },
                            { headers: { "Content-Type": "application/json" }, timeout },
                        ),
                    );
                    validSgs.push(v);
                }
            });
            const statusResult = await Promise.allSettled(statusCheckPromises);
            ({ availableSgs } = checkSgStatus(validSgs, statusResult, span, hasjson));

            availableSgs.forEach((v) => {
                if (v && typeof v === "string") promises.push(querySgOrders(v, sgFilters));
            });
        }

        const responses = await Promise.allSettled(promises);
        ordersDetails.push(...handleSgResults(availableSgs, responses, span, hasjson));
    }
    return ordersDetails;
}

/**
 * Get the general and network configuration required for the bot to operate
 * @param options - App Options
 * @param state - App state
 * @returns The configuration object
 */
export async function getConfig(
    options: AppOptions,
    state: OperationState,
    tracer?: Tracer,
    ctx?: Context,
): Promise<RainSolverConfig> {
    const config = await RainSolverConfig.tryFromAppOptions(options);
    const viemClient = await createViemClient(
        config.chain.id as ChainId,
        state.rpc,
        undefined,
        { timeout: options.timeout },
        undefined,
    );
    const dataFetcher = await getDataFetcher(
        viemClient as any as PublicClient,
        state.rpc,
        config.lps,
    );
    config.viemClient = viemClient as any as PublicClient;
    config.dataFetcher = dataFetcher;

    // init accounts
    const { mainAccount, accounts } = await initAccounts(
        config.walletKey,
        config,
        state,
        options,
        tracer,
        ctx,
    );
    config.mainAccount = mainAccount;
    config.accounts = accounts;

    return config;
}

/**
 * Method to find and take arbitrage trades for Rain Orderbook orders against some liquidity providers
 * @param config - The configuration object
 * @param ordersDetails - The order details queried from subgraph
 * @param options - The options for clear, such as 'gasCoveragePercentage''
 * @param tracer
 * @param ctx
 * @returns The report of details of cleared orders
 */
export async function clear(
    config: RainSolverConfig,
    bundledOrders: BundledOrders[][],
    state: OperationState,
    tracer: Tracer,
    ctx: Context,
): Promise<RoundReport> {
    const version = versions.node;
    const majorVersion = Number(version.slice(0, version.indexOf(".")));

    if (majorVersion >= 22) return await processOrders(config, bundledOrders, state, tracer, ctx);
    else throw `NodeJS v22 or higher is required for running the app, current version: ${version}`;
}
