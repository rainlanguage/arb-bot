const { assert } = require("chai");
const testData = require("./data");
const { DefaultArbEvaluable, orderbookAbi } = require("../src/abis");
const { ethers, utils: { formatUnits } } = require("ethers");
const { dryrun, findOpp, InterOrderbookDryrunHaltReason } = require("../src/modes/interOrderbook");
const { getBountyEnsureBytecode } = require("../src/config");

// mocking signer and dataFetcher
let signer = {};
const viemClient = {
    getBlockNumber: async() => BigInt(oppBlockNumber)
};

const oppBlockNumber = 123456;
const {
    ethPrice: ethPriceToInput,
    ethPriceToOutput,
    gasPrice,
    gasLimitEstimation,
    arb,
    vaultBalance,
    orderPairObject1: orderPairObject,
    fromToken,
    toToken,
    config,
    expectedRouteData,
    expectedRouteVisual,
    opposingVaultBalance,
    opposingOrderPairObject,
    orderbooksOrders,
    opposingOrderbookAddress,
    getCurrentPrice,
} = testData;

describe("Test inter-orderbook dryrun", async function () {
    beforeEach(() => {
        signer = {
            provider: {
                getBlockNumber: async () => oppBlockNumber
            },
            estimateGas: async () => gasLimitEstimation,
            getBalance: async () => ethers.BigNumber.from(0)
        };
    });

    it.only("should succeed", async function () {
        const result = await dryrun({
            orderPairObject,
            opposingOrders: opposingOrderPairObject,
            signer,
            maximumInput: vaultBalance,
            gasPrice,
            arb,
            ethPriceToInput,
            ethPriceToOutput,
            config,
            viemClient,
        });
        const opposingMaxInput = vaultBalance
            .mul(orderPairObject.takeOrders[0].quote.ratio)
            .div(`1${"0".repeat(18)}`)
            .div(`1${"0".repeat(18 - orderPairObject.buyTokenDecimals)}`);
        const opposingMaxIORatio = ethers.BigNumber.from(`1${"0".repeat(36)}`)
            .div(orderPairObject.takeOrders[0].quote.ratio);
        const obInterface = new ethers.utils.Interface(orderbookAbi);
        const encodedFN = obInterface.encodeFunctionData(
            "takeOrders2",
            [{
                minimumInput: ethers.constants.One,
                maximumInput: opposingMaxInput,
                maximumIORatio: opposingMaxIORatio,
                orders: opposingOrderPairObject.takeOrders.map(v => v.takeOrder),
                data: "0x"
            }]
        );
        const expectedTakeOrdersConfigStruct = {
            minimumInput: ethers.constants.One,
            maximumInput: vaultBalance,
            maximumIORatio: ethers.constants.MaxUint256,
            orders: [orderPairObject.takeOrders[0].takeOrder],
            data: ethers.utils.defaultAbiCoder.encode(
                ["address", "address", "bytes"],
                [opposingOrderPairObject.orderbook, opposingOrderPairObject.orderbook, encodedFN]
            )
        };
        const task = [{
            evaluable: {
                interpreter: orderPairObject.takeOrders[0].takeOrder.order.evaluable.interpreter,
                store: orderPairObject.takeOrders[0].takeOrder.order.evaluable.store,
                bytecode: getBountyEnsureBytecode(
                    ethers.utils.parseUnits(ethPriceToInput),
                    ethers.utils.parseUnits(ethPriceToOutput),
                    gasLimitEstimation.mul("103").div("100").mul(gasPrice)
                ),
            },
            signedContext: []
        }];
        const expected = {
            value: {
                rawtx: {
                    data: arb.interface.encodeFunctionData(
                        "arb2",
                        [
                            expectedTakeOrdersConfigStruct,
                            DefaultArbEvaluable,
                            task
                        ]
                    ),
                    to: arb.address,
                    gasPrice,
                    gasLimit: gasLimitEstimation.mul("103").div("100"),
                },
                maximumInput: vaultBalance,
                oppBlockNumber,
            },
            reason: undefined,
            spanAttributes: {
                oppBlockNumber,
                foundOpp: true,
                maxInput: vaultBalance.toString(),
            }
        };
        assert.deepEqual(result, expected);
    });

    it("should fail with no wallet fund", async function () {
        const noFundError = { code: ethers.errors.INSUFFICIENT_FUNDS };
        signer.estimateGas = async () => {
            return Promise.reject(noFundError);
        };
        signer.BALANCE = ethers.constants.Zero;
        try {
            await dryrun({
                orderPairObject,
                opposingOrders: opposingOrderPairObject,
                signer,
                maximumInput: maximumInputFixed,
                gasPrice,
                arb,
                ethPriceToInput,
                ethPriceToOutput,
                config,
                viemClient,
                knownInitGas: { value: undefined },
            });
            assert.fail("expected to reject, but resolved");
        } catch (error) {
            const expected = {
                value: undefined,
                reason: InterOrderbookDryrunHaltReason.NoWalletFund,
                spanAttributes: {
                    maxInput: vaultBalance.toString(),
                    blockNumber: oppBlockNumber,
                    error: noFundError,
                    currentWalletBalance: "0",
                }
            };
            assert.deepEqual(error, expected);
        }
    });

    it("should fail with no opp", async function () {
        signer.estimateGas = async () => {
            return Promise.reject(ethers.errors.UNPREDICTABLE_GAS_LIMIT);
        };
        try {
            await dryrun({
                orderPairObject,
                opposingOrders: opposingOrderPairObject,
                signer,
                maximumInput: maximumInputFixed,
                gasPrice,
                arb,
                ethPriceToInput,
                ethPriceToOutput,
                config,
                viemClient,
                knownInitGas: { value: undefined },
            });
            assert.fail("expected to reject, but resolved");
        } catch (error) {
            const expected = {
                value: undefined,
                reason: InterOrderbookDryrunHaltReason.NoOpportunity,
                spanAttributes: {
                    maxInput: vaultBalance.toString(),
                    blockNumber: oppBlockNumber,
                    error: ethers.errors.UNPREDICTABLE_GAS_LIMIT,
                }
            };
            assert.deepEqual(error, expected);
        }
    });
});

describe("Test inter-orderbook find opp", async function () {
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

    it("should find opp", async function () {
        const result = await findOpp({
            orderPairObject,
            signer,
            gasPrice,
            arb,
            ethPriceToInput,
            ethPriceToOutput,
            config,
            viemClient,
            orderbooksOrders,
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
                oppBlockNumber
            },
            reason: undefined,
            spanAttributes: {
                oppBlockNumber,
                foundOpp: true,
                maxInput: vaultBalance.toString(),
            }
        };
        assert.deepEqual(result, expected);
    });

    it("should NOT find opp", async function () {
        signer.estimateGas = async () => {
            return Promise.reject(ethers.errors.UNPREDICTABLE_GAS_LIMIT);
        };
        try {
            await findOpp({
                orderPairObject,
                signer,
                gasPrice,
                arb,
                ethPriceToInput,
                ethPriceToOutput,
                config,
                viemClient,
                orderbooksOrders,
            });
            assert.fail("expected to reject, but resolved");
        } catch (error) {
            const expected = {
                value: undefined,
                reason: InterOrderbookDryrunHaltReason.NoOpportunity,
                spanAttributes: {
                    againstOrderbooks: {
                        [opposingOrderbookAddress]: "",
                    }
                }
            };
            assert.deepEqual(error, expected);
        }
    });

    it("should have no wallet fund", async function () {
        signer.estimateGas = async () => {
            return Promise.reject({ code: ethers.errors.INSUFFICIENT_FUNDS });
        };
        signer.BALANCE = ethers.constants.Zero;
        try {
            await findOpp({
                orderPairObject,
                signer,
                gasPrice,
                arb,
                ethPriceToInput,
                ethPriceToOutput,
                config,
                viemClient,
                orderbooksOrders,
            });
            assert.fail("expected to reject, but resolved");
        } catch (error) {
            const expected = {
                value: undefined,
                reason: InterOrderbookDryrunHaltReason.NoWalletFund,
                spanAttributes: { currentWalletBalance: "0" },
            };
            assert.deepEqual(error, expected);
        }
    });
});
