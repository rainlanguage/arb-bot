const { assert } = require("chai");
const testData = require("./data");
const { ethers } = require("ethers");
const { orderbookAbi } = require("../src/abis");
const { errorSnapshot } = require("../src/error");
const { estimateProfit } = require("../src/utils");
const { getBountyEnsureBytecode } = require("../src/config");
const { dryrun, findOpp } = require("../src/modes/interOrderbook");

// mocking signer and dataFetcher
let signer = {};
const viemClient = {
    getBlockNumber: async() => BigInt(oppBlockNumber)
};

const oppBlockNumber = 123456;
const {
    inputToEthPrice,
    outputToEthPrice,
    gasPrice,
    gasLimitEstimation,
    arb,
    vaultBalance,
    orderPairObject1: orderPairObject,
    config,
    opposingOrderPairObject,
    orderbooksOrders,
    opposingOrderbookAddress,
} = testData;

describe("Test inter-orderbook dryrun", async function () {
    beforeEach(() => {
        signer = {
            account: {address: `0x${"1".repeat(40)}`},
            getBlockNumber: async () => oppBlockNumber,
            estimateGas: async () => gasLimitEstimation,
            getBalance: async () => ethers.BigNumber.from(0)
        };
    });

    it("should succeed", async function () {
        const result = await dryrun({
            orderPairObject,
            opposingOrders: opposingOrderPairObject,
            signer,
            maximumInput: vaultBalance,
            gasPrice,
            arb,
            inputToEthPrice,
            outputToEthPrice,
            config,
            viemClient,
        });
        const opposingMaxInput = vaultBalance
            .mul(orderPairObject.takeOrders[0].quote.ratio)
            .div(`1${"0".repeat(36 - orderPairObject.buyTokenDecimals)}`);
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
        const task = {
            evaluable: {
                interpreter: orderPairObject.takeOrders[0].takeOrder.order.evaluable.interpreter,
                store: orderPairObject.takeOrders[0].takeOrder.order.evaluable.store,
                bytecode: getBountyEnsureBytecode(
                    ethers.utils.parseUnits(inputToEthPrice),
                    ethers.utils.parseUnits(outputToEthPrice),
                    gasLimitEstimation.mul(gasPrice)
                ),
            },
            signedContext: []
        };
        const expected = {
            value: {
                rawtx: {
                    data: arb.interface.encodeFunctionData(
                        "arb3",
                        [
                            orderPairObject.orderbook,
                            expectedTakeOrdersConfigStruct,
                            task,
                        ]
                    ),
                    to: arb.address,
                    gasPrice,
                    gas: gasLimitEstimation.toBigInt(),
                },
                maximumInput: vaultBalance,
                oppBlockNumber,
                estimatedProfit: estimateProfit(
                    orderPairObject,
                    ethers.utils.parseUnits(inputToEthPrice),
                    ethers.utils.parseUnits(outputToEthPrice),
                    opposingOrderPairObject,
                    undefined,
                    vaultBalance
                )
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

    it("should fail with no opp", async function () {
        signer.estimateGas = async () => {
            return Promise.reject(ethers.errors.UNPREDICTABLE_GAS_LIMIT);
        };
        try {
            await dryrun({
                orderPairObject,
                opposingOrders: opposingOrderPairObject,
                signer,
                maximumInput: vaultBalance,
                gasPrice,
                arb,
                inputToEthPrice,
                outputToEthPrice,
                config,
                viemClient,
                knownInitGas: { value: undefined },
            });
            assert.fail("expected to reject, but resolved");
        } catch (error) {
            const expected = {
                value: undefined,
                reason: undefined,
                spanAttributes: {
                    maxInput: vaultBalance.toString(),
                    blockNumber: oppBlockNumber,
                    error: errorSnapshot("", ethers.errors.UNPREDICTABLE_GAS_LIMIT),
                }
            };
            assert.deepEqual(error.value, expected.value);
            assert.deepEqual(error.reason, expected.reason);
            assert.deepEqual(error.spanAttributes.maxInput, expected.spanAttributes.maxInput);
            assert.deepEqual(error.spanAttributes.blockNumber, expected.spanAttributes.blockNumber);
            assert.deepEqual(error.spanAttributes.error, expected.spanAttributes.error);
        }
    });
});

describe("Test inter-orderbook find opp", async function () {
    beforeEach(() => {
        signer = {
            account: {address: `0x${"1".repeat(40)}`},
            getBlockNumber: async () => oppBlockNumber,
            estimateGas: async () => gasLimitEstimation,
            getBalance: async () => ethers.BigNumber.from(0)
        };
        dataFetcher = {
            fetchedPairPools: []
        };
    });

    it("should find opp", async function () {
        const result = await findOpp({
            orderPairObject,
            signer,
            gasPrice,
            arb,
            inputToEthPrice,
            outputToEthPrice,
            config,
            viemClient,
            orderbooksOrders,
        });
        const opposingMaxInput = vaultBalance
            .mul(orderPairObject.takeOrders[0].quote.ratio)
            .div(`1${"0".repeat(36 - orderPairObject.buyTokenDecimals)}`);
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
        const task = {
            evaluable: {
                interpreter: orderPairObject.takeOrders[0].takeOrder.order.evaluable.interpreter,
                store: orderPairObject.takeOrders[0].takeOrder.order.evaluable.store,
                bytecode: getBountyEnsureBytecode(
                    ethers.utils.parseUnits(inputToEthPrice),
                    ethers.utils.parseUnits(outputToEthPrice),
                    gasLimitEstimation.mul(gasPrice)
                ),
            },
            signedContext: []
        };
        const expected = {
            value: {
                rawtx: {
                    data: arb.interface.encodeFunctionData(
                        "arb3",
                        [
                            orderPairObject.orderbook,
                            expectedTakeOrdersConfigStruct,
                            task,
                        ]
                    ),
                    to: arb.address,
                    gasPrice,
                    gas: gasLimitEstimation.toBigInt(),
                },
                maximumInput: vaultBalance,
                oppBlockNumber,
                estimatedProfit: estimateProfit(
                    orderPairObject,
                    ethers.utils.parseUnits(inputToEthPrice),
                    ethers.utils.parseUnits(outputToEthPrice),
                    opposingOrderPairObject,
                    undefined,
                    vaultBalance
                )
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

    it("should find opp with binary search", async function () {
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
            orderPairObject,
            signer,
            gasPrice,
            arb,
            inputToEthPrice,
            outputToEthPrice,
            config,
            viemClient,
            orderbooksOrders,
        });
        const opposingMaxInput = vaultBalance
            .mul(3).div(4)
            .mul(orderPairObject.takeOrders[0].quote.ratio)
            .div(`1${"0".repeat(36 - orderPairObject.buyTokenDecimals)}`);
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
            maximumInput: vaultBalance.mul(3).div(4),
            maximumIORatio: ethers.constants.MaxUint256,
            orders: [orderPairObject.takeOrders[0].takeOrder],
            data: ethers.utils.defaultAbiCoder.encode(
                ["address", "address", "bytes"],
                [opposingOrderPairObject.orderbook, opposingOrderPairObject.orderbook, encodedFN]
            )
        };
        const task = {
            evaluable: {
                interpreter: orderPairObject.takeOrders[0].takeOrder.order.evaluable.interpreter,
                store: orderPairObject.takeOrders[0].takeOrder.order.evaluable.store,
                bytecode: getBountyEnsureBytecode(
                    ethers.utils.parseUnits(inputToEthPrice),
                    ethers.utils.parseUnits(outputToEthPrice),
                    gasLimitEstimation.mul(gasPrice)
                ),
            },
            signedContext: []
        };
        const expected = {
            value: {
                rawtx: {
                    data: arb.interface.encodeFunctionData(
                        "arb3",
                        [
                            orderPairObject.orderbook,
                            expectedTakeOrdersConfigStruct,
                            task,
                        ]
                    ),
                    to: arb.address,
                    gasPrice,
                    gas: gasLimitEstimation.toBigInt(),
                },
                maximumInput: vaultBalance.mul(3).div(4),
                oppBlockNumber,
                estimatedProfit: estimateProfit(
                    orderPairObject,
                    ethers.utils.parseUnits(inputToEthPrice),
                    ethers.utils.parseUnits(outputToEthPrice),
                    opposingOrderPairObject,
                    undefined,
                    vaultBalance.mul(3).div(4)
                )
            },
            reason: undefined,
            spanAttributes: {
                oppBlockNumber,
                foundOpp: true,
                maxInput: vaultBalance.mul(3).div(4).toString(),
            }
        };
        assert.deepEqual(result, expected);
    });

    it("should NOT find opp", async function () {
        const err = ethers.errors.UNPREDICTABLE_GAS_LIMIT;
        signer.estimateGas = async () => {
            return Promise.reject(err);
        };
        try {
            await findOpp({
                orderPairObject,
                signer,
                gasPrice,
                arb,
                inputToEthPrice,
                outputToEthPrice,
                config,
                viemClient,
                orderbooksOrders,
            });
            assert.fail("expected to reject, but resolved");
        } catch (error) {
            const opposingMaxInput = vaultBalance
                .mul(orderPairObject.takeOrders[0].quote.ratio)
                .div(`1${"0".repeat(36 - orderPairObject.buyTokenDecimals)}`);
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
                    [
                        opposingOrderPairObject.orderbook,
                        opposingOrderPairObject.orderbook,
                        encodedFN
                    ]
                )
            };
            const task = {
                evaluable: {
                    interpreter: orderPairObject.takeOrders[0]
                        .takeOrder.order.evaluable.interpreter,
                    store: orderPairObject.takeOrders[0].takeOrder.order.evaluable.store,
                    bytecode: "0x"
                },
                signedContext: []
            };
            const rawtx = {
                data: arb.interface.encodeFunctionData(
                    "arb3",
                    [
                        orderPairObject.orderbook,
                        expectedTakeOrdersConfigStruct,
                        task,
                    ]
                ),
                to: arb.address,
                gasPrice,
                from: signer.account.address
            };
            const expected = {
                value: undefined,
                reason: undefined,
                spanAttributes: {
                    againstOrderbooks: JSON.stringify({
                        [opposingOrderbookAddress]: {
                            maxInput: vaultBalance.toString(),
                            blockNumber: oppBlockNumber,
                            error: errorSnapshot("", err),
                            rawtx: JSON.stringify(rawtx)
                        }
                    }),
                }
            };
            assert.deepEqual(error, expected);
        }
    });
});
