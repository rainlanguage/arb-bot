const { assert } = require("chai");
const { ethers } = require("ethers");
const fixtures = require("./fixtures");
const { attemptOppAndClear, AttemptOppAndClearHaltReason } = require("../src/processes/processOpp");

let dataFetcher = {};
let signer = {};

const {
    ethPrice,
    gasPrice,
    gasLimitEstimation,
    arb,
    vaultBalance1,
    vaultBalance2,
    orderPairObject2: orderPairObject,
    fromToken,
    toToken,
    config,
    poolCodeMap,
    expectedRouteVisual,
    pair,
    orderbook,
    txHash,
    effectiveGasPrice,
    gasUsed,
    expectedRouteData,
    scannerUrl,
} = fixtures;

const bundledConfig = JSON.parse(JSON.stringify(config));
bundledConfig.bundle = true;
const unbundledConfig = JSON.parse(JSON.stringify(config));
unbundledConfig.bundle = false;

describe("Test process opp for bundled orders", async function () {
    beforeEach(() => {
        signer = {
            getAddress: () => "0x1F1E4c845183EF6d50E9609F16f6f9cAE43BC9Cb",
            provider: {
                getBlockNumber: async () => 123456
            },
            estimateGas: async () => gasLimitEstimation,
            sendTransaction: async () => {
                return {
                    hash: txHash,
                    wait: async () => {
                        return {
                            status: 1,
                            effectiveGasPrice,
                            gasUsed,
                            logs: [],
                            events: [],
                        };
                    }
                };
            }
        };
        dataFetcher = {};
    });

    it("should process opp and clear successfully", async function () {
        dataFetcher.getCurrentPoolCodeMap = () => {
            return poolCodeMap;
        };
        const result = await attemptOppAndClear({
            orderPairObject: orderPairObject,
            dataFetcher,
            fromToken,
            toToken,
            signer,
            flashbotSigner: undefined,
            gasPrice,
            arb,
            orderbook,
            ethPrice,
            config: bundledConfig,
            pair,
        });
        const expected = [
            {
                order: orderPairObject.takeOrders.map(v => v.id),
                report: {
                    txUrl: scannerUrl + "/tx/" + txHash,
                    tokenPair: pair,
                    buyToken: orderPairObject.buyToken,
                    sellToken: orderPairObject.sellToken,
                    clearedAmount: undefined,
                    actualGasCost: ethers.utils.formatUnits(effectiveGasPrice.mul(gasUsed)),
                    actualGasCostInToken: ethers.utils.formatUnits(
                        effectiveGasPrice.mul(gasUsed).div(2)
                    ).slice(0, orderPairObject.buyTokenDecimals + 2),
                    income: undefined,
                    netProfit: undefined,
                    clearedOrders: orderPairObject.takeOrders.map(v => v.id),
                },
                reason: undefined,
                error: undefined,
                spanAttributes: {
                    oppBlockNumber: 123456,
                    clearBlockNumber: 123456,
                    blockDiff: 0,
                    route: expectedRouteVisual,
                    maxInput: vaultBalance1.add(vaultBalance2).toString(),
                    marketPrice: "0.996701866666666666",
                    estimatedGasCostInToken: ethers.utils.formatUnits(
                        gasLimitEstimation.mul("103").div("100").mul(gasPrice).div(2)
                    ).slice(0, orderPairObject.buyTokenDecimals + 2),
                    txUrl: scannerUrl + "/tx/" + txHash,
                    tx: `{"hash":"${txHash}"}`,
                    gasCost: ethers.utils.formatUnits(effectiveGasPrice.mul(gasUsed)),
                    gasCostInToken: ethers.utils.formatUnits(
                        effectiveGasPrice.mul(gasUsed).div(2)
                    ).slice(0, orderPairObject.buyTokenDecimals + 2),
                }
            }
        ];
        assert.deepEqual(result, expected);
    });

    it("should find no opp", async function () {
        dataFetcher.getCurrentPoolCodeMap = () => {
            return poolCodeMap;
        };
        signer.estimateGas = async () => {
            return Promise.reject(ethers.errors.UNPREDICTABLE_GAS_LIMIT);
        };
        const result = await attemptOppAndClear({
            orderPairObject: orderPairObject,
            dataFetcher,
            fromToken,
            toToken,
            signer,
            flashbotSigner: undefined,
            gasPrice,
            arb,
            orderbook,
            ethPrice,
            config: bundledConfig,
            pair,
        });
        const expected = [
            {
                order: orderPairObject.takeOrders.map(v => v.id),
                report: undefined,
                reason: AttemptOppAndClearHaltReason.NoOpportunity,
                error: undefined,
                spanAttributes: { hops: [
                    `{"maxInput":"30000000000000000000","marketPrice":"0.996701866666666666","blockNumber":123456,"route":${JSON.stringify(expectedRouteVisual)},"error":"${ethers.errors.UNPREDICTABLE_GAS_LIMIT}"}`,
                    "{\"maxInput\":\"15000000000000000000\",\"marketPrice\":\"0.996850866666666666\",\"blockNumber\":123456}",
                    "{\"maxInput\":\"7500000000000000000\",\"marketPrice\":\"0.996925333333333333\",\"blockNumber\":123456}"
                ]}
            }
        ];
        assert.deepEqual(result, expected);
    });

    it("should find no route", async function () {
        dataFetcher.getCurrentPoolCodeMap = () => {
            return new Map();
        };
        const result = await attemptOppAndClear({
            orderPairObject: orderPairObject,
            dataFetcher,
            fromToken,
            toToken,
            signer,
            flashbotSigner: undefined,
            gasPrice,
            arb,
            orderbook,
            ethPrice,
            config: bundledConfig,
            pair,
        });
        const expected = [
            {
                order: orderPairObject.takeOrders.map(v => v.id),
                report: undefined,
                reason: AttemptOppAndClearHaltReason.NoRoute,
                error: undefined,
                spanAttributes: {}
            }
        ];
        assert.deepEqual(result, expected);
    });

    it("should find no route", async function () {
        dataFetcher.getCurrentPoolCodeMap = () => {
            return poolCodeMap;
        };
        signer.estimateGas = async () => {
            return Promise.reject({ code: ethers.errors.INSUFFICIENT_FUNDS });
        };
        const result = await attemptOppAndClear({
            orderPairObject: orderPairObject,
            dataFetcher,
            fromToken,
            toToken,
            signer,
            flashbotSigner: undefined,
            gasPrice,
            arb,
            orderbook,
            ethPrice,
            config: bundledConfig,
            pair,
        });
        const expected = [
            {
                order: orderPairObject.takeOrders.map(v => v.id),
                report: undefined,
                reason: AttemptOppAndClearHaltReason.NoWalletFund,
                error: undefined,
                spanAttributes: {}
            }
        ];
        assert.deepEqual(result, expected);
    });

    it("should fail to submit tx", async function () {
        dataFetcher.getCurrentPoolCodeMap = () => {
            return poolCodeMap;
        };
        signer.sendTransaction = async () => {
            return Promise.reject({ code: ethers.errors.UNPREDICTABLE_GAS_LIMIT });
        };
        const result = await attemptOppAndClear({
            orderPairObject: orderPairObject,
            dataFetcher,
            fromToken,
            toToken,
            signer,
            flashbotSigner: undefined,
            gasPrice,
            arb,
            orderbook,
            ethPrice,
            config: bundledConfig,
            pair,
        });
        const expectedTakeOrdersConfigStruct = {
            minimumInput: ethers.BigNumber.from("1"),
            maximumInput: vaultBalance1.add(vaultBalance2),
            maximumIORatio: ethers.constants.MaxUint256,
            orders: [
                orderPairObject.takeOrders[0].takeOrder,
                orderPairObject.takeOrders[1].takeOrder
            ],
            data: expectedRouteData
        };
        const rawtx = {
            data: arb.interface.encodeFunctionData(
                "arb",
                [
                    expectedTakeOrdersConfigStruct,
                    gasLimitEstimation.mul("103").div("100").mul(gasPrice).div(2).div(
                        "1" + "0".repeat(18 - orderPairObject.buyTokenDecimals)
                    ).mul(unbundledConfig.gasCoveragePercentage).div("100")
                ]
            ),
            to: arb.address,
            gasPrice,
            gasLimit: gasLimitEstimation.mul("103").div("100"),
        };
        const expected = [
            {
                order: orderPairObject.takeOrders.map(v => v.id),
                reason: AttemptOppAndClearHaltReason.TxFailed,
                error: { code: ethers.errors.UNPREDICTABLE_GAS_LIMIT },
                report: {
                    tokenPair: pair,
                    buyToken: orderPairObject.buyToken,
                    sellToken: orderPairObject.sellToken,
                },
                spanAttributes: {
                    oppBlockNumber: 123456,
                    clearBlockNumber: 123456,
                    blockDiff: 0,
                    route: expectedRouteVisual,
                    maxInput: vaultBalance1.add(vaultBalance2).toString(),
                    marketPrice: "0.996701866666666666",
                    estimatedGasCostInToken: ethers.utils.formatUnits(
                        gasLimitEstimation.mul("103").div("100").mul(gasPrice).div(2)
                    ).slice(0, orderPairObject.buyTokenDecimals + 2),
                    rawTx: JSON.stringify(rawtx)
                },
            }
        ];
        assert.deepEqual(result, expected);
    });

    it("should fail to mine tx", async function () {
        dataFetcher.getCurrentPoolCodeMap = () => {
            return poolCodeMap;
        };
        const receipt = {
            status: 0,
            effectiveGasPrice: 123,
            gasUsed: 456,
            logs: [],
            events: [],
        };
        signer.sendTransaction = async () => {
            return {
                hash: txHash,
                wait: async () => {
                    return receipt;
                }
            };
        };
        const result = await attemptOppAndClear({
            orderPairObject: orderPairObject,
            dataFetcher,
            fromToken,
            toToken,
            signer,
            flashbotSigner: undefined,
            gasPrice,
            arb,
            orderbook,
            ethPrice,
            config: bundledConfig,
            pair,
        });
        const expected = [
            {
                order: orderPairObject.takeOrders.map(v => v.id),
                reason: AttemptOppAndClearHaltReason.TxMineFailed,
                error: undefined,
                report: {
                    tokenPair: pair,
                    buyToken: orderPairObject.buyToken,
                    sellToken: orderPairObject.sellToken,
                    txUrl: scannerUrl + "/tx/" + txHash,
                },
                spanAttributes: {
                    oppBlockNumber: 123456,
                    clearBlockNumber: 123456,
                    blockDiff: 0,
                    route: expectedRouteVisual,
                    maxInput: vaultBalance1.add(vaultBalance2).toString(),
                    marketPrice: "0.996701866666666666",
                    estimatedGasCostInToken: ethers.utils.formatUnits(
                        gasLimitEstimation.mul("103").div("100").mul(gasPrice).div(2)
                    ).slice(0, orderPairObject.buyTokenDecimals + 2),
                    txUrl: scannerUrl + "/tx/" + txHash,
                    tx: `{"hash":"${txHash}"}`,
                    receipt: JSON.stringify(receipt),
                },
            }
        ];
        assert.deepEqual(result, expected);
    });
});

describe("Test process opp for single orders", async function () {
    beforeEach(() => {
        signer = {
            getAddress: () => "0x1F1E4c845183EF6d50E9609F16f6f9cAE43BC9Cb",
            provider: {
                getBlockNumber: async () => 123456
            },
            estimateGas: async () => gasLimitEstimation,
            sendTransaction: async () => {
                return {
                    hash: txHash,
                    wait: async () => {
                        return {
                            status: 1,
                            effectiveGasPrice,
                            gasUsed,
                            logs: [],
                            events: [],
                        };
                    }
                };
            }
        };
        dataFetcher = {};
    });

    it("should process opp and clear successfully", async function () {
        dataFetcher.getCurrentPoolCodeMap = () => {
            return poolCodeMap;
        };
        const result = await attemptOppAndClear({
            orderPairObject: orderPairObject,
            dataFetcher,
            fromToken,
            toToken,
            signer,
            flashbotSigner: undefined,
            gasPrice,
            arb,
            orderbook,
            ethPrice,
            config: unbundledConfig,
            pair,
        });
        const expected = [
            {
                order: orderPairObject.takeOrders[0].id,
                report: {
                    txUrl: scannerUrl + "/tx/" + txHash,
                    tokenPair: pair,
                    buyToken: orderPairObject.buyToken,
                    sellToken: orderPairObject.sellToken,
                    clearedAmount: undefined,
                    actualGasCost: ethers.utils.formatUnits(effectiveGasPrice.mul(gasUsed)),
                    actualGasCostInToken: ethers.utils.formatUnits(
                        effectiveGasPrice.mul(gasUsed).div(2)
                    ).slice(0, orderPairObject.buyTokenDecimals + 2),
                    income: undefined,
                    netProfit: undefined,
                    clearedOrders: [orderPairObject.takeOrders[0].id]
                },
                reason: undefined,
                error: undefined,
                spanAttributes: {
                    oppBlockNumber: 123456,
                    clearBlockNumber: 123456,
                    blockDiff: 0,
                    route: expectedRouteVisual,
                    maxInput: vaultBalance1.toString(),
                    marketPrice: "0.9969006",
                    estimatedGasCostInToken: ethers.utils.formatUnits(
                        gasLimitEstimation.mul("103").div("100").mul(gasPrice).div(2)
                    ).slice(0, orderPairObject.buyTokenDecimals + 2),
                    txUrl: scannerUrl + "/tx/" + txHash,
                    tx: `{"hash":"${txHash}"}`,
                    gasCost: ethers.utils.formatUnits(effectiveGasPrice.mul(gasUsed)),
                    gasCostInToken: ethers.utils.formatUnits(
                        effectiveGasPrice.mul(gasUsed).div(2)
                    ).slice(0, orderPairObject.buyTokenDecimals + 2),
                }
            },
            {
                order: orderPairObject.takeOrders[1].id,
                report: {
                    txUrl: scannerUrl + "/tx/" + txHash,
                    tokenPair: pair,
                    buyToken: orderPairObject.buyToken,
                    sellToken: orderPairObject.sellToken,
                    clearedAmount: undefined,
                    actualGasCost: ethers.utils.formatUnits(effectiveGasPrice.mul(gasUsed)),
                    actualGasCostInToken: ethers.utils.formatUnits(
                        effectiveGasPrice.mul(gasUsed).div(2)
                    ).slice(0, orderPairObject.buyTokenDecimals + 2),
                    income: undefined,
                    netProfit: undefined,
                    clearedOrders: [orderPairObject.takeOrders[1].id]
                },
                reason: undefined,
                error: undefined,
                spanAttributes: {
                    oppBlockNumber: 123456,
                    clearBlockNumber: 123456,
                    blockDiff: 0,
                    route: expectedRouteVisual,
                    maxInput: vaultBalance2.toString(),
                    marketPrice: "0.9968012",
                    estimatedGasCostInToken: ethers.utils.formatUnits(
                        gasLimitEstimation.mul("103").div("100").mul(gasPrice).div(2)
                    ).slice(0, orderPairObject.buyTokenDecimals + 2),
                    txUrl: scannerUrl + "/tx/" + txHash,
                    tx: `{"hash":"${txHash}"}`,
                    gasCost: ethers.utils.formatUnits(effectiveGasPrice.mul(gasUsed)),
                    gasCostInToken: ethers.utils.formatUnits(
                        effectiveGasPrice.mul(gasUsed).div(2)
                    ).slice(0, orderPairObject.buyTokenDecimals + 2),
                }
            }
        ];
        assert.deepEqual(result, expected);
    });

    it("should find no opp", async function () {
        dataFetcher.getCurrentPoolCodeMap = () => {
            return poolCodeMap;
        };
        signer.estimateGas = async () => {
            return Promise.reject(ethers.errors.UNPREDICTABLE_GAS_LIMIT);
        };
        const result = await attemptOppAndClear({
            orderPairObject: orderPairObject,
            dataFetcher,
            fromToken,
            toToken,
            signer,
            flashbotSigner: undefined,
            gasPrice,
            arb,
            orderbook,
            ethPrice,
            config: unbundledConfig,
            pair,
        });
        const expected = [
            {
                order: orderPairObject.takeOrders[0].id,
                report: undefined,
                reason: AttemptOppAndClearHaltReason.NoOpportunity,
                error: undefined,
                spanAttributes: { hops: [
                    `{"maxInput":"10000000000000000000","marketPrice":"0.9969006","blockNumber":123456,"route":${JSON.stringify(expectedRouteVisual)},"error":"${ethers.errors.UNPREDICTABLE_GAS_LIMIT}"}`,
                    "{\"maxInput\":\"5000000000000000000\",\"marketPrice\":\"0.9969502\",\"blockNumber\":123456}",
                    "{\"maxInput\":\"2500000000000000000\",\"marketPrice\":\"0.9969748\",\"blockNumber\":123456}"
                ]}
            },
            {
                order: orderPairObject.takeOrders[1].id,
                report: undefined,
                reason: AttemptOppAndClearHaltReason.NoOpportunity,
                error: undefined,
                spanAttributes: { hops: [
                    `{"maxInput":"20000000000000000000","marketPrice":"0.9968012","blockNumber":123456,"route":${JSON.stringify(expectedRouteVisual)},"error":"${ethers.errors.UNPREDICTABLE_GAS_LIMIT}"}`,
                    "{\"maxInput\":\"10000000000000000000\",\"marketPrice\":\"0.9969006\",\"blockNumber\":123456}",
                    "{\"maxInput\":\"5000000000000000000\",\"marketPrice\":\"0.9969502\",\"blockNumber\":123456}"
                ]}
            }
        ];
        assert.deepEqual(result, expected);
    });

    it("should find no route", async function () {
        dataFetcher.getCurrentPoolCodeMap = () => {
            return new Map();
        };
        const result = await attemptOppAndClear({
            orderPairObject: orderPairObject,
            dataFetcher,
            fromToken,
            toToken,
            signer,
            flashbotSigner: undefined,
            gasPrice,
            arb,
            orderbook,
            ethPrice,
            config: unbundledConfig,
            pair,
        });
        const expected = [
            {
                order: orderPairObject.takeOrders[0].id,
                report: undefined,
                reason: AttemptOppAndClearHaltReason.NoRoute,
                error: undefined,
                spanAttributes: {}
            },
            {
                order: orderPairObject.takeOrders[1].id,
                report: undefined,
                reason: AttemptOppAndClearHaltReason.NoRoute,
                error: undefined,
                spanAttributes: {}
            }
        ];
        assert.deepEqual(result, expected);
    });

    it("should find no route", async function () {
        dataFetcher.getCurrentPoolCodeMap = () => {
            return poolCodeMap;
        };
        signer.estimateGas = async () => {
            return Promise.reject({ code: ethers.errors.INSUFFICIENT_FUNDS });
        };
        const result = await attemptOppAndClear({
            orderPairObject: orderPairObject,
            dataFetcher,
            fromToken,
            toToken,
            signer,
            flashbotSigner: undefined,
            gasPrice,
            arb,
            orderbook,
            ethPrice,
            config: unbundledConfig,
            pair,
        });
        const expected = [
            {
                order: orderPairObject.takeOrders[0].id,
                report: undefined,
                reason: AttemptOppAndClearHaltReason.NoWalletFund,
                error: undefined,
                spanAttributes: {}
            },
            {
                order: orderPairObject.takeOrders[1].id,
                report: undefined,
                reason: AttemptOppAndClearHaltReason.NoWalletFund,
                error: undefined,
                spanAttributes: {}
            }
        ];
        assert.deepEqual(result, expected);
    });

    it("should fail to submit tx", async function () {
        dataFetcher.getCurrentPoolCodeMap = () => {
            return poolCodeMap;
        };
        signer.sendTransaction = async () => {
            return Promise.reject({ code: ethers.errors.UNPREDICTABLE_GAS_LIMIT });
        };
        const result = await attemptOppAndClear({
            orderPairObject: orderPairObject,
            dataFetcher,
            fromToken,
            toToken,
            signer,
            flashbotSigner: undefined,
            gasPrice,
            arb,
            orderbook,
            ethPrice,
            config: unbundledConfig,
            pair,
        });
        const expectedTakeOrdersConfigStruct1 = {
            minimumInput: ethers.BigNumber.from("1"),
            maximumInput: vaultBalance1,
            maximumIORatio: ethers.constants.MaxUint256,
            orders: [orderPairObject.takeOrders[0].takeOrder],
            data: expectedRouteData
        };
        const rawtx1 = {
            data: arb.interface.encodeFunctionData(
                "arb",
                [
                    expectedTakeOrdersConfigStruct1,
                    gasLimitEstimation.mul("103").div("100").mul(gasPrice).div(2).div(
                        "1" + "0".repeat(18 - orderPairObject.buyTokenDecimals)
                    ).mul(unbundledConfig.gasCoveragePercentage).div("100")
                ]
            ),
            to: arb.address,
            gasPrice,
            gasLimit: gasLimitEstimation.mul("103").div("100"),
        };
        const expectedTakeOrdersConfigStruct2 = {
            minimumInput: ethers.BigNumber.from("1"),
            maximumInput: vaultBalance2,
            maximumIORatio: ethers.constants.MaxUint256,
            orders: [orderPairObject.takeOrders[1].takeOrder],
            data: expectedRouteData
        };
        const rawtx2 = {
            data: arb.interface.encodeFunctionData(
                "arb",
                [
                    expectedTakeOrdersConfigStruct2,
                    gasLimitEstimation.mul("103").div("100").mul(gasPrice).div(2).div(
                        "1" + "0".repeat(18 - orderPairObject.buyTokenDecimals)
                    ).mul(unbundledConfig.gasCoveragePercentage).div("100")
                ]
            ),
            to: arb.address,
            gasPrice,
            gasLimit: gasLimitEstimation.mul("103").div("100"),
        };
        const expected = [
            {
                order: orderPairObject.takeOrders[0].id,
                reason: AttemptOppAndClearHaltReason.TxFailed,
                error: { code: ethers.errors.UNPREDICTABLE_GAS_LIMIT },
                report: {
                    tokenPair: pair,
                    buyToken: orderPairObject.buyToken,
                    sellToken: orderPairObject.sellToken,
                },
                spanAttributes: {
                    oppBlockNumber: 123456,
                    clearBlockNumber: 123456,
                    blockDiff: 0,
                    route: expectedRouteVisual,
                    maxInput: vaultBalance1.toString(),
                    marketPrice: "0.9969006",
                    estimatedGasCostInToken: ethers.utils.formatUnits(
                        gasLimitEstimation.mul("103").div("100").mul(gasPrice).div(2)
                    ).slice(0, orderPairObject.buyTokenDecimals + 2),
                    rawTx: JSON.stringify(rawtx1)
                },
            },
            {
                order: orderPairObject.takeOrders[1].id,
                reason: AttemptOppAndClearHaltReason.TxFailed,
                error: { code: ethers.errors.UNPREDICTABLE_GAS_LIMIT },
                report: {
                    tokenPair: pair,
                    buyToken: orderPairObject.buyToken,
                    sellToken: orderPairObject.sellToken,
                },
                spanAttributes: {
                    oppBlockNumber: 123456,
                    clearBlockNumber: 123456,
                    blockDiff: 0,
                    route: expectedRouteVisual,
                    maxInput: vaultBalance2.toString(),
                    marketPrice: "0.9968012",
                    estimatedGasCostInToken: ethers.utils.formatUnits(
                        gasLimitEstimation.mul("103").div("100").mul(gasPrice).div(2)
                    ).slice(0, orderPairObject.buyTokenDecimals + 2),
                    rawTx: JSON.stringify(rawtx2)
                },
            }
        ];
        assert.deepEqual(result, expected);
    });

    it("should fail to mine tx", async function () {
        dataFetcher.getCurrentPoolCodeMap = () => {
            return poolCodeMap;
        };
        const receipt = {
            status: 0,
            effectiveGasPrice: 123,
            gasUsed: 456,
            logs: [],
            events: [],
        };
        signer.sendTransaction = async () => {
            return {
                hash: txHash,
                wait: async () => {
                    return receipt;
                }
            };
        };
        const result = await attemptOppAndClear({
            orderPairObject: orderPairObject,
            dataFetcher,
            fromToken,
            toToken,
            signer,
            flashbotSigner: undefined,
            gasPrice,
            arb,
            orderbook,
            ethPrice,
            config: unbundledConfig,
            pair,
        });
        const expected = [
            {
                order: orderPairObject.takeOrders[0].id,
                reason: AttemptOppAndClearHaltReason.TxMineFailed,
                error: undefined,
                report: {
                    tokenPair: pair,
                    buyToken: orderPairObject.buyToken,
                    sellToken: orderPairObject.sellToken,
                    txUrl: scannerUrl + "/tx/" + txHash,
                },
                spanAttributes: {
                    oppBlockNumber: 123456,
                    clearBlockNumber: 123456,
                    blockDiff: 0,
                    route: expectedRouteVisual,
                    maxInput: vaultBalance1.toString(),
                    marketPrice: "0.9969006",
                    estimatedGasCostInToken: ethers.utils.formatUnits(
                        gasLimitEstimation.mul("103").div("100").mul(gasPrice).div(2)
                    ).slice(0, orderPairObject.buyTokenDecimals + 2),
                    txUrl: scannerUrl + "/tx/" + txHash,
                    tx: `{"hash":"${txHash}"}`,
                    receipt: JSON.stringify(receipt),
                },
            },
            {
                order: orderPairObject.takeOrders[1].id,
                reason: AttemptOppAndClearHaltReason.TxMineFailed,
                error: undefined,
                report: {
                    tokenPair: pair,
                    buyToken: orderPairObject.buyToken,
                    sellToken: orderPairObject.sellToken,
                    txUrl: scannerUrl + "/tx/" + txHash,
                },
                spanAttributes: {
                    oppBlockNumber: 123456,
                    clearBlockNumber: 123456,
                    blockDiff: 0,
                    route: expectedRouteVisual,
                    maxInput: vaultBalance2.toString(),
                    marketPrice: "0.9968012",
                    estimatedGasCostInToken: ethers.utils.formatUnits(
                        gasLimitEstimation.mul("103").div("100").mul(gasPrice).div(2)
                    ).slice(0, orderPairObject.buyTokenDecimals + 2),
                    txUrl: scannerUrl + "/tx/" + txHash,
                    tx: `{"hash":"${txHash}"}`,
                    receipt: JSON.stringify(receipt),
                },
            }
        ];
        assert.deepEqual(result, expected);
    });
});