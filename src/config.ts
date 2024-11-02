import { BigNumber } from "ethers";
import { getSgOrderbooks } from "./sg";
import { WNATIVE } from "sushi/currency";
import { ChainId, ChainKey } from "sushi/chain";
import { DataFetcher, LiquidityProviders } from "sushi/router";
import { BotConfig, BotDataFetcher, ChainConfig, ViemClient } from "./types";
import {
    createWalletClient,
    fallback,
    HDAccount,
    http,
    PrivateKeyAccount,
    publicActions,
    PublicClient,
    walletActions,
    webSocket,
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
    const configuration = { rank: false, retryCount: 6 };
    const urls = rpcs?.filter((v) => typeof v === "string") ?? [];
    const topRpcs = urls.map((v) =>
        v.startsWith("http")
            ? http(v, { timeout, onFetchRequest: config?.onFetchRequest, onFetchResponse: config?.onFetchResponse })
            : webSocket(v, { timeout, keepAlive: true, reconnect: true, onFetchRequest: config?.onFetchRequest, onFetchResponse: config?.onFetchResponse }),
    );
    const fallbacks = (fallbackRpcs[chainId] ?? [])
        .filter((v) => !urls.includes(v))
        .map((v) =>
            v.startsWith("http")
                ? http(v, { timeout, onFetchRequest: config?.onFetchRequest, onFetchResponse: config?.onFetchResponse })
                : webSocket(v, { timeout, keepAlive: true, reconnect: true, onFetchRequest: config?.onFetchRequest, onFetchResponse: config?.onFetchResponse }),
        );
    const transport = !topRpcs.length
        ? fallback(fallbacks, configuration)
        : useFallbacks
          ? fallback([...topRpcs, ...fallbacks], configuration)
          : fallback(topRpcs, configuration);

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
export const fallbackRpcs: Record<number, readonly string[]> = {
    [ChainId.ARBITRUM_NOVA]: ["https://nova.arbitrum.io/rpc"],
    [ChainId.ARBITRUM]: [
        "https://arbitrum.drpc.org",
        "https://arb-pokt.nodies.app",
        "https://1rpc.io/arb",
        "https://rpc.ankr.com/arbitrum",
        "https://arbitrum-one.public.blastapi.io",
        "https://endpoints.omniatech.io/v1/arbitrum/one/public",
        "https://arb1.croswap.com/rpc",
        "https://arbitrum.blockpi.network/v1/rpc/public",
        "https://arb-mainnet-public.unifra.io",
        "https://lb.drpc.org/ogrpc?network=arbitrum&dkey=Ak765fp4zUm6uVwKu4annC8M80dnCZkR7pAEsm6XXi_w",
    ],
    [ChainId.AVALANCHE]: [
        "https://api.avax.network/ext/bc/C/rpc",
        "https://rpc.ankr.com/avalanche",
    ],
    [ChainId.BOBA]: ["https://mainnet.boba.network", "https://lightning-replica.boba.network"],
    [ChainId.BOBA_AVAX]: ["https://avax.boba.network", "https://replica.avax.boba.network"],
    [ChainId.BOBA_BNB]: ["https://bnb.boba.network", "https://replica.bnb.boba.network"],
    [ChainId.BSC]: [
        "https://rpc.ankr.com/bsc",
        "https://bsc.blockpi.network/v1/rpc/public",
        "https://bsc-pokt.nodies.app",
        "https://bscrpc.com",
        "https://1rpc.io/bnb",
        "https://bsc.drpc.org",
        "https://bsc.meowrpc.com",
        "https://binance.llamarpc.com",
        "https://bsc-dataseed.binance.org",
        "https://bsc-dataseed1.binance.org",
        "https://bsc-dataseed2.binance.org",
        "https://lb.drpc.org/ogrpc?network=bsc&dkey=Ak765fp4zUm6uVwKu4annC8M80dnCZkR7pAEsm6XXi_w",
    ],
    [ChainId.BTTC]: ["https://rpc.bittorrentchain.io"],
    [ChainId.CELO]: ["https://forno.celo.org"],
    [ChainId.ETHEREUM]: [
        "https://eth-pokt.nodies.app",
        "https://eth.drpc.org",
        "https://ethereum-rpc.publicnode.com",
        "https://eth.llamarpc.com",
        "https://1rpc.io/eth",
        "https://ethereum.publicnode.com",
        "https://cloudflare-eth.com",
        "https://lb.drpc.org/ogrpc?network=ethereum&dkey=Ak765fp4zUm6uVwKu4annC8M80dnCZkR7pAEsm6XXi_w",
    ],
    [ChainId.FANTOM]: [
        "https://rpc.ankr.com/fantom",
        "https://rpc.fantom.network",
        "https://rpc2.fantom.network",
    ],
    [ChainId.FUSE]: ["https://rpc.fuse.io"],
    [ChainId.GNOSIS]: ["https://rpc.ankr.com/gnosis"],
    [ChainId.HARMONY]: ["https://api.harmony.one", "https://rpc.ankr.com/harmony"],
    [ChainId.KAVA]: ["https://evm.kava.io", "https://evm2.kava.io"],
    [ChainId.MOONBEAM]: ["https://rpc.api.moonbeam.network", "https://rpc.ankr.com/moonbeam"],
    [ChainId.MOONRIVER]: ["https://rpc.api.moonriver.moonbeam.network"],
    [ChainId.OPTIMISM]: [
        "https://rpc.ankr.com/optimism",
        "https://optimism-mainnet.public.blastapi.io",
        "https://1rpc.io/op",
        "https://optimism.blockpi.network/v1/rpc/public",
        "https://mainnet.optimism.io",
        "https://lb.drpc.org/ogrpc?network=optimism&dkey=Ak765fp4zUm6uVwKu4annC8M80dnCZkR7pAEsm6XXi_w",
    ],
    [ChainId.POLYGON]: [
        "https://polygon.meowrpc.com",
        "https://polygon-rpc.com",
        "https://polygon-pokt.nodies.app",
        "https://polygon-bor-rpc.publicnode.com",
        "https://1rpc.io/matic",
        "https://polygon-mainnet.public.blastapi.io",
        "https://polygon.blockpi.network/v1/rpc/public",
        "https://polygon.llamarpc.com",
        "https://polygon-rpc.com",
        "https://rpc.ankr.com/polygon",
        "https://matic-mainnet.chainstacklabs.com",
        "https://polygon-bor.publicnode.com",
        "https://rpc-mainnet.matic.quiknode.pro",
        "https://rpc-mainnet.maticvigil.com",
    ],
    [ChainId.POLYGON_ZKEVM]: [
        "https://zkevm-rpc.com",
        "https://rpc.ankr.com/polygon_zkevm",
        "https://rpc.polygon-zkevm.gateway.fm",
    ],
    [ChainId.THUNDERCORE]: [
        "https://mainnet-rpc.thundercore.com",
        "https://mainnet-rpc.thundercore.io",
        "https://mainnet-rpc.thundertoken.net",
    ],
    [ChainId.FLARE]: [
        "https://rpc.ankr.com/flare",
        "https://flare-api.flare.network/ext/C/rpc",
        "https://flare.rpc.thirdweb.com",
    ],
    [ChainId.LINEA]: [
        "https://linea.blockpi.network/v1/rpc/public",
        "https://rpc.linea.build",
        "https://linea-rpc.publicnode.com",
        "https://1rpc.io/linea",
        "https://linea.drpc.org",
    ],
    [ChainId.BASE]: [
        "https://base-rpc.publicnode.com",
        "https://base.blockpi.network/v1/rpc/public",
        "https://1rpc.io/base",
        "https://base-pokt.nodies.app",
        "https://mainnet.base.org",
        "https://base.meowrpc.com",
    ],
} as const;
