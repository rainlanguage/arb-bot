/* eslint-disable no-console */
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import Chains from "../chains.json";
import { shouldThrow } from "./error";
import { getSgOrderbooks } from "./sg";
import { sendTransaction } from "./tx";
import { WNATIVE } from "sushi/currency";
import { ChainId, ChainKey } from "sushi/chain";
import { normalizeUrl, RpcMetrics, RpcState } from "./rpc";
import { RainDataFetcher, LiquidityProviders } from "sushi/router";
import { BotConfig, ViemClient, ChainConfig, BotDataFetcher } from "./types";
import { rainSolverTransport, RainSolverTransportConfig } from "./transport";
import {
    HDAccount,
    PublicClient,
    publicActions,
    walletActions,
    PrivateKeyAccount,
    createWalletClient,
} from "viem";
import {
    STABLES,
    publicClientConfig,
    ROUTE_PROCESSOR_3_ADDRESS,
    ROUTE_PROCESSOR_4_ADDRESS,
    ROUTE_PROCESSOR_3_1_ADDRESS,
    ROUTE_PROCESSOR_3_2_ADDRESS,
} from "sushi/config";

/**
 * List of liquidity provider that are excluded
 */
export const ExcludedLiquidityProviders = [
    LiquidityProviders.CurveSwap,
    LiquidityProviders.Camelot,
    LiquidityProviders.Trident,
] as const;

/**
 * Get the chain config for a given chain id
 * @param chainId - The chain id
 */
export function getChainConfig(chainId: ChainId): ChainConfig {
    const chain = publicClientConfig[chainId].chain;
    if (!chain) throw new Error("network not supported");
    const nativeWrappedToken = WNATIVE[chainId];
    if (!nativeWrappedToken) throw new Error("network not supported");
    const routeProcessors: Record<string, `0x${string}`> = {};
    [
        ["3", ROUTE_PROCESSOR_3_ADDRESS],
        ["3.1", ROUTE_PROCESSOR_3_1_ADDRESS],
        ["3.2", ROUTE_PROCESSOR_3_2_ADDRESS],
        ["4", ROUTE_PROCESSOR_4_ADDRESS],
    ].forEach(([key, addresses]: any[]) => {
        const address = addresses[chainId];
        if (address) {
            routeProcessors[key] = address;
        }
    });
    const stableTokens = (STABLES as any)[chainId];
    return {
        chain,
        nativeWrappedToken,
        routeProcessors,
        stableTokens,
        isSpecialL2: SpecialL2Chains.is(chain.id),
    };
}

/**
 * Creates a viem client
 * @param chainId - The chain id
 * @param rpcState - rpc state
 * @param account - If fallback RPCs should be used as well or not
 * @param configuration - The rain solver transport configurations
 */
export async function createViemClient(
    chainId: ChainId,
    rpcState: RpcState,
    account?: HDAccount | PrivateKeyAccount,
    configuration?: RainSolverTransportConfig,
    testClient?: any,
): Promise<ViemClient> {
    const transport = rainSolverTransport(rpcState, configuration);

    const client = testClient
        ? ((await testClient({ account }))
              .extend(publicActions)
              .extend(walletActions) as any as ViemClient)
        : (createWalletClient({
              account,
              chain: publicClientConfig[chainId]?.chain,
              transport,
          }).extend(publicActions) as any as ViemClient);

    // set injected properties
    client.BUSY = false;
    client.sendTx = async (tx) => {
        return await sendTransaction(client, tx);
    };

    return client;
}

/**
 * Keeps record of http fetch requests for a http viem client
 */
export function onFetchRequest(this: RpcState, request: Request) {
    const url = normalizeUrl(request.url);
    let record = this.metrics[url];
    if (!record) {
        record = this.metrics[url] = new RpcMetrics();
    }
    record.recordRequest();
}

/**
 * Keeps record of http fetch responses for a http viem client
 */
export async function onFetchResponse(this: RpcState, response: Response) {
    const _response = response.clone();
    const url = normalizeUrl(_response.url);
    let record = this.metrics[url];
    if (!record) {
        // this cannot really happen, but just to be sure,
        // initialize this rpc record if its not already
        record = this.metrics[url] = new RpcMetrics();
        record.recordRequest();
    }

    if (!_response.ok) {
        record.recordFailure();
        return;
    }

    const handleResponse = (res: any) => {
        if ("result" in res) {
            record.recordSuccess();
            return;
        } else if ("error" in res) {
            if (shouldThrow(res.error)) {
                record.recordSuccess();
                return;
            }
        }
        record.recordFailure();
    };
    if (_response.headers.get("Content-Type")?.startsWith("application/json")) {
        await _response
            .json()
            .then((res: any) => {
                handleResponse(res);
            })
            .catch(() => {
                record.recordFailure();
            });
    } else {
        await _response
            .text()
            .then((text) => {
                try {
                    const res = JSON.parse(text || "{}");
                    handleResponse(res);
                } catch (err) {
                    record.recordFailure();
                }
            })
            .catch(() => {
                record.recordFailure();
            });
    }
}

/**
 * Instantiates a RainDataFetcher
 * @param configOrViemClient - The network config data or a viem public client
 * @param rpcState - rpc state
 * @param liquidityProviders - Array of Liquidity Providers
 * @param configuration - The rain solver transport configurations
 */
export async function getDataFetcher(
    configOrViemClient: BotConfig | PublicClient,
    rpcState: RpcState,
    liquidityProviders: LiquidityProviders[] = [],
    configuration?: RainSolverTransportConfig,
): Promise<BotDataFetcher> {
    try {
        const dataFetcher = await RainDataFetcher.init(
            configOrViemClient.chain!.id as ChainId,
            "transport" in configOrViemClient
                ? (configOrViemClient as PublicClient)
                : ((await createViemClient(
                      configOrViemClient.chain.id as ChainId,
                      rpcState,
                      undefined,
                      configuration,
                      undefined,
                  )) as any as PublicClient),
            liquidityProviders,
        );
        return dataFetcher as BotDataFetcher;
    } catch (error) {
        throw "cannot instantiate RainDataFetcher for this network";
    }
}

/**
 * List of L2 chains that require SEPARATE L1 gas actions.
 * other L2 chains that dont require separate L1 gas actions
 * such as Arbitrum and Polygon zkEvm are excluded, these chains'
 * gas actions are performed the same as usual L1 chains.
 */
export enum SpecialL2Chains {
    BASE = ChainId.BASE,
    OPTIMISM = ChainId.OPTIMISM,
}
export namespace SpecialL2Chains {
    export function is(chainId: number): boolean {
        return Object.values(SpecialL2Chains).includes(chainId as any);
    }
}

/**
 * Get meta info for a bot to post on otel
 */
export async function getMetaInfo(config: BotConfig, sg: string[]): Promise<Record<string, any>> {
    const obs: string[] = [];
    for (const s of sg) {
        try {
            obs.push(...(await getSgOrderbooks(s)));
        } catch {
            /**/
        }
    }
    try {
        return {
            "meta.chain": ChainKey[config.chain.id as ChainId],
            "meta.chainId": config.chain.id,
            "meta.sg": sg,
            "meta.rpArb": config.arbAddress,
            "meta.genericArb": config.genericArbAddress,
            "meta.orderbooks": obs,
        };
    } catch (e) {
        return {};
    }
}

/**
 * Resolves an array of case-insensitive names to LiquidityProviders, ignores the ones that are not valid
 * @param liquidityProviders - List of liquidity providers
 */
export function processLps(liquidityProviders?: string[]): LiquidityProviders[] {
    const LP = Object.values(LiquidityProviders);
    if (
        !liquidityProviders ||
        !Array.isArray(liquidityProviders) ||
        !liquidityProviders.length ||
        !liquidityProviders.every((v) => typeof v === "string")
    ) {
        return LP.filter((v) => !ExcludedLiquidityProviders.includes(v as any));
    }
    const lps: LiquidityProviders[] = [];
    for (let i = 0; i < liquidityProviders.length; i++) {
        const index = LP.findIndex(
            (v) => v.toLowerCase() === liquidityProviders[i].toLowerCase().trim(),
        );
        if (index > -1 && !lps.includes(LP[index])) lps.push(LP[index]);
    }
    return lps.length ? lps : LP.filter((v) => !ExcludedLiquidityProviders.includes(v as any));
}

/**
 * Chain specific public rpcs
 */
export const publicRpcs: Record<number, string[]> = (() => {
    const chainRpcs: Record<number, string[]> = {};
    Chains.forEach((chainConfig: any) => {
        chainRpcs[chainConfig.chainId] = chainConfig.rpc
            .map((v: any) => v.url)
            .filter((v: string) => v.startsWith("http"));
    });
    return chainRpcs;
})();
