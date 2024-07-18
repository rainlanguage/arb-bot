const { assert } = require("chai");
const testData = require("./data");
const { DefaultArbEvaluable } = require("../src/abis");
const { ethers, utils: { formatUnits } } = require("ethers");
const { dryrun, findOpp, findOppWithRetries, DryrunHaltReason } = require("../src/dryrun");

// mocking signer and dataFetcher
let signer = {};
let dataFetcher = {};
const viemClient = {
    getBlockNumber: async() => BigInt(oppBlockNumber)
};

const oppBlockNumber = 123456;
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
    getCurrentPrice,
} = testData;

describe("Test dryrun", async function () {
    beforeEach(() => {
        signer = {
            provider: {
                getBlockNumber: async () => oppBlockNumber
            },
            estimateGas: async () => gasLimitEstimation,
            getBalance: async () => ethers.BigNumber.from(0)
        };
        dataFetcher = {};
    });

    it("should succeed", async function () {
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
            maximumInput: vaultBalance,
            gasPrice,
            arb,
            ethPrice,
            config,
            viemClient,
            knownInitGas: { value: undefined },
        });
        const expectedTakeOrdersConfigStruct = {
            minimumInput: ethers.constants.One,
            maximumInput: vaultBalance,
            maximumIORatio: ethers.constants.MaxUint256,
            orders: [orderPairObject.takeOrders[0].takeOrder],
            data: expectedRouteData
        };
        const expected = {
            value: {
                rawtx: {
                    data: arb.interface.encodeFunctionData(
                        "arb2",
                        [
                            expectedTakeOrdersConfigStruct,
                            gasLimitEstimation.mul("103").div("100").mul(gasPrice).div(2).div(
                                "1" + "0".repeat(18 - orderPairObject.buyTokenDecimals)
                            ),
                            DefaultArbEvaluable
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
                price: getCurrentPrice(vaultBalance),
                routeVisual: expectedRouteVisual,
                oppBlockNumber,
            },
            reason: undefined,
            spanAttributes: { oppBlockNumber, foundOpp: true }
        };
        assert.deepEqual(result, expected);
    });

    it("should fail with no route", async function () {
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
                maximumInput: vaultBalance,
                gasPrice,
                arb,
                ethPrice,
                config,
                viemClient,
                knownInitGas: { value: undefined },
            });
            assert.fail("expected to reject, but resolved");
        } catch (error) {
            const expected = {
                value: undefined,
                reason: DryrunHaltReason.NoRoute,
                spanAttributes: {
                    maxInput: vaultBalance.toString(),
                    route: "no-way"
                }
            };
            assert.deepEqual(error, expected);
        }
    });

    it("should fail with no wallet fund", async function () {
        const noFundError = { code: ethers.errors.INSUFFICIENT_FUNDS };
        dataFetcher.getCurrentPoolCodeMap = () => {
            return poolCodeMap;
        };
        signer.estimateGas = async () => {
            return Promise.reject(noFundError);
        };
        try {
            await dryrun({
                mode: 0,
                orderPairObject,
                dataFetcher,
                fromToken,
                toToken,
                signer,
                maximumInput: vaultBalance,
                gasPrice,
                arb,
                ethPrice,
                config,
                viemClient,
                knownInitGas: { value: undefined },
            });
            assert.fail("expected to reject, but resolved");
        } catch (error) {
            const expected = {
                value: undefined,
                reason: DryrunHaltReason.NoWalletFund,
                spanAttributes: {
                    marketPrice: formatUnits(getCurrentPrice(vaultBalance)),
                    maxInput: vaultBalance.toString(),
                    blockNumber: oppBlockNumber,
                    error: noFundError,
                    route: expectedRouteVisual,
                    currentWalletBalance: "0",
                }
            };
            assert.deepEqual(error, expected);
        }
    });

    it("should fail with no opp", async function () {
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
                maximumInput: vaultBalance,
                gasPrice,
                arb,
                ethPrice,
                config,
                viemClient,
                knownInitGas: { value: undefined },
            });
            assert.fail("expected to reject, but resolved");
        } catch (error) {
            const expected = {
                value: undefined,
                reason: DryrunHaltReason.NoOpportunity,
                spanAttributes: {
                    marketPrice: formatUnits(getCurrentPrice(vaultBalance)),
                    maxInput: vaultBalance.toString(),
                    blockNumber: oppBlockNumber,
                    error: ethers.errors.UNPREDICTABLE_GAS_LIMIT,
                    route: expectedRouteVisual,
                }
            };
            assert.deepEqual(error, expected);
        }
    });
});

describe("Test find opp", async function () {
    beforeEach(() => {
        signer = {
            provider: {
                getBlockNumber: async () => oppBlockNumber
            },
            estimateGas: async () => gasLimitEstimation,
            getBalance: async () => ethers.BigNumber.from(0)
        };
        dataFetcher = {};
    });

    it("should find opp for full vault balance", async function () {
        dataFetcher.getCurrentPoolCodeMap = () => {
            return poolCodeMap;
        };
        const result = await findOpp({
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
            viemClient,
        });
        const expectedTakeOrdersConfigStruct = {
            minimumInput: ethers.constants.One,
            maximumInput: vaultBalance,
            maximumIORatio: ethers.constants.MaxUint256,
            orders: [orderPairObject.takeOrders[0].takeOrder],
            data: expectedRouteData
        };
        const expected = {
            value: {
                rawtx: {
                    data: arb.interface.encodeFunctionData(
                        "arb2",
                        [
                            expectedTakeOrdersConfigStruct,
                            gasLimitEstimation.mul("103").div("100").mul(gasPrice).div(2).div(
                                "1" + "0".repeat(18 - orderPairObject.buyTokenDecimals)
                            ),
                            DefaultArbEvaluable
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
                price: getCurrentPrice(vaultBalance),
                routeVisual: expectedRouteVisual,
                oppBlockNumber
            },
            reason: undefined,
            spanAttributes: { oppBlockNumber, foundOpp: true }
        };
        assert.deepEqual(result, expected);
    });

    it("should find opp with binary search", async function () {
        dataFetcher.getCurrentPoolCodeMap = () => {
            return poolCodeMap;
        };
        // mock the signer to reject the first attempt on gas estimation
        // so the dryrun goes into binary search
        let rejectFirst = true;
        signer.estimateGas = async () => {
            if (rejectFirst) {
                rejectFirst = false;
                return Promise.reject(ethers.errors.UNPREDICTABLE_GAS_LIMIT);
            } else return gasLimitEstimation;
        };
        const result = await findOpp({
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
            viemClient,
        });
        const expectedTakeOrdersConfigStruct = {
            minimumInput: ethers.constants.One,
            maximumInput: vaultBalance.mul(3).div(4),
            maximumIORatio: ethers.constants.MaxUint256,
            orders: [orderPairObject.takeOrders[0].takeOrder],
            data: expectedRouteData
        };
        const expected = {
            value: {
                rawtx: {
                    data: arb.interface.encodeFunctionData(
                        "arb2",
                        [
                            expectedTakeOrdersConfigStruct,
                            gasLimitEstimation.mul("103").div("100").mul(gasPrice).div(2).div(
                                "1" + "0".repeat(18 - orderPairObject.buyTokenDecimals)
                            ),
                            DefaultArbEvaluable
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
                price: getCurrentPrice(vaultBalance.sub(vaultBalance.div(4))),
                routeVisual: expectedRouteVisual,
                oppBlockNumber
            },
            reason: undefined,
            spanAttributes: { oppBlockNumber, foundOpp: true }
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
            await findOpp({
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
                viemClient,
            });
            assert.fail("expected to reject, but resolved");
        } catch (error) {
            const expected = {
                value: undefined,
                reason: DryrunHaltReason.NoOpportunity,
                spanAttributes: {
                    hops: [
                        `{"maxInput":"${vaultBalance.toString()}","marketPrice":"${formatUnits(getCurrentPrice(vaultBalance))}","route":${JSON.stringify(expectedRouteVisual)},"blockNumber":${oppBlockNumber},"error":"${ethers.errors.UNPREDICTABLE_GAS_LIMIT}"}`,
                        `{"maxInput":"${vaultBalance.div(2).toString()}","marketPrice":"${formatUnits(getCurrentPrice(vaultBalance.div(2)))}","route":${JSON.stringify(expectedRouteVisual)},"blockNumber":${oppBlockNumber}}`,
                        `{"maxInput":"${vaultBalance.div(4).toString()}","marketPrice":"${formatUnits(getCurrentPrice(vaultBalance.div(4)))}","route":${JSON.stringify(expectedRouteVisual)},"blockNumber":${oppBlockNumber}}`,
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
            await findOpp({
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
                viemClient,
            });
            assert.fail("expected to reject, but resolved");
        } catch (error) {
            const expected = {
                value: undefined,
                reason: DryrunHaltReason.NoRoute,
                spanAttributes: {
                    hops: [
                        `{"maxInput":"${vaultBalance.toString()}","route":"no-way"}`,
                        `{"maxInput":"${vaultBalance.div(2).toString()}","route":"no-way"}`,
                        `{"maxInput":"${vaultBalance.div(4).toString()}","route":"no-way"}`,
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
            await findOpp({
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
                viemClient,
            });
            assert.fail("expected to reject, but resolved");
        } catch (error) {
            const expected = {
                value: undefined,
                reason: DryrunHaltReason.NoWalletFund,
                spanAttributes: { currentWalletBalance: "0" },
            };
            assert.deepEqual(error, expected);
        }
    });
});

describe("Test find opp with retries", async function () {
    beforeEach(() => {
        signer = {
            provider: {
                getBlockNumber: async () => oppBlockNumber
            },
            estimateGas: async () => gasLimitEstimation,
            getBalance: async () => ethers.BigNumber.from(0)
        };
        dataFetcher = {};
    });

    it("should find opp with 2 retries", async function () {
        dataFetcher.getCurrentPoolCodeMap = () => {
            return poolCodeMap;
        };
        let rejectFirst = true;
        signer.estimateGas = async () => {
            if (rejectFirst) {
                rejectFirst = false;
                return Promise.reject(ethers.errors.UNPREDICTABLE_GAS_LIMIT);
            } else return gasLimitEstimation;
        };
        const result = await findOppWithRetries({
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
            viemClient,
        });
        const expectedTakeOrdersConfigStruct = {
            minimumInput: ethers.constants.One,
            maximumInput: vaultBalance,
            maximumIORatio: ethers.constants.MaxUint256,
            orders: [
                orderPairObject.takeOrders[0].takeOrder,
                orderPairObject.takeOrders[0].takeOrder,
            ],
            data: expectedRouteData
        };
        const expected = {
            value: {
                rawtx: {
                    data: arb.interface.encodeFunctionData(
                        "arb2",
                        [
                            expectedTakeOrdersConfigStruct,
                            gasLimitEstimation.mul("103").div("100").mul(gasPrice).div(2).div(
                                "1" + "0".repeat(18 - orderPairObject.buyTokenDecimals)
                            ),
                            DefaultArbEvaluable
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
                price: getCurrentPrice(vaultBalance),
                routeVisual: expectedRouteVisual,
                oppBlockNumber
            },
            reason: undefined,
            spanAttributes: { oppBlockNumber, foundOpp: true }
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
            await findOppWithRetries({
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
                viemClient,
            });
            assert.fail("expected to reject, but resolved");
        } catch (error) {
            const expected = {
                value: undefined,
                reason: DryrunHaltReason.NoOpportunity,
                spanAttributes: {
                    hops: [
                        `{"maxInput":"${vaultBalance.toString()}","marketPrice":"${formatUnits(getCurrentPrice(vaultBalance))}","route":${JSON.stringify(expectedRouteVisual)},"blockNumber":${oppBlockNumber},"error":"${ethers.errors.UNPREDICTABLE_GAS_LIMIT}"}`,
                        `{"maxInput":"${vaultBalance.div(2).toString()}","marketPrice":"${formatUnits(getCurrentPrice(vaultBalance.div(2)))}","route":${JSON.stringify(expectedRouteVisual)},"blockNumber":${oppBlockNumber}}`,
                        `{"maxInput":"${vaultBalance.div(4).toString()}","marketPrice":"${formatUnits(getCurrentPrice(vaultBalance.div(4)))}","route":${JSON.stringify(expectedRouteVisual)},"blockNumber":${oppBlockNumber}}`,
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
            await findOppWithRetries({
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
                viemClient,
            });
            assert.fail("expected to reject, but resolved");
        } catch (error) {
            const expected = {
                value: undefined,
                reason: DryrunHaltReason.NoRoute,
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
            await findOppWithRetries({
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
                viemClient,
            });
            assert.fail("expected to reject, but resolved");
        } catch (error) {
            const expected = {
                value: undefined,
                reason: DryrunHaltReason.NoWalletFund,
                spanAttributes: { currentWalletBalance: "0" },
            };
            assert.deepEqual(error, expected);
        }
    });
});
