const { ChainId } = require("sushi/chain");
const { ethers, BigNumber } = require("ethers");
const { Token, WNATIVE } = require("sushi/currency");
const { erc20Abi, orderbookAbi } = require("./abis");
const { createPublicClient, http, fallback, parseAbi } = require("viem");
const { DataFetcher, Router, LiquidityProviders } = require("sushi/router");
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

/**
 * convert float numbers to big number
 *
 * @param {any} float - Any form of number
 * @param {number} decimals - Decimals point of the number
 * @returns ethers BigNumber with decimals point
 */
const bnFromFloat = (float, decimals = 18) => {
    if (typeof float == "string") {
        if (float.startsWith("0x")) {
            const num = BigInt(float).toString();
            return BigNumber.from(num.padEnd(num.length + decimals), "0");
        }
        else {
            if (float.includes(".")) {
                const offset = decimals - float.slice(float.indexOf(".") + 1).length;
                float = offset < 0 ? float.slice(0, offset) : float;
            }
            return ethers.utils.parseUnits(float, decimals);
        }
    }
    else {
        try {
            float = float.toString();
            return bnFromFloat(float, decimals);
        }
        catch {
            return undefined;
        }

    }
};

/**
 * Convert a BigNumber to a fixed 18 point BigNumber
 *
 * @param {BigNumber} bn - The BigNumber to convert
 * @param {number} decimals - The decimals point of the given BigNumber
 * @returns A 18 fixed point BigNumber
 */
const toFixed18 = (bn, decimals) => {
    const num = bn.toBigInt().toString();
    return BigNumber.from(
        num + "0".repeat(18 - decimals)
    );
};

/**
 * Convert a 18 fixed point BigNumber to a  BigNumber with some other decimals point
 *
 * @param {BigNumber} bn - The BigNumber to convert
 * @param {number} decimals - The decimals point of convert the given BigNumber
 * @returns A decimals point BigNumber
 */
const fromFixed18 = (bn, decimals) => {
    if (decimals != 18) {
        const num = bn.toBigInt().toString();
        return BigNumber.from(
            num.slice(0, decimals - 18)
        );
    }
    else return bn;
};

/**
 * Constructs Order struct from the result of sg default query
 *
 * @param {object} orderDetails - The order details fetched from sg
 * @returns The order struct as js object
 */
const getOrderStruct = (orderDetails) => {
    return {
        owner: orderDetails.owner.id,
        handleIO: orderDetails.handleIO,
        evaluable: {
            interpreter: orderDetails.interpreter,
            store: orderDetails.interpreterStore,
            expression: orderDetails.expression
        },
        validInputs: orderDetails.validInputs.map(v => {
            return {
                token: v.token.id,
                decimals: Number(v.token.decimals),
                vaultId: v.vault.id.split("-")[0]
            };
        }),
        validOutputs: orderDetails.validOutputs.map(v => {
            return {
                token: v.token.id,
                decimals: Number(v.token.decimals),
                vaultId: v.vault.id.split("-")[0]
            };
        })
    };
};

/**
 * Waits for provided miliseconds
 * @param {number} ms - Miliseconds to wait
 */
const sleep = async(ms, msg = "") => {
    let _timeoutReference;
    return new Promise(
        resolve => _timeoutReference = setTimeout(() => resolve(msg), ms),
    ).finally(
        () => clearTimeout(_timeoutReference)
    );
};

/**
 * Extracts the income (received token value) from transaction receipt
 *
 * @param {ethers.Wallet} signer - The ethers wallet instance of the bot
 * @param {any} receipt - The transaction receipt
 * @returns The income value or undefined if cannot find any valid value
 */
const getIncome = (signer, receipt) => {
    const erc20Interface = new ethers.utils.Interface(erc20Abi);
    if (receipt.events) return receipt.events.filter(
        v => v.topics[2] && ethers.BigNumber.from(v.topics[2]).eq(signer.address)
    ).map(v => {
        try{
            return erc20Interface.decodeEventLog("Transfer", v.data, v.topics);
        }
        catch {
            return undefined;
        }
    })[0]?.value;
    else if (receipt.logs) return receipt.logs.filter(
        v => v.topics[2] && ethers.BigNumber.from(v.topics[2]).eq(signer.address)
    ).map(v => {
        try{
            return erc20Interface.decodeEventLog("Transfer", v.data, v.topics);
        }
        catch {
            return undefined;
        }
    })[0]?.value;
    else return undefined;
};

/**
 * Extracts the actual clear amount (received token value) from transaction receipt
 *
 * @param {string} arbAddress - The arb contract address
 * @param {any} receipt - The transaction receipt
 * @returns The actual clear amount
 */
const getActualClearAmount = (arbAddress, obAddress, receipt) => {
    const erc20Interface = new ethers.utils.Interface(erc20Abi);
    if (receipt.logs) return receipt.logs.map(v => {
        try{
            return erc20Interface.decodeEventLog("Transfer", v.data, v.topics);
        }
        catch {
            return undefined;
        }
    }).filter(v =>
        v !== undefined &&
        BigNumber.from(v.to).eq(arbAddress) &&
        BigNumber.from(v.from).eq(obAddress)
    )[0]?.value;
    else if (receipt.events) receipt.events.map(v => {
        try{
            return erc20Interface.decodeEventLog("Transfer", v.data, v.topics);
        }
        catch {
            return undefined;
        }
    }).filter(v =>
        v !== undefined &&
        BigNumber.from(v.to).eq(arbAddress) &&
        BigNumber.from(v.from).eq(obAddress)
    )[0]?.value;
    else return undefined;
};

/**
 * Calculates the actual clear price from transactioin event
 *
 * @param {any} receipt - The transaction receipt
 * @param {string} orderbook - The Orderbook contract address
 * @param {string} arb - The Arb contract address
 * @param {string} amount - The clear amount
 * @param {number} buyDecimals - The buy token decimals
 * @returns The actual clear price or undefined if necessary info not found in transaction events
 */
const getActualPrice = (receipt, orderbook, arb, amount, buyDecimals) => {
    const erc20Interface = new ethers.utils.Interface(erc20Abi);
    const eventObj = receipt.events
        ? receipt.events.map(v => {
            try{
                return erc20Interface.decodeEventLog("Transfer", v.data, v.topics);
            }
            catch {
                return undefined;
            }
        }).filter(v => v &&
            !ethers.BigNumber.from(v.from).eq(orderbook) &&
            ethers.BigNumber.from(v.to).eq(arb)
        )
        : receipt.logs?.map(v => {
            try{
                return erc20Interface.decodeEventLog("Transfer", v.data, v.topics);
            }
            catch {
                return undefined;
            }
        }).filter(v => v &&
            !ethers.BigNumber.from(v.from).eq(orderbook) &&
            ethers.BigNumber.from(v.to).eq(arb)
        );
    if (eventObj[0] && eventObj[0]?.value) return ethers.utils.formatUnits(
        eventObj[0].value
            .mul("1" + "0".repeat(36 - buyDecimals))
            .div(amount)
    );
    else return undefined;
};

/**
 * Estimates the profit for a single bundled orders struct
 *
 * @param {string} pairPrice - The price token pair
 * @param {string} ethPrice - Price of ETH to buy token
 * @param {object} bundledOrder - The bundled order object
 * @param {ethers.BigNumber} gas - The estimated gas cost in ETH
 * @param {string} gasCoveragePercentage - Percentage of gas to cover, default is 100,i.e. full gas coverage
 * @returns The estimated profit
 */
const estimateProfit = (pairPrice, ethPrice, bundledOrder, gas, gasCoveragePercentage = "100") => {
    let income = ethers.constants.Zero;
    const price = ethers.utils.parseUnits(pairPrice);
    const gasCost = ethers.utils.parseEther(ethPrice)
        .mul(gas)
        .div(ethers.utils.parseUnits("1"))
        .mul(gasCoveragePercentage)
        .div("100");
    for (const takeOrder of bundledOrder.takeOrders) {
        income = price
            .sub(takeOrder.ratio)
            .mul(takeOrder.quoteAmount)
            .div(ethers.utils.parseUnits("1"))
            .add(income);
    }
    return income.sub(gasCost);
};

/**
 * Creates a viem client
 * @param {number} chainId - The chain id
 * @param {string[]} rpcs - The RPC urls
 * @param {boolean} useFallbacs - If fallback RPCs should be used as well or not
 */
const createViemClient = (chainId, rpcs, useFallbacs = false) => {
    const transport = rpcs.includes("test") || rpcs.length === 0
        ? fallback(fallbacks[chainId].transport, { rank: true, retryCount: 6 })
        : useFallbacs
            ? fallback(
                [...rpcs.map(v => http(v)), ...fallbacks[chainId].transport],
                { rank: true, retryCount: 6 }
            )
            : fallback(rpcs.map(v => http(v)), { retryCount: 6 });

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
};

/**
 * Instantiates a DataFetcher
 * @param {any} configOrViemClient - The network config data or a viem public client
 * @param {LiquidityProviders[]} liquidityProviders - Array of Liquidity Providers
 */
const getDataFetcher = (configOrViemClient, liquidityProviders = [], useFallbacks = false) => {
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
                    [configOrViemClient.rpc],
                    useFallbacks
                )
            )
        );

        // start and immediately stop data fetching as we only want data fetching on demand
        dataFetcher.startDataFetching(
            !liquidityProviders.length ? undefined : liquidityProviders
        );
        dataFetcher.stopDataFetching();
        return dataFetcher;
    }
    catch(error) {
        throw "cannot instantiate DataFetcher for this network";
    }
};

/**
 * Gets ETH price against a target token
 *
 * @param {any} config - The network config data
 * @param {string} targetTokenAddress - The target token address
 * @param {number} targetTokenDecimals - The target token decimals
 * @param {BigNumber} gasPrice - The network gas price
 * @param {DataFetcher} dataFetcher - (optional) The DataFetcher instance
 * @param {import("sushi/router").DataFetcherOptions} options - (optional) The DataFetcher options
 */
const getEthPrice = async(
    config,
    targetTokenAddress,
    targetTokenDecimals,
    gasPrice,
    dataFetcher = undefined,
    options = undefined,
) => {
    if(targetTokenAddress.toLowerCase() == config.nativeWrappedToken.address.toLowerCase()){
        return "1";
    }
    const amountIn = BigNumber.from(
        "1" + "0".repeat(config.nativeWrappedToken.decimals)
    );
    const fromToken = new Token({
        chainId: config.chain.id,
        decimals: config.nativeWrappedToken.decimals,
        address: config.nativeWrappedToken.address,
        symbol: config.nativeWrappedToken.symbol
    });
    const toToken = new Token({
        chainId: config.chain.id,
        decimals: targetTokenDecimals,
        address: targetTokenAddress
    });
    if (!dataFetcher) dataFetcher = getDataFetcher(config);
    await dataFetcher.fetchPoolsForToken(fromToken, toToken, undefined, options);
    const pcMap = dataFetcher.getCurrentPoolCodeMap(fromToken, toToken);
    const route = Router.findBestRoute(
        pcMap,
        config.chain.id,
        fromToken,
        amountIn.toBigInt(),
        toToken,
        gasPrice.toNumber()
        // 30e9,
        // providers,
        // poolFilter
    );
    if (route.status == "NoWay") return undefined;
    else return ethers.utils.formatUnits(route.amountOutBI, targetTokenDecimals);
};

/**
 * Resolves an array of case-insensitive names to LiquidityProviders, ignores the ones that are not valid
 *
 * @param {string[]} liquidityProviders - List of liquidity providers
 */
const processLps = (liquidityProviders, _isv4 = false) => {
    let LP = Object.values(LiquidityProviders);
    if (!_isv4) LP = LP.filter(v => v !== LiquidityProviders.CurveSwap);
    if (
        !liquidityProviders ||
        !Array.isArray(liquidityProviders) ||
        !liquidityProviders.length ||
        !liquidityProviders.every(v => typeof v === "string")
    ) return undefined;
    const _lps = [];
    for (let i = 0; i < liquidityProviders.length; i++) {
        const index = LP.findIndex(
            v => v.toLowerCase() === liquidityProviders[i].toLowerCase().trim()
        );
        if (index > -1 && !_lps.includes(LP[index])) _lps.push(LP[index]);
    }
    return _lps.length ? _lps : LP;
};

/**
 * Validates content of an array of orders
 *
 * @param {any[]} orders - Array of order struct
 */
const validateOrders = (orders) => {
    const addressPattern = /^0x[a-fA-F0-9]{40}$/;
    const vaultIdPattern = /^0x[a-fA-F0-9]{64}$/;
    return Array.isArray(orders)
        && orders.every(v => typeof v.owner === "string"
            && addressPattern.test(v.owner)
            && typeof v.handleIO === "boolean"
            && v.evaluable !== null
            && typeof v.evaluable === "object"
            && typeof v.evaluable.interpreter === "string"
            && addressPattern.test(v.evaluable.interpreter)
            && typeof v.evaluable.store === "string"
            && addressPattern.test(v.evaluable.store)
            && typeof v.evaluable.expression === "string"
            && addressPattern.test(v.evaluable.expression)
            && Array.isArray(v.validInputs)
            && v.validInputs.length > 0
            && Array.isArray(v.validOutputs)
            && v.validOutputs.length > 0
            && v.validInputs.every(e =>
                typeof e.token === "string"
                && addressPattern.test(e.token)
                && typeof e.decimals === "number"
                && e.decimals > 0
                && typeof e.vaultId === "string"
                && vaultIdPattern.test(e.vaultId)
            )
            && v.validOutputs.every(e =>
                typeof e.token === "string"
                && addressPattern.test(e.token)
                && typeof e.decimals === "number"
                && e.decimals > 0
                && typeof e.vaultId === "string"
                && vaultIdPattern.test(e.vaultId)
            )
        );
};

/**
 * Get the order hash from an order struct
 *
 * @param {any} order - The order struct
 * @returns The order hash
 */
const getOrderHash = (order) => {
    return ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
            [
                "tuple("
                    + "address,"
                    + "bool,"
                    + "tuple(address,address,address),"
                    + "tuple[](address,uint8,uint256),"
                    + "tuple[](address,uint8,uint256)" +
                ")"
            ],
            [[
                order.owner,
                order.handleIO,
                [
                    order.evaluable.interpreter,
                    order.evaluable.store,
                    order.evaluable.expression
                ],
                order.validInputs.map(v => [
                    v.token,
                    v.decimals,
                    v.vaultId
                ]),
                order.validOutputs.map(v => [
                    v.token,
                    v.decimals,
                    v.vaultId
                ])
            ]]
        )
    );
};

/**
 * Get order details from an array of order struct
 *
 * @param {string} jsonContent - Content of a JSON file containing orders struct
 */
const getOrderDetailsFromJson = async(jsonContent, signer) => {
    const orders = JSON.parse(jsonContent);
    if (!validateOrders(orders)) throw "invalid orders format";
    const orderDetails = [];
    for (let i = 0; i < orders.length; i++) {
        const _inputSymbols = [];
        const _outputSymbols = [];
        for (let j = 0; j < orders[i].validInputs.length; j++) {
            const erc20 = new ethers.Contract(orders[i].validInputs[j].token, erc20Abi, signer);
            const symbol = await erc20.symbol();
            _inputSymbols.push(symbol);
        }
        for (let j = 0; j < orders[i].validOutputs.length; j++) {
            const erc20 = new ethers.Contract(orders[i].validOutputs[j].token, erc20Abi, signer);
            const symbol = await erc20.symbol();
            _outputSymbols.push(symbol);
        }
        orderDetails.push({
            id: getOrderHash(orders[i]).toLowerCase(),
            handleIO: orders[i].handleIO,
            expression: orders[i].evaluable.expression.toLowerCase(),
            interpreter: orders[i].evaluable.interpreter.toLowerCase(),
            interpreterStore: orders[i].evaluable.store.toLowerCase(),
            owner: {
                id: orders[i].owner.toLowerCase()
            },
            validInputs: orders[i].validInputs.map((v, i) => {
                const _input = {
                    index: i,
                    token: {
                        id: v.token.toLowerCase(),
                        decimals: v.decimals,
                        symbol: _inputSymbols[i]
                    },
                    vault: {
                        id: v.vaultId.toLowerCase() + "-" + orders[i].owner.toLowerCase()
                    }
                };
                return _input;
            }),
            validOutputs: orders[i].validOutputs.map((v, i) => {
                const _output = {
                    index: i,
                    token: {
                        id: v.token.toLowerCase(),
                        decimals: v.decimals,
                        symbol: _outputSymbols[i]
                    },
                    vault: {
                        id: v.vaultId.toLowerCase() + "-" + orders[i].owner.toLowerCase()
                    }
                };
                return _output;
            })
        });
    }
    return orderDetails;
};

/**
 * Method to shorten data fields of items that are logged and optionally hide sensitive data
 *
 * @param {boolean} scrub - Option to scrub sensitive data
 * @param {...any} data - The optinnal data to hide
 */
const appGlobalLogger = (scrub, ...data) => {
    // const largeDataPattern = /0x[a-fA-F0-9]{128,}/g;
    const consoleMethods = ["log", "warn", "error", "info", "debug"];

    // Stringifies an object
    const objStringify = (obj) => {
        const keys = Object.getOwnPropertyNames(obj);
        for (let i = 0; i < keys.length; i++) {
            if (
                typeof obj[keys[i]] === "bigint"
                || typeof obj[keys[i]] === "number"
                || typeof obj[keys[i]] === "symbol"
            ) obj[keys[i]] = obj[keys[i]].toString();
            else if (typeof obj[keys[i]] === "object" && obj[keys[i]] !== null) {
                obj[keys[i]] = objStringify(obj[keys[i]]);
            }
        }
        return obj;
    };

    // Replaces a search value with replace value in an object's properties string content
    const objStrReplacer = (logObj, searchee, replacer) => {
        const objKeys = Object.getOwnPropertyNames(logObj);
        for (let i = 0; i < objKeys.length; i++) {
            if (typeof logObj[objKeys[i]] === "string" && logObj[objKeys[i]]) {
                if (typeof searchee === "string") {
                    // while (logObj[objKeys[i]].includes(searchee)) {
                    logObj[objKeys[i]] = logObj[objKeys[i]].replaceAll(searchee, replacer);
                    // }
                }
                else logObj[objKeys[i]] = logObj[objKeys[i]].replace(searchee, replacer);
            }
            else if (typeof logObj[objKeys[i]] === "object" && logObj[objKeys[i]] !== null) {
                logObj[objKeys[i]] = objStrReplacer(logObj[objKeys[i]], searchee, replacer);
            }
        }
        return logObj;
    };

    // filtering unscrubable data
    const _data = data.filter(
        v => v !== undefined && v !== null
    ).map(
        v => {
            try {
                let str;
                if (typeof v !== "string") str = v.toString();
                else str = v;
                if (str) return str;
                else return undefined;
            }
            catch { return undefined; }
        }
    ).filter(
        v => v !== undefined
    );

    // intercepting the console with custom function to scrub and shorten loggings
    consoleMethods.forEach(methodName => {
        const orgConsole = console[methodName];
        console[methodName] = function (...params) {
            const modifiedParams = [];
            // const shortenedLogs = [];
            for (let i = 0; i < params.length; i++) {
                let logItem = params[i];
                if (
                    typeof logItem === "number" ||
                    typeof logItem === "bigint" ||
                    typeof logItem === "symbol"
                ) logItem = logItem.toString();

                if (typeof logItem === "string") {
                    if (scrub) for (let j = 0; j < _data.length; j++) {
                        // while (logItem.includes(_data[i]))
                        logItem = logItem.replaceAll(
                            _data[j],
                            "**********"
                        );
                    }
                    // logItem = logItem.replace(
                    //     largeDataPattern,
                    //     largeData => {
                    //         if (!shortenedLogs.includes(largeData)) {
                    //             shortenedLogs.push(largeData);
                    //             return largeData;
                    //         }
                    //         else return largeData.slice(0, 67) + "...";
                    //     }
                    // );
                }
                else if (typeof logItem === "object" && logItem !== null) {
                    logItem = objStringify(logItem);
                    if (scrub) for (let j = 0; j < _data.length; j++) {
                        logItem = objStrReplacer(logItem, _data[j], "**********");
                    }
                    // logItem = objStrReplacer(
                    //     logItem,
                    //     largeDataPattern,
                    //     largeData => {
                    //         if (!shortenedLogs.includes(largeData)) {
                    //             shortenedLogs.push(largeData);
                    //             return largeData;
                    //         }
                    //         else return largeData.slice(0, 67) + "...";
                    //     }
                    // );
                }
                modifiedParams.push(logItem);
            }
            orgConsole.apply(console, modifiedParams);
        };
    });
};

/**
 * Method to put a timeout on a promise, throws the exception if promise is not settled within the time
 *
 * @param {Promise} promise - The Promise to put timeout on
 * @param {number} time - The time in milliseconds
 * @param {string | number | bigint | symbol | boolean} exception - The exception value to reject with if the promise is not settled within time
 * @returns A new promise that gets settled with initial promise settlement or rejected with exception value
 * if the time runs out before the main promise settlement
 */
const promiseTimeout = async(promise, time, exception) => {
    let timer;
    return Promise.race([
        promise,
        new Promise(
            (_res, _rej) => timer = setTimeout(_rej, time, exception)
        )
    ]).finally(
        () => clearTimeout(timer)
    );
};


/**
 * Gets the route for tokens
 *
 * @param {number} chainId - The network chain id
 * @param {ethers.BigNumber} sellAmount - The sell amount, should be in onchain token value
 * @param {string} fromTokenAddress - The from token address
 * @param {number} fromTokenDecimals - The from token decimals
 * @param {string} toTokenAddress - The to token address
 * @param {number} toTokenDecimals - The to token decimals
 * @param {string} receiverAddress - The address of the receiver
 * @param {string} routeProcessorAddress - The address of the RouteProcessor contract
 * @param {boolean} abiencoded - If the result should be abi encoded or not
 */
const getRouteForTokens = async(
    chainId,
    sellAmount,
    fromTokenAddress,
    fromTokenDecimals,
    toTokenAddress,
    toTokenDecimals,
    receiverAddress,
    routeProcessorAddress,
    abiEncoded
) => {
    const amountIn = sellAmount.toBigInt();
    const fromToken = new Token({
        chainId: chainId,
        decimals: fromTokenDecimals,
        address: fromTokenAddress
    });
    const toToken = new Token({
        chainId: chainId,
        decimals: toTokenDecimals,
        address: toTokenAddress
    });
    const dataFetcher = getDataFetcher({chainId});
    await dataFetcher.fetchPoolsForToken(fromToken, toToken);
    const pcMap = dataFetcher.getCurrentPoolCodeMap(fromToken, toToken);
    const route = Router.findBestRoute(
        pcMap,
        chainId,
        fromToken,
        amountIn,
        toToken,
        30e9,
        // providers,
        // poolFilter
    );
    if (route.status == "NoWay") throw "NoWay";
    else {
        let routeText = "";
        route.legs.forEach((v, i) => {
            if (i === 0) routeText =
                routeText +
                v.tokenTo.symbol +
                "/" +
                v.tokenFrom.symbol +
                "(" +
                v.poolName +
                ")";
            else routeText =
                routeText +
                " + " +
                v.tokenTo.symbol +
                "/" +
                v.tokenFrom.symbol +
                "(" +
                v.poolName +
                ")";
        });
        console.log("Route portions: ", routeText, "\n");
        const rpParams = Router.routeProcessor4Params(
            pcMap,
            route,
            fromToken,
            toToken,
            receiverAddress,
            routeProcessorAddress,
            // permits
            // "0.005"
        );
        if (abiEncoded) return ethers.utils.defaultAbiCoder.encode(
            ["bytes"],
            [rpParams.routeCode]
        );
        else return rpParams.routeCode;
    }
};

/**
 * Method to visualize the routes, returns array of route strings sorted from highest to lowest percentage
 *
 * @param {string} fromToken - The from token address
 * @param {string} toToken - The to token address
 * @param {any[]} legs - The legs of the route
 */
const visualizeRoute = (fromToken, toToken, legs) => {
    return [
        ...legs.filter(
            v => v.tokenTo.address.toLowerCase() === toToken.address.toLowerCase() &&
            v.tokenFrom.address.toLowerCase() === fromToken.address.toLowerCase()
        ).map(v => [v]),

        ...legs.filter(
            v => v.tokenFrom.address.toLowerCase() === fromToken.address.toLowerCase() &&
            (
                v.tokenTo.address.toLowerCase() !== toToken.address.toLowerCase()
            )
        ).map(v => {
            const portoin = [v];
            while(
                portoin.at(-1).tokenTo.address.toLowerCase() !== toToken.address.toLowerCase()
            ) {
                portoin.push(
                    legs.find(e =>
                        e.tokenFrom.address.toLowerCase() ===
                        portoin.at(-1).tokenTo.address.toLowerCase()
                    )
                );
            }
            return portoin;
        })

    ].sort(
        (a, b) => b[0].absolutePortion - a[0].absolutePortion
    ).map(
        v => (v[0].absolutePortion * 100).toFixed(2).padStart(5, "0") + "%   --->   " +
        v.map(
            e => (e.tokenTo.symbol ?? (e.tokenTo.address.toLowerCase() === toToken.address.toLowerCase() ? toToken.symbol : "unknownSymbol"))
                + "/"
                + (e.tokenFrom.symbol ?? (e.tokenFrom.address.toLowerCase() === fromToken.address.toLowerCase() ? fromToken.symbol : "unknownSymbol"))
                + " ("
                + e.poolName
                + ")"
        ).join(
            " >> "
        )
    );
};

const shuffleArray = (array) => {
    let currentIndex = array.length;
    let randomIndex = 0;

    // While there remain elements to shuffle.
    while (currentIndex > 0) {

        // Pick a remaining element.
        randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex--;

        // And swap it with the current element.
        [
            array[currentIndex],
            array[randomIndex]
        ] = [
            array[randomIndex],
            array[currentIndex]
        ];
    }

    return array;
};

function getSpanException(error) {
    if (error instanceof Error && Object.keys(error).length && error.message.includes("providers/5.7.0")) {
        const parsedError = JSON.parse(JSON.stringify(error));

        // delete transaction key since it is already present in error key;
        delete parsedError.transaction;
        delete error.transaction;
        error.message = JSON.stringify(parsedError);

        // remove stack since it is already present in message
        error.stack = undefined;
        return error;
    }
    return error;
}

/**
 * Builds and bundles orders which their details are queried from a orderbook subgraph
 *
 * @param {any[]} ordersDetails - Orders details queried from subgraph
 * @param {boolean} _shuffle - To shuffle the bundled order array at the end
 * @param {boolean} _bundle = If orders should be bundled based on token pair
 * @returns Array of bundled take orders
 */
const bundleOrders = (
    ordersDetails,
    _shuffle = true,
    _bundle = true,
) => {
    const bundledOrders = [];
    for (let i = 0; i < ordersDetails.length; i++) {
        const orderDetails = ordersDetails[i];
        const orderStruct = JSON.parse(ordersDetails[i].orderJSONString);
        // exchange the "handleIo" to "handleIO" in case "handleIO" is not present in order json
        if (!("handleIO" in orderStruct)) {
            orderStruct.handleIO = orderStruct.handleIo;
            delete orderStruct.handleIo;
        }
        for (let j = 0; j < orderStruct.validOutputs.length; j++) {
            const _output = orderStruct.validOutputs[j];
            const _outputSymbol = orderDetails.validOutputs.find(
                v => v.token.id.toLowerCase() === _output.token.toLowerCase()
            ).token.symbol;

            for (let k = 0; k < orderStruct.validInputs.length; k ++) {
                const _input = orderStruct.validInputs[k];
                const _inputSymbol = orderDetails.validInputs.find(
                    v => v.token.id.toLowerCase() === _input.token.toLowerCase()
                ).token.symbol;

                if (_output.token.toLowerCase() !== _input.token.toLowerCase()) {
                    const pair = bundledOrders.find(v =>
                        v.sellToken === _output.token.toLowerCase() &&
                        v.buyToken === _input.token.toLowerCase()
                    );
                    if (pair && _bundle) pair.takeOrders.push({
                        id: orderDetails.id,
                        takeOrder: {
                            order: orderStruct,
                            inputIOIndex: k,
                            outputIOIndex: j,
                            signedContext: []
                        }
                    });
                    else bundledOrders.push({
                        buyToken: _input.token.toLowerCase(),
                        buyTokenSymbol: _inputSymbol,
                        buyTokenDecimals: _input.decimals,
                        sellToken: _output.token.toLowerCase(),
                        sellTokenSymbol: _outputSymbol,
                        sellTokenDecimals: _output.decimals,
                        takeOrders: [{
                            id: orderDetails.id,
                            takeOrder: {
                                order: orderStruct,
                                inputIOIndex: k,
                                outputIOIndex: j,
                                signedContext: []
                            }
                        }]
                    });

                }
            }
        }
    }
    if (_shuffle) {
        // shuffle take orders for each pair
        if (_bundle) bundledOrders.forEach(v => shuffleArray(v.takeOrders));

        // shuffle bundled orders pairs
        shuffleArray(bundledOrders);
    }
    return bundledOrders;
};

/**
 * Gets vault balance of an order or combined value of vaults if bundled
 */
async function getVaultBalance(
    orderDetails,
    orderbookAddress,
    viemClient,
    multicallAddressOverride
) {
    const multicallResult = await viemClient.multicall({
        multicallAddress:
            viemClient.chain?.contracts?.multicall3?.address ?? multicallAddressOverride,
        allowFailure: false,
        contracts: orderDetails.takeOrders.map(v => ({
            address: orderbookAddress,
            allowFailure: false,
            chainId: viemClient.chain.id,
            abi: parseAbi(orderbookAbi),
            functionName: "vaultBalance",
            args: [
                // owner
                v.takeOrder.order.owner,
                // token
                v.takeOrder.order.validOutputs[v.takeOrder.outputIOIndex].token,
                // valut id
                v.takeOrder.order.validOutputs[v.takeOrder.outputIOIndex].vaultId,
            ]
        })),
    });

    let result = ethers.BigNumber.from(0);
    for (let i = 0; i < multicallResult.length; i++) {
        result = result.add(multicallResult[i]);
    }
    return result;
}

module.exports = {
    fallbacks,
    bnFromFloat,
    toFixed18,
    fromFixed18,
    getOrderStruct,
    sleep,
    getIncome,
    getActualPrice,
    estimateProfit,
    getDataFetcher,
    getEthPrice,
    processLps,
    validateOrders,
    getOrderHash,
    getOrderDetailsFromJson,
    appGlobalLogger,
    promiseTimeout,
    getActualClearAmount,
    getRouteForTokens,
    visualizeRoute,
    shuffleArray,
    createViemClient,
    getSpanException,
    getChainConfig,
    bundleOrders,
    getVaultBalance,
};