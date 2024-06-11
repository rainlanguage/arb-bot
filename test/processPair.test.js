const { assert } = require("chai");
const { ethers } = require("ethers");
const fixtures = require("./fixtures");
const { processPair, ProcessPairHaltReason } = require("../src/processes/processPair");

describe("Test process pair", async function () {
    let dataFetcher = {};
    let signer = {};
    let viemClient = {};

    const {
        gasPrice,
        gasLimitEstimation,
        arb,
        vaultBalance,
        orderPairObject1: orderPairObject,
        config: fixtureConfig,
        poolCodeMap,
        expectedRouteVisual,
        pair,
        orderbook,
        txHash,
        effectiveGasPrice,
        gasUsed,
        scannerUrl,
    } = fixtures;
    const config = JSON.parse(JSON.stringify(fixtureConfig));

    beforeEach(() => {
        config.gasCoveragePercentage = "0";
        signer = {
            getAddress: () => "0x1F1E4c845183EF6d50E9609F16f6f9cAE43BC9Cb",
            provider: {
                getBlockNumber: async () => 123456,
                getGasPrice: async () => gasPrice,
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
        dataFetcher = {
            fetchPoolsForToken: async () => {}
        };
        viemClient = {
            chain: { id: 137 },
            multicall: async () => [vaultBalance.toBigInt()]
        };
    });

    it("should process pair successfully", async function () {
        dataFetcher.getCurrentPoolCodeMap = () => {
            return poolCodeMap;
        };
        const result = await processPair({
            config,
            orderPairObject,
            viemClient,
            dataFetcher,
            signer,
            flashbotSigner: undefined,
            arb,
            orderbook,
            pair,
        });
        const expected = {
            reports: [{
                txUrl: scannerUrl + "/tx/" + txHash,
                tokenPair: pair,
                buyToken: orderPairObject.buyToken,
                sellToken: orderPairObject.sellToken,
                clearedAmount: undefined,
                actualGasCost: ethers.utils.formatUnits(effectiveGasPrice.mul(gasUsed)),
                actualGasCostInToken: "0.0",
                income: undefined,
                netProfit: undefined,
                clearedOrders: [orderPairObject.takeOrders[0].id],
                order: orderPairObject.takeOrders[0].id,
                spanAttributes: {
                    "details.blockDiff": 0,
                    "details.clearBlockNumber": 123456,
                    "details.estimatedGasCostInToken": "0.0",
                    "details.gasCost": ethers.utils.formatUnits(effectiveGasPrice.mul(gasUsed)),
                    "details.gasCostInToken": "0.0",
                    "details.marketPrice": "0.9969006",
                    "details.maxInput": vaultBalance.toString(),
                    "details.oppBlockNumber": 123456,
                    "details.order": orderPairObject.takeOrders[0].id,
                    "details.route": expectedRouteVisual,
                    "details.tx": `{"hash":"${txHash}"}`,
                    "details.txUrl": scannerUrl + "/tx/" + txHash,
                }
            }],
            reason: undefined,
            error: undefined,
            sharedSpanAttributes: {
                "details.pair": pair,
                "details.output": orderPairObject.sellToken,
                "details.input": orderPairObject.buyToken,
                "details.gasPrice": gasPrice.toString()
            }
        };
        assert.deepEqual(result, expected);
    });

    it("should have no vault balance", async function () {
        viemClient.multicall = async () => [0n];
        // set vault balance to zero
        const orderPairObjectCopy = JSON.parse(JSON.stringify(orderPairObject));
        orderPairObjectCopy.takeOrders[0].vaultBalance = ethers.constants.Zero;
        try {
            await processPair({
                config,
                orderPairObject: orderPairObjectCopy,
                viemClient,
                dataFetcher,
                signer,
                flashbotSigner: undefined,
                arb,
                orderbook,
                pair,
            });
            assert.fail("expected to reject, but resolved");
        } catch(error) {
            const expected = {
                reports: [],
                reason: ProcessPairHaltReason.EmptyVault,
                error: undefined,
                sharedSpanAttributes: {
                    "details.pair": pair,
                    "details.output": orderPairObject.sellToken,
                    "details.input": orderPairObject.buyToken,
                    "details.orders": [orderPairObject.takeOrders[0].id]
                }
            };
            assert.deepEqual(error, expected);
        }
    });

    it("should fail to get vault balance", async function () {
        const evmError = { code: ethers.errors.CALL_EXCEPTION };
        viemClient.multicall = async () => {
            return Promise.reject(evmError);
        };
        try {
            await processPair({
                config,
                orderPairObject,
                viemClient,
                dataFetcher,
                signer,
                flashbotSigner: undefined,
                arb,
                orderbook,
                pair,
            });
            assert.fail("expected to reject, but resolved");
        } catch(error) {
            const expected = {
                reports: [],
                reason: ProcessPairHaltReason.FailedToGetVaultBalance,
                error: evmError,
                sharedSpanAttributes: {
                    "details.pair": pair,
                    "details.output": orderPairObject.sellToken,
                    "details.input": orderPairObject.buyToken,
                    "details.orders": [orderPairObject.takeOrders[0].id]
                }
            };
            assert.deepEqual(error, expected);
        }
    });

    it("should fail to get gas price", async function () {
        const evmError = { code: ethers.errors.CALL_EXCEPTION };
        signer.provider.getGasPrice = async () => {
            return Promise.reject(evmError);
        };
        try {
            await processPair({
                config,
                orderPairObject,
                viemClient,
                dataFetcher,
                signer,
                flashbotSigner: undefined,
                arb,
                orderbook,
                pair,
            });
            assert.fail("expected to reject, but resolved");
        } catch(error) {
            const expected = {
                reports: [],
                reason: ProcessPairHaltReason.FailedToGetGasPrice,
                error: evmError,
                sharedSpanAttributes: {
                    "details.pair": pair,
                    "details.output": orderPairObject.sellToken,
                    "details.input": orderPairObject.buyToken,
                    "details.orders": [orderPairObject.takeOrders[0].id]
                }
            };
            assert.deepEqual(error, expected);
        }
    });

    it("should fail to get eth price", async function () {
        config.gasCoveragePercentage = "100";
        dataFetcher.getCurrentPoolCodeMap = () => {
            return new Map();
        };
        try {
            await processPair({
                config,
                orderPairObject,
                viemClient,
                dataFetcher,
                signer,
                flashbotSigner: undefined,
                arb,
                orderbook,
                pair,
            });
            assert.fail("expected to reject, but resolved");
        } catch(error) {
            const expected = {
                reports: [],
                reason: ProcessPairHaltReason.FailedToGetEthPrice,
                error: undefined,
                sharedSpanAttributes: {
                    "details.pair": pair,
                    "details.output": orderPairObject.sellToken,
                    "details.input": orderPairObject.buyToken,
                    "details.orders": [orderPairObject.takeOrders[0].id],
                    "details.gasPrice": gasPrice.toString()
                }
            };
            assert.deepEqual(error, expected);
        }
    });

    it("should fail to get pools", async function () {
        const evmError = { code: ethers.errors.CALL_EXCEPTION };
        dataFetcher.fetchPoolsForToken = () => {
            return Promise.reject(evmError);
        };
        try {
            await processPair({
                config,
                orderPairObject,
                viemClient,
                dataFetcher,
                signer,
                flashbotSigner: undefined,
                arb,
                orderbook,
                pair,
            });
            assert.fail("expected to reject, but resolved");
        } catch(error) {
            const expected = {
                reports: [],
                reason: ProcessPairHaltReason.FailedToGetPools,
                error: evmError,
                sharedSpanAttributes: {
                    "details.pair": pair,
                    "details.output": orderPairObject.sellToken,
                    "details.input": orderPairObject.buyToken,
                    "details.orders": [orderPairObject.takeOrders[0].id],
                    "details.gasPrice": gasPrice.toString()
                }
            };
            assert.deepEqual(error, expected);
        }
    });
});