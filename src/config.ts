import { BigNumber } from "ethers";
import { getSgOrderbooks } from "./sg";
import { WNATIVE } from "sushi/currency";
import { ChainId, ChainKey } from "sushi/chain";
import { DataFetcher, LiquidityProviders } from "sushi/router";
import {
    BotConfig,
    RpcRecord,
    ViemClient,
    ChainConfig,
    isRpcResponse,
    BotDataFetcher,
} from "./types";
import {
    http,
    fallback,
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
    };
}

/**
 * Creates a viem client
 * @param chainId - The chain id
 * @param rpcs - The RPC urls
 * @param useFallbacks - If fallback RPCs should be used as well or not
 * @param account - If fallback RPCs should be used as well or not
 * @param timeout
 */
export async function createViemClient(
    chainId: ChainId,
    rpcs: string[],
    useFallbacks = false,
    account?: HDAccount | PrivateKeyAccount,
    timeout?: number,
    testClient?: any,
    config?: BotConfig,
): Promise<ViemClient> {
    const transport =
        !rpcs || rpcs?.length === 0
            ? fallback(fallbacks[chainId].transport, { rank: false, retryCount: 3 })
            : useFallbacks
              ? fallback(
                    [
                        ...rpcs.map((v) =>
                            http(v, {
                                timeout,
                                onFetchRequest: config?.onFetchRequest,
                                onFetchResponse: config?.onFetchResponse,
                            }),
                        ),
                        ...fallbacks[chainId].transport,
                    ],
                    { rank: false, retryCount: 3 },
                )
              : fallback(
                    rpcs.map((v) =>
                        http(v, {
                            timeout,
                            onFetchRequest: config?.onFetchRequest,
                            onFetchResponse: config?.onFetchResponse,
                        }),
                    ),
                    { rank: false, retryCount: 3 },
                );

    return testClient
        ? ((await testClient({ account }))
              .extend(publicActions)
              .extend(walletActions) as any as ViemClient)
        : (createWalletClient({
              account,
              chain: publicClientConfig[chainId]?.chain,
              transport,
          }).extend(publicActions) as any as ViemClient);
}

/**
 * Keeps record of http fetch requests for a http viem client
 */
export function onFetchRequest(request: Request, rpcRecords: Record<string, RpcRecord>) {
    let url = request.url;
    if (!request.url.endsWith("/")) url = url + "/";
    let record = rpcRecords[url];
    if (!record) {
        record = rpcRecords[url] = {
            req: 0,
            success: 0,
            failure: 0,
            cache: {},
        };
    }
    record.req++;
}

/**
 * Keeps record of http fetch responses for a http viem client
 */
export function onFetchResponse(response: Response, rpcRecords: Record<string, RpcRecord>) {
    let url = response.url;
    if (!response.url.endsWith("/")) url = url + "/";
    let record = rpcRecords[url];
    if (!record) {
        record = rpcRecords[url] = {
            req: 0,
            success: 0,
            failure: 0,
            cache: {},
        };
    }
    if (response.status !== 200) record.failure++;

    // for clearing the cache we need to explicitly parse the results even
    // if response status was not 200 but still can hold valid rpc obj id
    response
        .json()
        .then((v) => {
            if (isRpcResponse(v)) {
                if (response.status === 200) {
                    if ("result" in v) record.success++;
                    else record.failure++;
                }
            } else if (response.status === 200) record.failure++;
        })
        .catch(() => {
            if (response.status === 200) record.failure++;
        });
}

/**
 * Instantiates a DataFetcher
 * @param configOrViemClient - The network config data or a viem public client
 * @param liquidityProviders - Array of Liquidity Providers
 */
export async function getDataFetcher(
    configOrViemClient: BotConfig | PublicClient,
    liquidityProviders: LiquidityProviders[] = [],
    useFallbacks = false,
): Promise<BotDataFetcher> {
    try {
        const dataFetcher = new DataFetcher(
            configOrViemClient.chain!.id as ChainId,
            "transport" in configOrViemClient
                ? (configOrViemClient as PublicClient)
                : ((await createViemClient(
                      configOrViemClient.chain.id as ChainId,
                      configOrViemClient.rpc,
                      useFallbacks,
                      undefined,
                      undefined,
                  )) as any as PublicClient),
        );

        // start and immediately stop data fetching as we only want data fetching on demand
        dataFetcher.startDataFetching(!liquidityProviders.length ? undefined : liquidityProviders);
        dataFetcher.stopDataFetching();
        (dataFetcher as any).fetchedPairPools = [];
        return dataFetcher as BotDataFetcher;
    } catch (error) {
        throw "cannot instantiate DataFetcher for this network";
    }
}

/**
 * Get the bounty check ensure task bytecode
 * @param inputToEthPrice - Input token to Eth price
 * @param outputToEthPrice - Output token to Eth price
 * @param minimumExcepted - Minimum expected amount
 */
export function getBountyEnsureBytecode(
    inputToEthPrice: BigNumber,
    outputToEthPrice: BigNumber,
    minimumExcepted: BigNumber,
): string {
    const inputPrice = inputToEthPrice.toHexString().substring(2).padStart(64, "0");
    const outputPrice = outputToEthPrice.toHexString().substring(2).padStart(64, "0");
    const minimum = minimumExcepted.toHexString().substring(2).padStart(64, "0");
    // rainlang bytecode:
    // :ensure(
    //   greater-than-or-equal-to(
    //     add(
    //       mul(inputToEthPrice context<1 0>())
    //       mul(outputToEthPrice context<1 1>())
    //     )
    //     minimumExcepted
    //   )
    //   \"minimum sender output\"
    // );
    return `0x0000000000000000000000000000000000000000000000000000000000000004${inputPrice}${outputPrice}${minimum}956d696e696d756d2073656e646572206f757470757400000000000000000000000000000000000000000000000000000000000000000000000000000000003b0100000d06000203100001011000003d12000003100101011000013d120000011000030110000200100001001000002b120000211200001d020000`;
}

/**
 * Get the bounty check ensure task bytecode for clear2 withdraw
 * @param botAddress - Bot wallet address
 * @param inputToken - Input token address
 * @param outputToken - Output token address
 * @param orgInputBalance - Input token original balance
 * @param orgOutputBalance - Output token original balance
 * @param inputToEthPrice - Input token to Eth price
 * @param outputToEthPrice - Output token to Eth price
 * @param minimumExcepted - Minimum expected amount
 */
export function getWithdrawEnsureBytecode(
    botAddress: string,
    inputToken: string,
    outputToken: string,
    orgInputBalance: BigNumber,
    orgOutputBalance: BigNumber,
    inputToEthPrice: BigNumber,
    outputToEthPrice: BigNumber,
    minimumExcepted: BigNumber,
): string {
    const bot = botAddress.substring(2).padStart(64, "0");
    const input = inputToken.substring(2).padStart(64, "0");
    const output = outputToken.substring(2).padStart(64, "0");
    const inputBalance = orgInputBalance.toHexString().substring(2).padStart(64, "0");
    const outputBalance = orgOutputBalance.toHexString().substring(2).padStart(64, "0");
    const inputPrice = inputToEthPrice.toHexString().substring(2).padStart(64, "0");
    const outputPrice = outputToEthPrice.toHexString().substring(2).padStart(64, "0");
    const minimum = minimumExcepted.toHexString().substring(2).padStart(64, "0");
    // rainlang bytecode:
    // :ensure(
    //   greater-than-or-equal-to(
    //     add(
    //       mul(sub(erc20-balance-of(inputToken botAddress) originalInputBalance) inputToEthPrice)
    //       mul(sub(erc20-balance-of(outputToken botAddress) originalOutputBalance) outputToEthPrice)
    //     )
    //     minimumSenderOutput
    //   )
    //   \"minimumSenderOutput\"
    // );
    return `0x0000000000000000000000000000000000000000000000000000000000000009${input}${bot}${inputBalance}${inputPrice}${output}${outputBalance}${outputPrice}${minimum}936d696e696d756d53656e6465724f757470757400000000000000000000000000000000000000000000000000000000000000000000000000000000000000530100001307000001100008011000070110000601100005011000010110000411120000471200003d1200000110000301100002011000010110000011120000471200003d1200002b120000211200001d020000`;
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
 * Chain specific fallback data
 */
export const fallbacks: Record<number, any> = {
    [ChainId.ARBITRUM_NOVA]: {
        transport: http("https://nova.arbitrum.io/rpc"),
        liquidityProviders: ["sushiswapv3", "sushiswapv2"],
    },
    [ChainId.ARBITRUM]: {
        transport: [
            http(
                "https://lb.drpc.org/ogrpc?network=arbitrum&dkey=Ak765fp4zUm6uVwKu4annC8M80dnCZkR7pAEsm6XXi_w",
            ),
            http("https://rpc.ankr.com/arbitrum"),
            http("https://arbitrum-one.public.blastapi.io"),
            http("https://endpoints.omniatech.io/v1/arbitrum/one/public"),
            http("https://arb1.croswap.com/rpc"),
            http("https://1rpc.io/arb"),
            http("https://arbitrum.blockpi.network/v1/rpc/public"),
            http("https://arb-mainnet-public.unifra.io"),
        ],
        liquidityProviders: ["dfyn", "elk", "sushiswapv3", "uniswapv3", "sushiswapv2", "camelot"],
    },
    [ChainId.AVALANCHE]: {
        transport: [
            http("https://api.avax.network/ext/bc/C/rpc"),
            http("https://rpc.ankr.com/avalanche"),
        ],
        liquidityProviders: ["elk", "traderjoe", "sushiswapv3", "sushiswapv2"],
    },
    [ChainId.BOBA]: {
        transport: [
            http("https://mainnet.boba.network"),
            http("https://lightning-replica.boba.network"),
        ],
        liquidityProviders: ["sushiswapv3", "sushiswapv2"],
    },
    [ChainId.BOBA_AVAX]: {
        transport: [http("https://avax.boba.network"), http("https://replica.avax.boba.network")],
        liquidityProviders: ["sushiswapv2"],
    },
    [ChainId.BOBA_BNB]: {
        transport: [http("https://bnb.boba.network"), http("https://replica.bnb.boba.network")],
        liquidityProviders: ["sushiswapv2"],
    },
    [ChainId.BSC]: {
        transport: [
            http("https://rpc.ankr.com/bsc"),
            http(
                "https://lb.drpc.org/ogrpc?network=bsc&dkey=Ak765fp4zUm6uVwKu4annC8M80dnCZkR7pAEsm6XXi_w",
            ),
            http("https://bsc-dataseed.binance.org"),
            http("https://bsc-dataseed1.binance.org"),
            http("https://bsc-dataseed2.binance.org"),
        ],
        liquidityProviders: [
            "apeswap",
            "biswap",
            "elk",
            "jetswap",
            "pancakeswap",
            "sushiswapv3",
            "sushiswapv2",
            "uniswapv3",
        ],
    },
    [ChainId.BTTC]: {
        transport: http("https://rpc.bittorrentchain.io"),
    },
    [ChainId.CELO]: {
        transport: http("https://forno.celo.org"),
        liquidityProviders: ["ubeswap", "sushiswapv2"],
    },
    [ChainId.ETHEREUM]: {
        transport: [
            http(
                "https://lb.drpc.org/ogrpc?network=ethereum&dkey=Ak765fp4zUm6uVwKu4annC8M80dnCZkR7pAEsm6XXi_w",
            ),
            http("https://eth.llamarpc.com"),
            // http('https://eth.rpc.blxrbdn.com'),
            // http('https://virginia.rpc.blxrbdn.com'),
            // http('https://singapore.rpc.blxrbdn.com'),
            // http('https://uk.rpc.blxrbdn.com'),
            http("https://1rpc.io/eth"),
            http("https://ethereum.publicnode.com"),
            http("https://cloudflare-eth.com"),
        ],
        liquidityProviders: [
            "apeswap",
            "curveswap",
            "elk",
            "pancakeswap",
            "sushiswapv3",
            "sushiswapv2",
            "uniswapv2",
            "uniswapv3",
        ],
    },
    [ChainId.FANTOM]: {
        transport: [
            http("https://rpc.ankr.com/fantom"),
            http("https://rpc.fantom.network"),
            http("https://rpc2.fantom.network"),
        ],
        liquidityProviders: ["dfyn", "elk", "jetswap", "spookyswap", "sushiswapv3", "sushiswapv2"],
    },
    [ChainId.FUSE]: {
        transport: http("https://rpc.fuse.io"),
        liquidityProviders: ["elk", "sushiswapv3", "sushiswapv2"],
    },
    [ChainId.GNOSIS]: {
        transport: http("https://rpc.ankr.com/gnosis"),
        liquidityProviders: ["elk", "honeyswap", "sushiswapv3", "sushiswapv2"],
    },
    [ChainId.HARMONY]: {
        transport: [http("https://api.harmony.one"), http("https://rpc.ankr.com/harmony")],
        liquidityProviders: ["sushiswapv2"],
    },
    [ChainId.KAVA]: {
        transport: [http("https://evm.kava.io"), http("https://evm2.kava.io")],
        liquidityProviders: ["elk"],
    },
    [ChainId.MOONBEAM]: {
        transport: [
            http("https://rpc.api.moonbeam.network"),
            http("https://rpc.ankr.com/moonbeam"),
        ],
        liquidityProviders: ["sushiswapv2"],
    },
    [ChainId.MOONRIVER]: {
        transport: http("https://rpc.api.moonriver.moonbeam.network"),
        liquidityProviders: ["elk", "sushiswapv3", "sushiswapv2"],
    },
    [ChainId.OPTIMISM]: {
        transport: [
            http(
                "https://lb.drpc.org/ogrpc?network=optimism&dkey=Ak765fp4zUm6uVwKu4annC8M80dnCZkR7pAEsm6XXi_w",
            ),
            http("https://rpc.ankr.com/optimism"),
            http("https://optimism-mainnet.public.blastapi.io"),
            http("https://1rpc.io/op"),
            http("https://optimism.blockpi.network/v1/rpc/public"),
            http("https://mainnet.optimism.io"),
        ],
        liquidityProviders: ["elk", "sushiswapv3", "uniswapv3"],
    },
    [ChainId.POLYGON]: {
        transport: [
            http("https://polygon.llamarpc.com"),
            // http('https://polygon.rpc.blxrbdn.com'),
            http("https://polygon-mainnet.public.blastapi.io"),
            http("https://polygon.blockpi.network/v1/rpc/public"),
            http("https://polygon-rpc.com"),
            http("https://rpc.ankr.com/polygon"),
            http("https://matic-mainnet.chainstacklabs.com"),
            http("https://polygon-bor.publicnode.com"),
            http("https://rpc-mainnet.matic.quiknode.pro"),
            http("https://rpc-mainnet.maticvigil.com"),
            // ...polygon.rpcUrls.default.http.map((url) => http(url)),
        ],
        liquidityProviders: [
            "apeswap",
            "dfyn",
            "elk",
            "jetswap",
            "quickswap",
            "sushiswapv3",
            "sushiswapv2",
            "uniswapv3",
        ],
    },
    [ChainId.POLYGON_ZKEVM]: {
        transport: [
            http("https://zkevm-rpc.com"),
            http("https://rpc.ankr.com/polygon_zkevm"),
            http("https://rpc.polygon-zkevm.gateway.fm"),
        ],
        liquidityProviders: ["dovishv3", "sushiswapv3"],
    },
    [ChainId.THUNDERCORE]: {
        transport: [
            http("https://mainnet-rpc.thundercore.com"),
            http("https://mainnet-rpc.thundercore.io"),
            http("https://mainnet-rpc.thundertoken.net"),
        ],
        liquidityProviders: ["laserswap", "sushiswapv3"],
    },
    // flare
    14: {
        transport: [
            http("https://rpc.ankr.com/flare"),
            http("https://flare-api.flare.network/ext/C/rpc"),
            http("https://flare.rpc.thirdweb.com"),
        ],
        liquidityProviders: ["enosys", "blazeswap"],
    },
} as const;
