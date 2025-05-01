import axios from "axios";
import { ethers } from "ethers";
import { ChainId } from "sushi";
import { RpcState } from "./rpc";
import { versions } from "process";
import { PublicClient } from "viem";
import { AppOptions } from "./yaml";
import { DeployerAbi } from "./abis";
import { initAccounts } from "./account";
import { processOrders } from "./processOrders";
import { Context, Span } from "@opentelemetry/api";
import { checkSgStatus, handleSgResults } from "./sg";
import { Tracer } from "@opentelemetry/sdk-trace-base";
import { querySgOrders, SgOrder, statusCheckQuery } from "./query";
import { SgFilter, BotConfig, RoundReport, BundledOrders, OperationState } from "./types";
import {
    processLps,
    getChainConfig,
    getDataFetcher,
    onFetchRequest,
    onFetchResponse,
    createViemClient,
} from "./config";

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
    options: AppOptions,
    tracer?: Tracer,
    ctx?: Context,
): Promise<BotConfig> {
    const chainId = (await getChainId(rpcUrls)) as ChainId;
    const config = getChainConfig(chainId) as any as BotConfig;
    if (!config) throw `Cannot find configuration for the network with chain id: ${chainId}`;

    // init rpc state
    const rpcState = new RpcState(rpcUrls);
    config.onFetchRequest = (request: Request) => {
        onFetchRequest(request, rpcState);
    };
    config.onFetchResponse = (response: Response) => {
        onFetchResponse(response.clone(), rpcState);
    };

    const lps = processLps(options.liquidityProviders);
    const viemClient = await createViemClient(
        chainId,
        rpcUrls,
        false,
        undefined,
        options.timeout,
        undefined,
        config,
    );
    const dataFetcher = await getDataFetcher(viemClient as any as PublicClient, lps, false);

    const interpreter = await (async () => {
        try {
            return await viemClient.readContract({
                address: options.dispair as `0x${string}`,
                abi: DeployerAbi,
                functionName: "iInterpreter",
            });
        } catch {
            throw "failed to get dispair interpreter address";
        }
    })();
    const store = await (async () => {
        try {
            return await viemClient.readContract({
                address: options.dispair as `0x${string}`,
                abi: DeployerAbi,
                functionName: "iStore",
            });
        } catch {
            throw "failed to get dispair store address";
        }
    })();

    config.rpc = rpcUrls;
    config.arbAddress = arbAddress;
    config.genericArbAddress = options.genericArbAddress;
    config.timeout = options.timeout;
    config.writeRpc = options.writeRpc;
    config.maxRatio = !!options.maxRatio;
    config.hops = options.hops;
    config.retries = options.retries;
    config.gasCoveragePercentage = options.gasCoveragePercentage;
    config.lps = lps;
    config.viemClient = viemClient as any as PublicClient;
    config.dataFetcher = dataFetcher;
    config.watchedTokens = options.tokens ?? [];
    config.selfFundOrders = options.selfFundOrders;
    config.publicRpc = false;
    config.walletKey = walletKey;
    config.route = options.route;
    config.rpcState = rpcState;
    config.gasPriceMultiplier = options.gasPriceMultiplier;
    config.gasLimitMultiplier = options.gasLimitMultiplier;
    config.txGas = options.txGas;
    config.quoteGas = options.quoteGas;
    config.rpOnly = options.rpOnly;
    config.dispair = {
        interpreter,
        store,
        deployer: options.dispair,
    };

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
    bundledOrders: BundledOrders[][],
    state: OperationState,
    tracer: Tracer,
    ctx: Context,
): Promise<RoundReport> {
    const version = versions.node;
    const majorVersion = Number(version.slice(0, version.indexOf(".")));

    if (majorVersion >= 18) return await processOrders(config, bundledOrders, state, tracer, ctx);
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
