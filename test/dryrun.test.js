const { assert } = require("chai");
const { ethers } = require("hardhat");
const fixtures = require("./fixtures");
const { dryrun, DryrunHaltReason, dryrunWithRetries } = require("../src/processes/dryrun");

// mocking signer and dataFetcher
let signer = {};
let dataFetcher = {};

const {
    ethPrice,
    gasPrice,
    gasLimitEstimation,
    arb,
    vaultBalance,
    orderPairObject1: orderPairObject,
    fromToken,
    toToken,
    config,
    poolCodeMap,
    expectedRouteData,
    expectedRouteVisual,
} = fixtures;

describe("Test dryrun", async function () {
    beforeEach(() => {
        signer = {
            provider: {
                getBlockNumber: async () => 123456
            },
            estimateGas: async () => gasLimitEstimation
        };
        dataFetcher = {};
    });

    it("should find opp for full vault balance", async function () {
        dataFetcher.getCurrentPoolCodeMap = () => {
            return poolCodeMap;
        };
        const result = await dryrun({
            mode: 0,
            orderPairObject,
            dataFetcher,
            fromToken,
            toToken,
            signer,
            vaultBalance,
            gasPrice,
            arb,
            ethPrice,
            config,
        });
        const expectedTakeOrdersConfigStruct = {
            minimumInput: ethers.BigNumber.from("1"),
            maximumInput: vaultBalance,
            maximumIORatio: ethers.constants.MaxUint256,
            orders: [orderPairObject.takeOrders[0].takeOrder],
            data: expectedRouteData
        };
        const expected = {
            data: {
                rawtx: {
                    data: arb.interface.encodeFunctionData(
                        "arb",
                        [
                            expectedTakeOrdersConfigStruct,
                            gasLimitEstimation.mul("103").div("100").mul(gasPrice).div(2).div(
                                "1" + "0".repeat(18 - orderPairObject.buyTokenDecimals)
                            )
                        ]
                    ),
                    to: arb.address,
                    gasPrice,
                    gasLimit: gasLimitEstimation.mul("103").div("100"),
                },
                maximumInput: vaultBalance,
                gasCostInToken: gasLimitEstimation.mul("103").div("100").mul(gasPrice).div(2).div(
                    "1" + "0".repeat(18 - orderPairObject.buyTokenDecimals)
                ),
                takeOrdersConfigStruct: expectedTakeOrdersConfigStruct,
                price: ethers.BigNumber.from("996900600000000000"),
                routeVisual: expectedRouteVisual,
                oppBlockNumber: 123456
            },
            reason: undefined,
            spanAttributes: { oppBlockNumber: 123456 }
        };
        assert.deepEqual(result, expected);
    });

    it("should find opp with binary search", async function () {
        dataFetcher.getCurrentPoolCodeMap = () => {
            return poolCodeMap;
        };
        let rejectFirst = false;
        signer.estimateGas = async () => {
            if (!rejectFirst) {
                rejectFirst = true;
                return Promise.reject(ethers.errors.UNPREDICTABLE_GAS_LIMIT);
            } else return gasLimitEstimation;
        };
        const result = await dryrun({
            mode: 0,
            orderPairObject,
            dataFetcher,
            fromToken,
            toToken,
            signer,
            vaultBalance,
            gasPrice,
            arb,
            ethPrice,
            config,
        });
        const expectedTakeOrdersConfigStruct = {
            minimumInput: ethers.BigNumber.from("1"),
            maximumInput: vaultBalance.mul(3).div(4),
            maximumIORatio: ethers.constants.MaxUint256,
            orders: [orderPairObject.takeOrders[0].takeOrder],
            data: expectedRouteData
        };
        const expected = {
            data: {
                rawtx: {
                    data: arb.interface.encodeFunctionData(
                        "arb",
                        [
                            expectedTakeOrdersConfigStruct,
                            gasLimitEstimation.mul("103").div("100").mul(gasPrice).div(2).div(
                                "1" + "0".repeat(18 - orderPairObject.buyTokenDecimals)
                            )
                        ]
                    ),
                    to: arb.address,
                    gasPrice,
                    gasLimit: gasLimitEstimation.mul("103").div("100"),
                },
                maximumInput: vaultBalance.mul(3).div(4),
                gasCostInToken: gasLimitEstimation.mul("103").div("100").mul(gasPrice).div(2).div(
                    "1" + "0".repeat(18 - orderPairObject.buyTokenDecimals)
                ),
                takeOrdersConfigStruct: expectedTakeOrdersConfigStruct,
                price: ethers.BigNumber.from("0x0dd5ca4f08ebd555"),
                routeVisual: expectedRouteVisual,
                oppBlockNumber: 123456
            },
            reason: undefined,
            spanAttributes: { oppBlockNumber: 123456 }
        };
        assert.deepEqual(result, expected);
    });

    it("should NOT find opp", async function () {
        dataFetcher.getCurrentPoolCodeMap = () => {
            return poolCodeMap;
        };
        signer.estimateGas = async () => {
            return Promise.reject(ethers.errors.UNPREDICTABLE_GAS_LIMIT);
        };
        try {
            await dryrun({
                mode: 0,
                orderPairObject,
                dataFetcher,
                fromToken,
                toToken,
                signer,
                vaultBalance,
                gasPrice,
                arb,
                ethPrice,
                config,
            });
            assert.fail("expected to reject, but resolved");
        } catch (error) {
            const expected = {
                data: undefined,
                reason: DryrunHaltReason.NoOpportunity,
                spanAttributes: {
                    hops: [
                        `{"maxInput":"10000000000000000000","marketPrice":"0.9969006","blockNumber":123456,"route":${JSON.stringify(expectedRouteVisual)},"error":"${ethers.errors.UNPREDICTABLE_GAS_LIMIT}"}`,
                        "{\"maxInput\":\"5000000000000000000\",\"marketPrice\":\"0.9969502\",\"blockNumber\":123456}",
                        "{\"maxInput\":\"2500000000000000000\",\"marketPrice\":\"0.9969748\",\"blockNumber\":123456}",
                    ]
                }
            };
            assert.deepEqual(error, expected);
        }
    });

    it("should find no route", async function () {
        dataFetcher.getCurrentPoolCodeMap = () => {
            return new Map();
        };
        try {
            await dryrun({
                mode: 0,
                orderPairObject,
                dataFetcher,
                fromToken,
                toToken,
                signer,
                vaultBalance,
                gasPrice,
                arb,
                ethPrice,
                config,
            });
            assert.fail("expected to reject, but resolved");
        } catch (error) {
            const expected = {
                data: undefined,
                reason: DryrunHaltReason.NoRoute,
                spanAttributes: {
                    hops: [
                        "{\"maxInput\":\"10000000000000000000\",\"route\":\"no-way\"}",
                        "{\"maxInput\":\"5000000000000000000\",\"route\":\"no-way\"}",
                        "{\"maxInput\":\"2500000000000000000\",\"route\":\"no-way\"}",
                    ]
                }
            };
            assert.deepEqual(error, expected);
        }
    });

    it("should have no wallet fund", async function () {
        dataFetcher.getCurrentPoolCodeMap = () => {
            return poolCodeMap;
        };
        signer.estimateGas = async () => {
            return Promise.reject({ code: ethers.errors.INSUFFICIENT_FUNDS });
        };
        try {
            await dryrun({
                mode: 0,
                orderPairObject,
                dataFetcher,
                fromToken,
                toToken,
                signer,
                vaultBalance,
                gasPrice,
                arb,
                ethPrice,
                config,
            });
            assert.fail("expected to reject, but resolved");
        } catch (error) {
            const expected = {
                data: undefined,
                reason: DryrunHaltReason.NoWalletFund,
                spanAttributes: {},
            };
            assert.deepEqual(error, expected);
        }
    });
});

describe("Test dryrun with retries", async function () {
    beforeEach(() => {
        signer = {
            provider: {
                getBlockNumber: async () => 123456
            },
            estimateGas: async () => gasLimitEstimation
        };
        dataFetcher = {};
    });

    it("should find opp with 2 retries", async function () {
        dataFetcher.getCurrentPoolCodeMap = () => {
            return poolCodeMap;
        };
        let rejectFirst = false;
        signer.estimateGas = async () => {
            if (!rejectFirst) {
                rejectFirst = true;
                return Promise.reject(ethers.errors.UNPREDICTABLE_GAS_LIMIT);
            } else return gasLimitEstimation;
        };
        const result = await dryrunWithRetries({
            orderPairObject,
            dataFetcher,
            fromToken,
            toToken,
            signer,
            gasPrice,
            arb,
            ethPrice,
            config,
        });
        const expectedTakeOrdersConfigStruct = {
            minimumInput: ethers.BigNumber.from("1"),
            maximumInput: vaultBalance,
            maximumIORatio: ethers.constants.MaxUint256,
            orders: [
                orderPairObject.takeOrders[0].takeOrder,
                orderPairObject.takeOrders[0].takeOrder,
            ],
            data: expectedRouteData
        };
        const expected = {
            data: {
                rawtx: {
                    data: arb.interface.encodeFunctionData(
                        "arb",
                        [
                            expectedTakeOrdersConfigStruct,
                            gasLimitEstimation.mul("103").div("100").mul(gasPrice).div(2).div(
                                "1" + "0".repeat(18 - orderPairObject.buyTokenDecimals)
                            )
                        ]
                    ),
                    to: arb.address,
                    gasPrice,
                    gasLimit: gasLimitEstimation.mul("103").div("100"),
                },
                maximumInput: vaultBalance,
                gasCostInToken: gasLimitEstimation.mul("103").div("100").mul(gasPrice).div(2).div(
                    "1" + "0".repeat(18 - orderPairObject.buyTokenDecimals)
                ),
                takeOrdersConfigStruct: expectedTakeOrdersConfigStruct,
                price: ethers.BigNumber.from("996900600000000000"),
                routeVisual: expectedRouteVisual,
                oppBlockNumber: 123456
            },
            reason: undefined,
            error: undefined,
            spanAttributes: { oppBlockNumber: 123456 }
        };
        assert.deepEqual(result, expected);
    });

    it("should NOT find opp", async function () {
        dataFetcher.getCurrentPoolCodeMap = () => {
            return poolCodeMap;
        };
        signer.estimateGas = async () => {
            return Promise.reject(ethers.errors.UNPREDICTABLE_GAS_LIMIT);
        };
        try {
            await dryrunWithRetries({
                orderPairObject,
                dataFetcher,
                fromToken,
                toToken,
                signer,
                gasPrice,
                arb,
                ethPrice,
                config,
            });
            assert.fail("expected to reject, but resolved");
        } catch (error) {
            const expected = {
                data: undefined,
                reason: DryrunHaltReason.NoOpportunity,
                error: undefined,
                spanAttributes: {
                    hops: [
                        `{"maxInput":"10000000000000000000","marketPrice":"0.9969006","blockNumber":123456,"route":${JSON.stringify(expectedRouteVisual)},"error":"${ethers.errors.UNPREDICTABLE_GAS_LIMIT}"}`,
                        "{\"maxInput\":\"5000000000000000000\",\"marketPrice\":\"0.9969502\",\"blockNumber\":123456}",
                        "{\"maxInput\":\"2500000000000000000\",\"marketPrice\":\"0.9969748\",\"blockNumber\":123456}",
                    ]
                }
            };
            assert.deepEqual(error, expected);
        }
    });

    it("should find no route", async function () {
        dataFetcher.getCurrentPoolCodeMap = () => {
            return new Map();
        };
        try {
            await dryrunWithRetries({
                orderPairObject,
                dataFetcher,
                fromToken,
                toToken,
                signer,
                gasPrice,
                arb,
                ethPrice,
                config,
            });
            assert.fail("expected to reject, but resolved");
        } catch (error) {
            const expected = {
                data: undefined,
                reason: DryrunHaltReason.NoRoute,
                error: undefined,
                spanAttributes: {}
            };
            assert.deepEqual(error, expected);
        }
    });

    it("should have no wallet fund", async function () {
        dataFetcher.getCurrentPoolCodeMap = () => {
            return poolCodeMap;
        };
        signer.estimateGas = async () => {
            return Promise.reject({ code: ethers.errors.INSUFFICIENT_FUNDS });
        };
        try {
            await dryrunWithRetries({
                orderPairObject,
                dataFetcher,
                fromToken,
                toToken,
                signer,
                gasPrice,
                arb,
                ethPrice,
                config,
            });
            assert.fail("expected to reject, but resolved");
        } catch (error) {
            const expected = {
                data: undefined,
                reason: DryrunHaltReason.NoWalletFund,
                error: undefined,
                spanAttributes: {},
            };
            assert.deepEqual(error, expected);
        }
    });
});