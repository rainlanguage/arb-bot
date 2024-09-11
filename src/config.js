const { getSgOrderbooks } = require("./sg");
const { WNATIVE } = require("sushi/currency");
const { DataFetcher } = require("sushi/router");
const { ChainId, ChainKey } = require("sushi/chain");
const { createPublicClient, http, fallback } = require("viem");
const {
    STABLES,
    publicClientConfig,
    ROUTE_PROCESSOR_3_ADDRESS,
    ROUTE_PROCESSOR_4_ADDRESS,
    ROUTE_PROCESSOR_3_2_ADDRESS,
    ROUTE_PROCESSOR_3_1_ADDRESS,
} = require("sushi/config");

/**
 * @param {ChainId} chainId - The network chain id
 */
function getChainConfig(chainId) {
    const chain = publicClientConfig[chainId].chain;
    if (!chain) throw new Error("network not supported");
    const nativeWrappedToken = WNATIVE[chainId];
    if (!nativeWrappedToken) throw new Error("network not supported");
    const routeProcessors = {};
    [
        ["3", ROUTE_PROCESSOR_3_ADDRESS],
        ["3.1", ROUTE_PROCESSOR_3_1_ADDRESS],
        ["3.2", ROUTE_PROCESSOR_3_2_ADDRESS],
        ["4", ROUTE_PROCESSOR_4_ADDRESS],
    ].forEach(([key, addresses]) => {
        const address = addresses[chainId];
        if (address) {
            routeProcessors[key] = address;
        }
    });
    const stableTokens = STABLES[chainId];
    return {
        chain,
        nativeWrappedToken,
        routeProcessors,
        stableTokens
    };
}

/**
 * Creates a viem client
 * @param {number} chainId - The chain id
 * @param {string[]} rpcs - The RPC urls
 * @param {boolean} useFallbacs - If fallback RPCs should be used as well or not
 */
function createViemClient(chainId, rpcs, useFallbacs = false) {
    const transport = !rpcs || rpcs?.includes("test") || rpcs?.length === 0
        ? fallback(fallbacks[chainId].transport, { rank: false, retryCount: 6 })
        : useFallbacs
            ? fallback(
                [...rpcs.map(v => http(v)), ...fallbacks[chainId].transport],
                { rank: false, retryCount: 6 }
            )
            : fallback(rpcs.map(v => http(v)), { rank: false, retryCount: 6 });

    return createPublicClient({
        chain: publicClientConfig[chainId]?.chain,
        transport,
        // batch: {
        //     multicall: {
        //         batchSize: 512
        //     },
        // },
        // pollingInterval: 8_000,
    });
}

/**
 * Instantiates a DataFetcher
 * @param {any} configOrViemClient - The network config data or a viem public client
 * @param {LiquidityProviders[]} liquidityProviders - Array of Liquidity Providers
 */
function getDataFetcher(configOrViemClient, liquidityProviders = [], useFallbacks = false) {
    try {
        const dataFetcher = new DataFetcher(
            ("transport" in configOrViemClient
                ? configOrViemClient.chain.id
                : configOrViemClient.chain.id
            ),
            ("transport" in configOrViemClient
                ? configOrViemClient
                : createViemClient(
                    configOrViemClient.chain.id,
                    configOrViemClient.rpc,
                    useFallbacks
                )
            )
        );

        // start and immediately stop data fetching as we only want data fetching on demand
        dataFetcher.startDataFetching(
            !liquidityProviders.length ? undefined : liquidityProviders
        );
        dataFetcher.stopDataFetching();
        dataFetcher.fetchedPairPools = [];
        return dataFetcher;
    }
    catch(error) {
        throw "cannot instantiate DataFetcher for this network";
    }
}

/**
 * Get the bounty check ensure task bytecode
 * @param {import("ethers").BigNumber} inputToEthPrice - Input token to Eth price
 * @param {import("ethers").BigNumber} outputToEthPrice - Output token to Eth price
 * @param {import("ethers").BigNumber} minimumExcepted - Minimum expected amount
 */
function getBountyEnsureBytecode(
    inputToEthPrice,
    outputToEthPrice,
    minimumExcepted,
) {
    const inputPrice = inputToEthPrice.toHexString().substring(2).padStart(64, "0");
    const outputPrice = outputToEthPrice.toHexString().substring(2).padStart(64, "0");
    const minimum = minimumExcepted.toHexString().substring(2).padStart(64, "0");
    // rainlang bytecode:
    // :ensure(
    //   greater-than-or-equal-to(
    //     add(
    //       mul(inputToEthPrice context<0 0>())
    //       mul(outputToEthPrice context<0 1>())
    //     )
    //     minimumExcepted
    //   )
    //   \"minimum sender output\"
    // );
    return `0x0000000000000000000000000000000000000000000000000000000000000004${inputPrice}${outputPrice}${minimum}956d696e696d756d2073656e646572206f75747075740000000000000000000000000000000000000000000000000000000000000000000000000000000000330100000b050000011000030110000203100100011000013d12000003100000011000003d1200002b120000211200001d020000`;
}

/**
 * Get the bounty check ensure task bytecode for clear2 withdraw
 * @param {string} botAddress - Bot wallet address
 * @param {string} inputToken - Input token address
 * @param {string} outputToken - Output token address
 * @param {import("ethers").BigNumber} orgInputBalance - Input token original balance
 * @param {import("ethers").BigNumber} orgOutputBalance - Output token original balance
 * @param {import("ethers").BigNumber} inputToEthPrice - Input token to Eth price
 * @param {import("ethers").BigNumber} outputToEthPrice - Output token to Eth price
 * @param {import("ethers").BigNumber} minimumExcepted - Minimum expected amount
 */
function getWithdrawEnsureBytecode(
    botAddress,
    inputToken,
    outputToken,
    orgInputBalance,
    orgOutputBalance,
    inputToEthPrice,
    outputToEthPrice,
    minimumExcepted,
) {
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
async function getMetaInfo(config, sg) {
    try {
        return {
            "meta.chain": ChainKey[config.chain.id],
            "meta.chainId": config.chain.id,
            "meta.sg": sg,
            "meta.rpArb": config.arbAddress,
            "meta.genericArb": config.genericArbAddress,
            "meta.orderbooks": await getSgOrderbooks(sg),
        };
    } catch(e) {
        return {};
    }
}

/**
 * Chain specific fallback data
 */
const fallbacks = {
    [ChainId.ARBITRUM_NOVA]: {
        transport: http("https://nova.arbitrum.io/rpc"),
        liquidityProviders: [
            "sushiswapv3",
            "sushiswapv2"
        ]
    },
    [ChainId.ARBITRUM]: {
        transport: [
            http("https://lb.drpc.org/ogrpc?network=arbitrum&dkey=Ak765fp4zUm6uVwKu4annC8M80dnCZkR7pAEsm6XXi_w"),
            http("https://rpc.ankr.com/arbitrum"),
            http("https://arbitrum-one.public.blastapi.io"),
            http("https://endpoints.omniatech.io/v1/arbitrum/one/public"),
            http("https://arb1.croswap.com/rpc"),
            http("https://1rpc.io/arb"),
            http("https://arbitrum.blockpi.network/v1/rpc/public"),
            http("https://arb-mainnet-public.unifra.io"),
        ],
        liquidityProviders: [
            "dfyn",
            "elk",
            "sushiswapv3",
            "uniswapv3",
            "sushiswapv2",
            "camelot"
        ]
    },
    [ChainId.AVALANCHE]: {
        transport: [
            http("https://api.avax.network/ext/bc/C/rpc"),
            http("https://rpc.ankr.com/avalanche")
        ],
        liquidityProviders: [
            "elk",
            "traderjoe",
            "sushiswapv3",
            "sushiswapv2"
        ]
    },
    [ChainId.BOBA]: {
        transport: [
            http("https://mainnet.boba.network"),
            http("https://lightning-replica.boba.network")
        ],
        liquidityProviders: [
            "sushiswapv3",
            "sushiswapv2"
        ]
    },
    [ChainId.BOBA_AVAX]: {
        transport: [
            http("https://avax.boba.network"),
            http("https://replica.avax.boba.network")
        ],
        liquidityProviders: [
            "sushiswapv2"
        ]
    },
    [ChainId.BOBA_BNB]: {
        transport: [
            http("https://bnb.boba.network"),
            http("https://replica.bnb.boba.network")
        ],
        liquidityProviders: [
            "sushiswapv2"
        ]
    },
    [ChainId.BSC]: {
        transport: [
            http("https://rpc.ankr.com/bsc"),
            http("https://lb.drpc.org/ogrpc?network=bsc&dkey=Ak765fp4zUm6uVwKu4annC8M80dnCZkR7pAEsm6XXi_w"),
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
            "uniswapv3"
        ]
    },
    [ChainId.BTTC]: {
        transport: http("https://rpc.bittorrentchain.io"),
    },
    [ChainId.CELO]: {
        transport: http("https://forno.celo.org"),
        liquidityProviders: [
            "ubeswap",
            "sushiswapv2"
        ]
    },
    [ChainId.ETHEREUM]: {
        transport: [
            http("https://lb.drpc.org/ogrpc?network=ethereum&dkey=Ak765fp4zUm6uVwKu4annC8M80dnCZkR7pAEsm6XXi_w"),
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
            "uniswapv3"
        ]
    },
    [ChainId.FANTOM]: {
        transport: [
            http("https://rpc.ankr.com/fantom"),
            http("https://rpc.fantom.network"),
            http("https://rpc2.fantom.network"),
        ],
        liquidityProviders: [
            "dfyn",
            "elk",
            "jetswap",
            "spookyswap",
            "sushiswapv3",
            "sushiswapv2"
        ]
    },
    [ChainId.FUSE]: {
        transport: http("https://rpc.fuse.io"),
        liquidityProviders: [
            "elk",
            "sushiswapv3",
            "sushiswapv2"
        ]
    },
    [ChainId.GNOSIS]: {
        transport: http("https://rpc.ankr.com/gnosis"),
        liquidityProviders: [
            "elk",
            "honeyswap",
            "sushiswapv3",
            "sushiswapv2"
        ]
    },
    [ChainId.HARMONY]: {
        transport: [
            http("https://api.harmony.one"),
            http("https://rpc.ankr.com/harmony")
        ],
        liquidityProviders: [
            "sushiswapv2"
        ]
    },
    [ChainId.KAVA]: {
        transport: [
            http("https://evm.kava.io"),
            http("https://evm2.kava.io"),
        ],
        liquidityProviders: [
            "elk"
        ]
    },
    [ChainId.MOONBEAM]: {
        transport: [
            http("https://rpc.api.moonbeam.network"),
            http("https://rpc.ankr.com/moonbeam")
        ],
        liquidityProviders: [
            "sushiswapv2"
        ]
    },
    [ChainId.MOONRIVER]: {
        transport: http("https://rpc.api.moonriver.moonbeam.network"),
        liquidityProviders: [
            "elk",
            "sushiswapv3",
            "sushiswapv2"
        ]
    },
    [ChainId.OPTIMISM]: {
        transport: [
            http("https://lb.drpc.org/ogrpc?network=optimism&dkey=Ak765fp4zUm6uVwKu4annC8M80dnCZkR7pAEsm6XXi_w"),
            http("https://rpc.ankr.com/optimism"),
            http("https://optimism-mainnet.public.blastapi.io"),
            http("https://1rpc.io/op"),
            http("https://optimism.blockpi.network/v1/rpc/public"),
            http("https://mainnet.optimism.io"),
        ],
        liquidityProviders: [
            "elk",
            "sushiswapv3",
            "uniswapv3"
        ]
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
            "uniswapv3"
        ]
    },
    [ChainId.POLYGON_ZKEVM]: {
        transport: [
            http("https://zkevm-rpc.com"),
            http("https://rpc.ankr.com/polygon_zkevm"),
            http("https://rpc.polygon-zkevm.gateway.fm"),
        ],
        liquidityProviders: [
            "dovishv3",
            "sushiswapv3"
        ]
    },
    [ChainId.THUNDERCORE]: {
        transport: [
            http("https://mainnet-rpc.thundercore.com"),
            http("https://mainnet-rpc.thundercore.io"),
            http("https://mainnet-rpc.thundertoken.net"),
        ],
        liquidityProviders: [
            "laserswap",
            "sushiswapv3"
        ]
    },
    // flare
    14: {
        transport: [
            http("https://rpc.ankr.com/flare"),
            http("https://flare-api.flare.network/ext/C/rpc"),
            http("https://flare.rpc.thirdweb.com")
        ],
        liquidityProviders: [
            "enosys",
            "blazeswap"
        ]
    },
};

module.exports = {
    getDataFetcher,
    createViemClient,
    getChainConfig,
    getBountyEnsureBytecode,
    getWithdrawEnsureBytecode,
    fallbacks,
    getMetaInfo,
};
