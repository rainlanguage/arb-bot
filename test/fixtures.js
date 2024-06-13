const { ethers } = require("ethers");
const { arbAbis } = require("../src/abis");
const { Token } = require("sushi/currency");
const { visualizeRoute } = require("../src/utils");
const { ConstantProductRPool } = require("sushi/tines");
const { ConstantProductPoolCode, Router } = require("sushi");
const { hexlify, randomBytes } = require("ethers/lib/utils");

const token1 = {
    address: hexlify(randomBytes(20)),
    decimals: 6,
    symbol: "T1"
};
const token2 = {
    address: hexlify(randomBytes(20)),
    decimals: 18,
    symbol: "T2"
};
const rp3_2 = hexlify(randomBytes(20));
const arbAddress = hexlify(randomBytes(20));
const orderbookAddress = hexlify(randomBytes(20));
const ethPrice = "0.5";
const gasPrice = ethers.BigNumber.from("30000000");
const gasLimitEstimation = ethers.BigNumber.from("456789");
const arb = new ethers.Contract(arbAddress, arbAbis);
const orderbook = new ethers.Contract(orderbookAddress, arbAbis);
const pair = token1.symbol + "/" + token2.symbol;
const txHash = hexlify(randomBytes(32));
const effectiveGasPrice = ethers.BigNumber.from(30000000);
const gasUsed = 234567;
const fromToken = new Token({
    chainId: 137,
    decimals: token2.decimals,
    address: token2.address,
    symbol: token2.symbol,
});
const toToken = new Token({
    chainId: 137,
    decimals: token1.decimals,
    address: token1.address,
    symbol: token1.symbol
});
const scannerUrl = "https://scanner.com";
const config = {
    hops: 3,
    bundle: false,
    retries: 2,
    maxRatio: true,
    concurrency: "max",
    arbAddress,
    orderbookAddress,
    routeProcessors: { "3.2": rp3_2 },
    chain: {
        id: 137,
        blockExplorers: { default: { url: scannerUrl } }
    },
    gasCoveragePercentage: "100",
    nativeWrappedToken: {
        address: token2.address,
        decimals: token2.decimals,
        symbol: token2.symbol,
    },
};

const vaultBalance1 = ethers.BigNumber.from("10000000000000000000");
const vaultBalance2 = ethers.BigNumber.from("20000000000000000000");
const orderPairObject2 = {
    buyToken: token1.address,
    buyTokenSymbol: token1.symbol,
    buyTokenDecimals: token1.decimals,
    sellToken: token2.address,
    sellTokenSymbol: token2.symbol,
    sellTokenDecimals: token2.decimals,
    takeOrders: [
        {
            id: hexlify(randomBytes(32)),
            vaultBalance: vaultBalance1,
            takeOrder: {
                order: {
                    owner: hexlify(randomBytes(20)),
                    evaluable: {
                        interpreter: hexlify(randomBytes(20)),
                        store: hexlify(randomBytes(20)),
                        expression: hexlify(randomBytes(20))
                    },
                    validInputs: [{
                        token: token1.address,
                        decimals: token1.decimals,
                        vaultId: hexlify(randomBytes(32))
                    }],
                    validOutputs: [{
                        token: token2.address,
                        decimals: token2.decimals,
                        vaultId: hexlify(randomBytes(32))
                    }],
                    handleIO: false
                },
                inputIOIndex: 0,
                outputIOIndex: 0,
                signedContext: []
            }
        },
        {
            id: hexlify(randomBytes(32)),
            vaultBalance: vaultBalance2,
            takeOrder: {
                order: {
                    owner: hexlify(randomBytes(20)),
                    evaluable: {
                        interpreter: hexlify(randomBytes(20)),
                        store: hexlify(randomBytes(20)),
                        expression: hexlify(randomBytes(20))
                    },
                    validInputs: [{
                        token: token1.address,
                        decimals: token1.decimals,
                        vaultId: hexlify(randomBytes(32))
                    }],
                    validOutputs: [{
                        token: token2.address,
                        decimals: token2.decimals,
                        vaultId: hexlify(randomBytes(32))
                    }],
                    handleIO: false
                },
                inputIOIndex: 0,
                outputIOIndex: 0,
                signedContext: []
            }
        }
    ]
};

const vaultBalance = ethers.BigNumber.from("10000000000000000000");
const orderPairObject1 = {
    buyToken: token1.address,
    buyTokenSymbol: token1.symbol,
    buyTokenDecimals: token1.decimals,
    sellToken: token2.address,
    sellTokenSymbol: token2.symbol,
    sellTokenDecimals: token2.decimals,
    takeOrders: [{
        id: hexlify(randomBytes(32)),
        vaultBalance,
        takeOrder: {
            order: {
                owner: hexlify(randomBytes(20)),
                evaluable: {
                    interpreter: hexlify(randomBytes(20)),
                    store: hexlify(randomBytes(20)),
                    expression: hexlify(randomBytes(20))
                },
                validInputs: [{
                    token: token1.address,
                    decimals: token1.decimals,
                    vaultId: hexlify(randomBytes(32))
                }],
                validOutputs: [{
                    token: token2.address,
                    decimals: token2.decimals,
                    vaultId: hexlify(randomBytes(32))
                }],
                handleIO: false
            },
            inputIOIndex: 0,
            outputIOIndex: 0,
            signedContext: []
        }
    }]
};
const poolAddress = hexlify(randomBytes(20));
const poolCodeMap = new Map([[
    poolAddress,
    new ConstantProductPoolCode(
        new ConstantProductRPool(
            poolAddress,
            fromToken,
            toToken,
            0.003,
            100000000000000000000000n,
            100000000000n,
        ),
        "QuickSwap",
        "QuickSwap 0.3%"
    )
]]);
const route = Router.findBestRoute(
    poolCodeMap,
    137,
    fromToken,
    vaultBalance.toBigInt(),
    toToken,
    gasPrice.toNumber(),
);
const expectedRouteData = ethers.utils.defaultAbiCoder.encode(
    ["bytes"],
    [
        Router.routeProcessor3_2Params(
            poolCodeMap,
            route,
            fromToken,
            toToken,
            arb.address,
            rp3_2,
        ).routeCode
    ]
);
const expectedRouteVisual = visualizeRoute(fromToken, toToken, route.legs);

module.exports = {
    config,
    token1,
    token2,
    arbAddress,
    orderbookAddress,
    rp3_2,
    ethPrice,
    gasPrice,
    gasLimitEstimation,
    arb,
    orderbook,
    pair,
    txHash,
    effectiveGasPrice,
    gasUsed,
    fromToken,
    toToken,
    poolCodeMap,
    route,
    expectedRouteData,
    expectedRouteVisual,
    vaultBalance,
    vaultBalance1,
    vaultBalance2,
    orderPairObject1,
    orderPairObject2,
    scannerUrl,
};