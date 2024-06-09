const { ethers } = require("ethers");
const { arbAbis } = require("../src/abis");
const { Token } = require("sushi/currency");
const { visualizeRoute } = require("../src/utils");
const { ConstantProductRPool } = require("sushi/tines");
const { ConstantProductPoolCode, Router } = require("sushi");

const usdt = {
    address: "0xc2132d05d31c914a87c6611c10748aeb04b58e8f",
    decimals: 6,
    symbol: "USDT"
};
const wmatic = {
    address: "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270",
    decimals: 18,
    symbol: "WMATIC"
};
const rp3_2 = "0xE7eb31f23A5BefEEFf76dbD2ED6AdC822568a5d2";
const arbAddress = "0x56394785a22b3BE25470a0e03eD9E0a939C47b9b";
const orderbookAddress = "0xb06202aA3Fe7d85171fB7aA5f17011d17E63f382";
const ethPrice = "0.5";
const gasPrice = ethers.BigNumber.from("30000000");
const gasLimitEstimation = ethers.BigNumber.from("456789");
const arb = new ethers.Contract(arbAddress, arbAbis);
const orderbook = new ethers.Contract(orderbookAddress, arbAbis);
const pair = "USDT/WMATIC";
const txHash = "0xd91f9402fed0c14672f64329ed6af5278b600ea785b0e35475ec5e3618b1cda6";
const effectiveGasPrice = ethers.BigNumber.from(30000000);
const gasUsed = 234567;
const fromToken = new Token({
    chainId: 137,
    decimals: wmatic.decimals,
    address: wmatic.address,
    symbol: wmatic.symbol,
});
const toToken = new Token({
    chainId: 137,
    decimals: usdt.decimals,
    address: usdt.address,
    symbol: usdt.symbol
});
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
        blockExplorers: { default: { url: "https://polygonscan.com" } }
    },
    gasCoveragePercentage: "100",
    nativeWrappedToken: {
        address: wmatic.address,
        decimals: wmatic.decimals,
        symbol: wmatic.symbol,
    },
};

const vaultBalance1 = ethers.BigNumber.from("10000000000000000000");
const vaultBalance2 = ethers.BigNumber.from("20000000000000000000");
const orderPairObject2 = {
    buyToken: usdt.address,
    buyTokenSymbol: usdt.symbol,
    buyTokenDecimals: usdt.decimals,
    sellToken: wmatic.address,
    sellTokenSymbol: wmatic.symbol,
    sellTokenDecimals: wmatic.decimals,
    takeOrders: [
        {
            id: "0x004349d76523bce3b6aeec93cf4c2a396b9cb71bc07f214e271cab363a0c89eb",
            vaultBalance: vaultBalance1,
            takeOrder: {
                order: {
                    owner: "0x0f47a0c7f86a615606ca315ad83c3e302b474bd6",
                    evaluable: {
                        interpreter: "0x1efd85e6c384fad9b80c6d508e9098eb91c4ed30",
                        store: "0x4ffc97bfb6dfce289f9b2a4083f5f5e940c8b88d",
                        expression: "0x224f9ca76a6f1b3414280bed0f68227c1b61f2b2"
                    },
                    validInputs: [{
                        token: usdt.address,
                        decimals: usdt.decimals,
                        vaultId: "0xdce98e3a7ee4b8b7ec1def4542b220083f8c3f0d569f142752cdc5bad6e14092"
                    }],
                    validOutputs: [{
                        token: wmatic.address,
                        decimals: wmatic.decimals,
                        vaultId: "0xdce98e3a7ee4b8b7ec1def4542b220083f8c3f0d569f142752cdc5bad6e14092"
                    }],
                    handleIO: false
                },
                inputIOIndex: 0,
                outputIOIndex: 0,
                signedContext: []
            }
        },
        {
            id: "0x008817a4b6f264326ef14357df54e48b9c064051f54f3877807970bb98096c01",
            vaultBalance: vaultBalance2,
            takeOrder: {
                order: {
                    owner: "0x0eb840e5acd0125853ad630663d3a62e673c22e6",
                    evaluable: {
                        interpreter: "0x1efd85e6c384fad9b80c6d508e9098eb91c4ed30",
                        store: "0x4ffc97bfb6dfce289f9b2a4083f5f5e940c8b88d",
                        expression: "0x224f9ca76a6f1b3414280bed0f68227c1b61f2b2"
                    },
                    validInputs: [{
                        token: usdt.address,
                        decimals: usdt.decimals,
                        vaultId: "0xdce98e3a7ee4b8b7ec1def4542b220083f8c3f0d569f142752cdc5bad6e14092"
                    }],
                    validOutputs: [{
                        token: wmatic.address,
                        decimals: wmatic.decimals,
                        vaultId: "0xdce98e3a7ee4b8b7ec1def4542b220083f8c3f0d569f142752cdc5bad6e14092"
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
    buyToken: usdt.address,
    buyTokenSymbol: usdt.symbol,
    buyTokenDecimals: usdt.decimals,
    sellToken: wmatic.address,
    sellTokenSymbol: wmatic.symbol,
    sellTokenDecimals: wmatic.decimals,
    takeOrders: [{
        id: "0x004349d76523bce3b6aeec93cf4c2a396b9cb71bc07f214e271cab363a0c89eb",
        vaultBalance,
        takeOrder: {
            order: {
                owner: "0x0f47a0c7f86a615606ca315ad83c3e302b474bd6",
                evaluable: {
                    interpreter: "0x1efd85e6c384fad9b80c6d508e9098eb91c4ed30",
                    store: "0x4ffc97bfb6dfce289f9b2a4083f5f5e940c8b88d",
                    expression: "0x224f9ca76a6f1b3414280bed0f68227c1b61f2b2"
                },
                validInputs: [{
                    token: usdt.address,
                    decimals: usdt.decimals,
                    vaultId: "0xdce98e3a7ee4b8b7ec1def4542b220083f8c3f0d569f142752cdc5bad6e14092"
                }],
                validOutputs: [{
                    token: wmatic.address,
                    decimals: wmatic.decimals,
                    vaultId: "0xdce98e3a7ee4b8b7ec1def4542b220083f8c3f0d569f142752cdc5bad6e14092"
                }],
                handleIO: false
            },
            inputIOIndex: 0,
            outputIOIndex: 0,
            signedContext: []
        }
    }]
};
const poolCodeMap = new Map([[
    "0x7c76B6B3FE14831A39C0fec908DA5f17180df677",
    new ConstantProductPoolCode(
        new ConstantProductRPool(
            "0x7c76B6B3FE14831A39C0fec908DA5f17180df677",
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
            "0xE7eb31f23A5BefEEFf76dbD2ED6AdC822568a5d2"
        ).routeCode
    ]
);
const expectedRouteVisual = visualizeRoute(fromToken, toToken, route.legs);

module.exports = {
    config,
    wmatic,
    usdt,
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
};