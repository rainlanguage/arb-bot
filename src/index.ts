import axios from "axios";
import { ethers } from "ethers";
import { ChainId } from "sushi";
import { versions } from "process";
import { PublicClient } from "viem";
import { processLps } from "./utils";
import { initAccounts } from "./account";
import { processOrders } from "./processOrders";
import { Context, Span } from "@opentelemetry/api";
import { getQuery, statusCheckQuery } from "./query";
import { checkSgStatus, handleSgResults } from "./sg";
import { Tracer } from "@opentelemetry/sdk-trace-base";
import { BotConfig, CliOptions, RoundReport, SgFilter } from "./types";
import { createViemClient, getChainConfig, getDataFetcher } from "./config";

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
): Promise<any[]> {
    const hasjson = false;
    const ordersDetails: any[] = [];
    const isInvalidSg = !Array.isArray(sgs) || sgs.length === 0;

    if (isInvalidSg) throw "type of provided sources are invalid";
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
                if (v && typeof v === "string")
                    promises.push(
                        axios.post(
                            v,
                            {
                                query: getQuery(
                                    sgFilters?.orderHash,
                                    sgFilters?.orderOwner,
                                    sgFilters?.orderbook,
                                ),
                            },
                            { headers: { "Content-Type": "application/json" }, timeout },
                        ),
                    );
            });
        }

        const responses = await Promise.allSettled(promises);
        ordersDetails.push(...handleSgResults(availableSgs, responses, span, hasjson));
    }
    return ordersDetails;
}

/**
 * Get the general and network configuration required for the bot to operate
 * @param rpcUrls - The RPC URL array
 * @param walletKey - The wallet mnemonic phrase or private key
 * @param arbAddress - The Rain Arb contract address deployed on the network
 * @param options - (optional) Optional parameters, liquidity providers
 * @returns The configuration object
 */
export async function getConfig(
    rpcUrls: string[],
    walletKey: string,
    arbAddress: string,
    options: CliOptions,
    tracer?: Tracer,
    ctx?: Context,
): Promise<BotConfig> {
    const AddressPattern = /^0x[a-fA-F0-9]{40}$/;
    if (!AddressPattern.test(arbAddress)) throw "invalid arb contract address";
    if (options.genericArbAddress && !AddressPattern.test(options.genericArbAddress)) {
        throw "invalid generic arb contract address";
    }

    let timeout = 30_000;
    if (options.timeout !== undefined) {
        if (typeof options.timeout === "number") {
            if (!Number.isInteger(options.timeout) || options.timeout == 0)
                throw "invalid timeout, must be an integer greater than 0";
            else timeout = options.timeout * 1000;
        } else if (typeof options.timeout === "string") {
            if (/^\d+$/.test(options.timeout)) timeout = Number(options.timeout) * 1000;
            else throw "invalid timeout, must be an integer greater than 0";
            if (timeout == 0) throw "invalid timeout, must be an integer greater than 0";
        } else throw "invalid timeout, must be an integer greater than 0";
    }

    let gasCoveragePercentage = "100";
    if (options.gasCoverage) {
        if (/^[0-9]+$/.test(options.gasCoverage)) {
            gasCoveragePercentage = options.gasCoverage;
        } else throw "invalid gas coverage percentage, must be an integer greater than equal 0";
    }

    let hops = 1;
    if (options.hops) {
        if (typeof options.hops === "number") {
            hops = options.hops;
            if (hops === 0) throw "invalid hops value, must be an integer greater than 0";
        } else if (typeof options.hops === "string" && /^[0-9]+$/.test(options.hops)) {
            hops = Number(options.hops);
            if (hops === 0) throw "invalid hops value, must be an integer greater than 0";
        } else throw "invalid hops value, must be an integer greater than 0";
    }

    let retries = 1;
    if (options.retries) {
        if (typeof options.retries === "number") {
            retries = options.retries;
            if (retries < 1 || retries > 3)
                throw "invalid retries value, must be an integer between 1 - 3";
        } else if (typeof options.retries === "string" && /^[0-9]+$/.test(options.retries)) {
            retries = Number(options.retries);
            if (retries < 1 || retries > 3)
                throw "invalid retries value, must be an integer between 1 - 3";
        } else throw "invalid retries value, must be an integer between 1 - 3";
    }
    const chainId = (await getChainId(rpcUrls)) as ChainId;
    const config = getChainConfig(chainId) as any as BotConfig;
    const lps = processLps(options.lps);
    const viemClient = await createViemClient(chainId, rpcUrls, false, undefined, options.timeout);
    const dataFetcher = await getDataFetcher(viemClient as any as PublicClient, lps, false);
    if (!config) throw `Cannot find configuration for the network with chain id: ${chainId}`;

    config.bundle = true;
    if (options.bundle !== undefined) config.bundle = !!options.bundle;

    config.rpc = rpcUrls;
    config.arbAddress = arbAddress;
    config.genericArbAddress = options.genericArbAddress;
    config.timeout = timeout;
    config.flashbotRpc = options.flashbotRpc;
    config.maxRatio = !!options.maxRatio;
    config.hops = hops;
    config.retries = retries;
    config.gasCoveragePercentage = gasCoveragePercentage;
    config.lps = lps;
    config.viemClient = viemClient as any as PublicClient;
    config.dataFetcher = dataFetcher;
    config.watchedTokens = options.tokens ?? [];
    config.selfFundOrders = options.selfFundOrders;

    // init accounts
    const { mainAccount, accounts } = await initAccounts(walletKey, config, options, tracer, ctx);
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
    config: BotConfig,
    ordersDetails: any[],
    tracer: Tracer,
    ctx: Context,
): Promise<RoundReport> {
    const version = versions.node;
    const majorVersion = Number(version.slice(0, version.indexOf(".")));

    if (majorVersion >= 18) return await processOrders(config, ordersDetails, tracer, ctx);
    else throw `NodeJS v18 or higher is required for running the app, current version: ${version}`;
}

async function getChainId(rpcs: string[]): Promise<number> {
    for (let i = 0; i < rpcs.length; i++) {
        try {
            const provider = new ethers.providers.JsonRpcProvider(rpcs[i]);
            return (await provider.getNetwork()).chainId;
        } catch (error) {
            if (i === rpcs.length - 1) throw error;
        }
    }
    throw "Failed to get chain id";
}
