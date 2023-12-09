const { ethers, BigNumber } = require("ethers");
const { createPublicClient, http, fallback } = require("viem");
const { erc20Abi, interpreterAbi, interpreterV2Abi } = require("./abis");
const { DataFetcher, Router, LiquidityProviders, ChainId, Token, viemConfig } = require("sushiswap-router");


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
            "sushiswapv2"
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
 * Calls eval for a specific order to get its max output and ratio
 *
 * @param {ethers.Contract} interpreter - The interpreter ethersjs contract instance with signer
 * @param {string} arbAddress - Arb contract address
 * @param {string} obAddress - OrderBook contract address
 * @param {object} order - The order details fetched from sg
 * @param {number} inputIndex - The input token index
 * @param {number} outputIndex - The ouput token index
 * @returns The ratio and maxOuput as BigNumber
*/
const interpreterEval = async(
    interpreter,
    arbAddress,
    obAddress,
    order,
    inputIndex,
    outputIndex,
    inputBalance,
    outputBalance
) => {
    try {
        const { stack: [ maxOutput, ratio ] } = await interpreter.eval(
            order.interpreterStore,
            order.owner.id,
            order.expression + "00000002",
            // construct the context for eval
            [
                [
                    // base column
                    arbAddress,
                    obAddress
                ],
                [
                    // calling context column
                    order.id,
                    order.owner.id,
                    arbAddress
                ],
                [
                    // calculateIO context column
                ],
                [
                    // input context column
                    order.validInputs[inputIndex].token.id,
                    order.validInputs[inputIndex].token.decimals,
                    order.validInputs[inputIndex].vault.id.split("-")[0],
                    inputBalance,
                    "0"
                ],
                [
                    // output context column
                    order.validOutputs[outputIndex].token.id,
                    order.validOutputs[outputIndex].token.decimals,
                    order.validOutputs[outputIndex].vault.id.split("-")[0],
                    outputBalance,
                    "0"
                ],
                [
                    // empty context column
                ],
                [
                    // signed context column
                ]
            ]
        );
        return { ratio, maxOutput };
    }
    catch {
        return {
            ratio: undefined,
            maxOutput: undefined
        };
    }
};

/**
 * Calls eval2 on interpreter v2 for a specific order to get its max output and ratio
 *
 * @param {ethers.Contract} interpreter - The interpreter v2 ethersjs contract instance with signer
 * @param {string} arbAddress - Arb contract address
 * @param {string} obAddress - OrderBook contract address
 * @param {object} order - The order details fetched from sg
 * @param {number} inputIndex - The input token index
 * @param {number} outputIndex - The ouput token index
 * @returns The ratio and maxOuput as BigNumber
*/
const interpreterV2Eval = async(
    interpreter,
    arbAddress,
    obAddress,
    order,
    inputIndex,
    outputIndex,
    inputBalance,
    outputBalance
) => {
    try {
        const { stack: [ ratio, maxOutput ] } = await interpreter.eval2(
            order.interpreterStore,
            order.owner.id,
            order.expression + "00000002",
            // construct the context for eval
            [
                [
                    // base column
                    arbAddress,
                    obAddress
                ],
                [
                    // calling context column
                    order.id,
                    order.owner.id,
                    arbAddress
                ],
                [
                    // calculateIO context column
                ],
                [
                    // input context column
                    order.validInputs[inputIndex].token.id,
                    order.validInputs[inputIndex].token.decimals,
                    order.validInputs[inputIndex].vault.id.split("-")[0],
                    inputBalance,
                    "0"
                ],
                [
                    // output context column
                    order.validOutputs[outputIndex].token.id,
                    order.validOutputs[outputIndex].token.decimals,
                    order.validOutputs[outputIndex].vault.id.split("-")[0],
                    outputBalance,
                    "0"
                ],
                [
                    // empty context column
                ],
                [
                    // signed context column
                ]
            ],
            // empty inputs
            []
        );
        return { ratio, maxOutput };
    }
    catch {
        return {
            ratio: undefined,
            maxOutput: undefined
        };
    }
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
 * Builds and bundles orders which their details are queried from a orderbook subgraph by checking the vault balances and evaling
 *
 * @param {any[]} ordersDetails - Orders details queried from subgraph
 * @param {ethers.Contract} orderbook - The Orderbook EthersJS contract instance with signer
 * @param {ethers.Contract} arb - The Arb EthersJS contract instance with signer
 * @param {boolean} _eval - To eval() the orders and filter them based on the eval result
 * @param {boolean} _shuffle - To shuffle the bundled order array at the end
 * @param {boolean} _interpreterv2 - If should use eval2 of interpreter v2 for evaling
 * @returns Array of bundled take orders
 */
const bundleTakeOrders = async(
    ordersDetails,
    orderbook,
    arb,
    _eval = true,
    _shuffle = true,
    _interpreterv2 = false
) => {
    const bundledOrders = [];
    const obAsSigner = new ethers.VoidSigner(
        orderbook.address,
        orderbook.signer.provider
    );

    const vaultsCache = [];
    for (let i = 0; i < ordersDetails.length; i++) {
        const order = ordersDetails[i];
        for (let j = 0; j < order.validOutputs.length; j++) {
            const _output = order.validOutputs[j];
            let quoteAmount, ratio, maxOutput;
            let _outputBalance, _outputBalanceFixed;
            let _hasVaultBalances = false;
            if (_eval) {
                if (_output?.tokenVault?.balance) {
                    _hasVaultBalances = true;
                }
                if (_hasVaultBalances) {
                    _outputBalance = _output.tokenVault.balance;
                    _outputBalanceFixed = ethers.utils.parseUnits(
                        ethers.utils.formatUnits(
                            _output.tokenVault.balance,
                            _output.token.decimals
                        )
                    );
                    if (!vaultsCache.find(e =>
                        e.owner === order.owner.id &&
                        e.token === _output.token.id &&
                        e.vaultId === _output.vault.id.split("-")[0]
                    )) vaultsCache.push({
                        owner: order.owner.id,
                        token: _output.token.id,
                        vaultId: _output.vault.id.split("-")[0],
                        balance: _output.tokenVault.balance
                    });
                }
                else {
                    let _ov = vaultsCache.find(e =>
                        e.owner === order.owner.id &&
                        e.token === _output.token.id &&
                        e.vaultId === _output.vault.id.split("-")[0]
                    );
                    if (!_ov) {
                        const balance = await orderbook.vaultBalance(
                            order.owner.id,
                            _output.token.id,
                            _output.vault.id.split("-")[0]
                        );
                        _ov = {
                            owner: order.owner.id,
                            token: _output.token.id,
                            vaultId: _output.vault.id.split("-")[0],
                            balance
                        };
                        vaultsCache.push(_ov);
                    }
                    _outputBalance = _ov.balance;
                    _outputBalanceFixed = ethers.utils.parseUnits(
                        ethers.utils.formatUnits(
                            _outputBalance,
                            _output.token.decimals
                        )
                    );
                }
                quoteAmount = _outputBalanceFixed;
            }

            if (quoteAmount === undefined || !quoteAmount.isZero()) {
                for (let k = 0; k < order.validInputs.length; k ++) {
                    if (_output.token.id !== order.validInputs[k].token.id) {
                        const _input = order.validInputs[k];

                        if (_eval) {
                            let _inputBalance;
                            if (_hasVaultBalances) {
                                _inputBalance = _input.tokenVault.balance;
                                if (!vaultsCache.find(e =>
                                    e.owner === order.owner.id &&
                                    e.token === _input.token.id &&
                                    e.vaultId === _input.vault.id.split("-")[0]
                                )) vaultsCache.push({
                                    owner: order.owner.id,
                                    token: _input.token.id,
                                    vaultId: _input.vault.id.split("-")[0],
                                    balance: _input.tokenVault.balance
                                });
                            }
                            else {
                                let _iv = vaultsCache.find(e =>
                                    e.owner === order.owner.id &&
                                    e.token === _input.token.id &&
                                    e.vaultId === _input.vault.id.split("-")[0]
                                );
                                if (!_iv) {
                                    const balance = await orderbook.vaultBalance(
                                        order.owner.id,
                                        _input.token.id,
                                        _input.vault.id.split("-")[0]
                                    );
                                    _iv = {
                                        owner: order.owner.id,
                                        token: _input.token.id,
                                        vaultId: _input.vault.id.split("-")[0],
                                        balance
                                    };
                                    vaultsCache.push(_iv);
                                }
                                _inputBalance = _iv.balance;
                            }
                            ({ maxOutput, ratio } = _interpreterv2
                                ? await interpreterV2Eval(
                                    new ethers.Contract(
                                        order.interpreter,
                                        interpreterV2Abi,
                                        obAsSigner
                                    ),
                                    arb.address,
                                    orderbook.address,
                                    order,
                                    k,
                                    j ,
                                    _inputBalance.toString() ,
                                    _outputBalance.toString()
                                )
                                : await interpreterEval(
                                    new ethers.Contract(
                                        order.interpreter,
                                        interpreterAbi,
                                        obAsSigner
                                    ),
                                    arb.address,
                                    orderbook.address,
                                    order,
                                    k,
                                    j ,
                                    _inputBalance.toString() ,
                                    _outputBalance.toString()
                                )
                            );

                            if (maxOutput && ratio && maxOutput.lt(quoteAmount)) {
                                quoteAmount = maxOutput;
                            }
                        }

                        if (!_eval || !quoteAmount.isZero()) {
                            const pair = bundledOrders.find(v =>
                                v.sellToken === _output.token.id &&
                                v.buyToken === _input.token.id
                            );
                            if (pair) pair.takeOrders.push({
                                id: order.id,
                                ratio,
                                quoteAmount,
                                takeOrder: {
                                    order: getOrderStruct(order),
                                    inputIOIndex: k,
                                    outputIOIndex: j,
                                    signedContext: []
                                }
                            });
                            else bundledOrders.push({
                                buyToken: _input.token.id,
                                buyTokenSymbol: _input.token.symbol,
                                buyTokenDecimals: _input.token.decimals,
                                sellToken: _output.token.id,
                                sellTokenSymbol: _output.token.symbol,
                                sellTokenDecimals: _output.token.decimals,
                                takeOrders: [{
                                    id: order.id,
                                    ratio,
                                    quoteAmount,
                                    takeOrder: {
                                        order: getOrderStruct(order),
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
        }
    }
    // sort ascending based on ratio if orders are evaled
    if (_eval) bundledOrders.forEach(v => v.takeOrders.sort(
        (a, b) => a.ratio && b.ratio
            ? a.ratio.gt(b.ratio) ? 1 : a.ratio.lt(b.ratio) ? -1 : 0
            : 0
    ));
    if (_shuffle) {
        // shuffle take orders for each pair
        bundledOrders.forEach(v => shuffleArray(v.takeOrders));

        // shuffle bundled orders pairs
        shuffleArray(bundledOrders);
    }
    return bundledOrders;
};

/**
 * Creates a viem client
 * @param {number} chainId - The chain id
 * @param {string[]} rpcs - The RPC urls
 * @param {boolean} useFallbacs - If fallback RPCs should be used as well or not
 */
const createViemClient = (chainId, rpcs, useFallbacs = false) => {
    const transport = rpcs.includes("test") || rpcs.length === 0
        ? fallback(fallbacks[chainId].transport, {rank: true})
        : useFallbacs
            ? fallback(
                [...rpcs.map(v => http(v)), ...fallbacks[chainId].transport],
                { rank: true }
            )
            : fallback(rpcs.map(v => http(v)));

    return createPublicClient({
        chain: viemConfig[chainId]?.chain,
        transport
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
                : configOrViemClient.chainId
            ),
            ("transport" in configOrViemClient
                ? configOrViemClient
                : createViemClient(
                    configOrViemClient.chainId,
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
 */
const getEthPrice = async(
    config,
    targetTokenAddress,
    targetTokenDecimals,
    gasPrice,
    dataFetcher = undefined
) => {
    const amountIn = BigNumber.from(
        "1" + "0".repeat(config.nativeWrappedToken.decimals)
    );
    const fromToken = new Token({
        chainId: config.chainId,
        decimals: config.nativeWrappedToken.decimals,
        address: config.nativeWrappedToken.address,
        symbol: config.nativeWrappedToken.symbol
    });
    const toToken = new Token({
        chainId: config.chainId,
        decimals: targetTokenDecimals,
        address: targetTokenAddress
    });
    if (!dataFetcher) dataFetcher = getDataFetcher(config);
    await dataFetcher.fetchPoolsForToken(fromToken, toToken);
    const pcMap = dataFetcher.getCurrentPoolCodeMap(fromToken, toToken);
    const route = Router.findBestRoute(
        pcMap,
        config.chainId,
        fromToken,
        amountIn,
        toToken,
        gasPrice.toNumber()
        // 30e9,
        // providers,
        // poolFilter
    );
    if (route.status == "NoWay") return undefined;
    else return ethers.utils.formatUnits(route.amountOutBN, targetTokenDecimals);
};

// /**
//  * A wrapper for DataFetcher fetchPoolsForToken() to avoid any errors for liquidity providers that are not available for target chain
//  *
//  * @param {DataFetcher} dataFetcher - DataFetcher instance
//  * @param {Token} fromToken - The from token
//  * @param {Token} toToken - The to token
//  * @param {string[]} excludePools - Set of pools to exclude
//  */
// const fetchPoolsForTokenWrapper = async(dataFetcher, fromToken, toToken, excludePools) => {
//     // ensure that we only fetch the native wrap pools if the
//     // token is the native currency and wrapped native currency
//     if (fromToken.wrapped.equals(toToken.wrapped)) {
//         const provider = dataFetcher.providers.find(
//             (p) => p.getType() === LiquidityProviders.NativeWrap
//         );
//         if (provider) {
//             try {
//                 await provider.fetchPoolsForToken(
//                     fromToken.wrapped,
//                     toToken.wrapped,
//                     excludePools
//                 );
//             }
//             catch {}
//         }
//     }
//     else {
//         const [token0, token1] =
//             fromToken.wrapped.equals(toToken.wrapped) ||
//             fromToken.wrapped.sortsBefore(toToken.wrapped)
//                 ? [fromToken.wrapped, toToken.wrapped]
//                 : [toToken.wrapped, fromToken.wrapped];
//         await Promise.allSettled(
//             dataFetcher.providers.map((p) => {
//                 try {
//                     return p.fetchPoolsForToken(token0, token1, excludePools);
//                 }
//                 catch {
//                     return;
//                 }
//             })
//         );
//     }
// };

/**
 * Resolves an array of case-insensitive names to LiquidityProviders, ignores the ones that are not valid
 *
 * @param {string[]} liquidityProviders - List of liquidity providers
 * @param {number} chainId - The chain id
 */
const processLps = (liquidityProviders, chainId) => {
    if (
        !liquidityProviders ||
        !Array.isArray(liquidityProviders) ||
        !liquidityProviders.length ||
        !liquidityProviders.every(v => typeof v === "string")
    ) return undefined;
    const _lps = [];
    const LP = Object.values(LiquidityProviders);
    for (let i = 0; i < liquidityProviders.length; i++) {
        const index = LP.findIndex(
            v => v.toLowerCase() === liquidityProviders[i].toLowerCase()
                && !!fallbacks[chainId]?.liquidityProviders.includes(
                    liquidityProviders[i].toLowerCase()
                )
        );
        if (index > -1 && !_lps.includes(LP[index])) _lps.push(LP[index]);
    }
    return _lps.length ? _lps : undefined;
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
    const largeDataPattern = /0x[a-fA-F0-9]{128,}/g;
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
            const shortenedLogs = [];
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
                    logItem = logItem.replace(
                        largeDataPattern,
                        largeData => {
                            if (!shortenedLogs.includes(largeData)) {
                                shortenedLogs.push(largeData);
                                return largeData;
                            }
                            else return largeData.slice(0, 67) + "...";
                        }
                    );
                }
                else if (typeof logItem === "object" && logItem !== null) {
                    logItem = objStringify(logItem);
                    if (scrub) for (let j = 0; j < _data.length; j++) {
                        logItem = objStrReplacer(logItem, _data[j], "**********");
                    }
                    logItem = objStrReplacer(
                        logItem,
                        largeDataPattern,
                        largeData => {
                            if (!shortenedLogs.includes(largeData)) {
                                shortenedLogs.push(largeData);
                                return largeData;
                            }
                            else return largeData.slice(0, 67) + "...";
                        }
                    );
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
    const amountIn = sellAmount;
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
        const rpParams = Router.routeProcessor2Params(
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
            v.tokenFrom.address.toLowerCase() === fromToken.address.toLowerCase() &&
            v.tokenTo.symbol.toLowerCase() === toToken.symbol.toLowerCase() &&
            v.tokenFrom.symbol.toLowerCase() === fromToken.symbol.toLowerCase()
        ).map(v => [v]),

        ...legs.filter(
            v => v.tokenFrom.address.toLowerCase() === fromToken.address.toLowerCase() &&
            v.tokenFrom.symbol.toLowerCase() === fromToken.symbol.toLowerCase() &&
            (
                v.tokenTo.address.toLowerCase() !== toToken.address.toLowerCase() ||
                v.tokenTo.symbol.toLowerCase() !== toToken.symbol.toLowerCase()
            )
        ).map(v => {
            const portoin = [v];
            while(
                portoin.at(-1).tokenTo.address.toLowerCase() !== toToken.address.toLowerCase() ||
                portoin.at(-1).tokenTo.symbol.toLowerCase() !== toToken.symbol.toLowerCase()
            ) {
                portoin.push(
                    legs.find(e =>
                        e.tokenFrom.address.toLowerCase() ===
                        portoin.at(-1).tokenTo.address.toLowerCase() &&
                        e.tokenFrom.symbol.toLowerCase() ===
                        portoin.at(-1).tokenTo.symbol.toLowerCase()
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
            e => e.tokenTo.symbol + "/" + e.tokenFrom.symbol + " (" + e.poolName + ")"
        ).join(
            " >> "
        )
    );
};

/**
 * Builds initial 0x requests bodies from token addresses that is required
 * for getting token prices with least amount of hits possible and that is
 * to pair up tokens in a way that each show up only once in a request body
 * so that the number of requests will be: "number-of-tokens / 2" at best or
 * "(number-of-tokens / 2) + 1" at worst if the number of tokens is an odd digit.
 * This way the responses will include the "rate" for sell/buy tokens to native
 * network token which will be used to estimate the initial price of all possible
 * token pair combinations.
 *
 * @param {string} api - The 0x API endpoint URL
 * @param {any[]} queries - The array that keeps the 0x query text
 * @param {string} tokenAddress - The token address
 * @param {number} tokenDecimals - The token decimals
 * @param {string} tokenSymbol - The token symbol
 */
const build0xQueries = (api, queries, tokenAddress, tokenDecimals, tokenSymbol) => {
    tokenAddress = tokenAddress.toLowerCase();
    if (queries.length === 0) queries.push([
        tokenAddress,
        tokenDecimals,
        tokenSymbol
    ]);
    else if (!Array.isArray(queries[queries.length - 1])) {
        if(!queries.find(v => v.quote.includes(tokenAddress))) queries.push([
            tokenAddress,
            tokenDecimals,
            tokenSymbol
        ]);
    }
    else {
        if(
            queries[queries.length - 1][0] !== tokenAddress &&
            !queries.slice(0, -1).find(v => v.quote.includes(tokenAddress))
        ) {
            queries[queries.length - 1] = {
                quote: `${
                    api
                }swap/v1/price?buyToken=${
                    queries[queries.length - 1][0]
                }&sellToken=${
                    tokenAddress
                }&sellAmount=${
                    "1" + "0".repeat(tokenDecimals)
                }`,
                tokens: [
                    queries[queries.length - 1][2],
                    tokenSymbol,
                    queries[queries.length - 1][0],
                    tokenAddress,
                    queries[queries.length - 1][1],
                    tokenDecimals
                ]
            };
        }
    }
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

module.exports = {
    fallbacks,
    bnFromFloat,
    toFixed18,
    fromFixed18,
    interpreterEval,
    getOrderStruct,
    sleep,
    getIncome,
    getActualPrice,
    estimateProfit,
    bundleTakeOrders,
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
    build0xQueries,
    shuffleArray,
    createViemClient,
    interpreterV2Eval
};