const { assert } = require("chai");
const testData = require("./data");
const { ethers } = require("ethers");
const { clone, estimateProfit } = require("../src/utils");
const { getWithdrawEnsureBytecode } = require("../src/config");
const { dryrun, findOpp, IntraOrderbookDryrunHaltReason } = require("../src/modes/intraOrderbook");

// mocking signer and dataFetcher
let signer = {};
const viemClient = {
    getBlockNumber: async() => BigInt(oppBlockNumber),
    call: async() => ({ data: ethers.BigNumber.from("1000000000000000000").toHexString() })
};

const oppBlockNumber = 123456;
const {
    inputToEthPrice,
    outputToEthPrice,
    gasPrice,
    gasLimitEstimation,
    orderPairObject1: orderPairObject,
    config,
    orderbooksOrders: orderbooksOrdersTemp,
    orderbook,
} = testData;
const orderbooksOrders = clone(orderbooksOrdersTemp);
orderbooksOrders[0][0].orderbook = orderPairObject.orderbook;

describe("Test intra-orderbook dryrun", async function () {
    beforeEach(() => {
        signer = {
            address: `0x${"1".repeat(40)}`,
            provider: {
                getBlockNumber: async () => oppBlockNumber
            },
            estimateGas: async () => gasLimitEstimation,
            getBalance: async () => ethers.BigNumber.from(0)
        };
    });
    const inputBalance = ethers.BigNumber.from("1000000000000000000");
    const outputBalance = ethers.BigNumber.from("1000000");

    it("should succeed", async function () {
        const result = await dryrun({
            orderPairObject,
            opposingOrder: orderbooksOrders[0][0].takeOrders[0],
            signer,
            gasPrice,
            inputToEthPrice,
            outputToEthPrice,
            config,
            viemClient,
            inputBalance,
            outputBalance,
        });
        const task = {
            evaluable: {
                interpreter: orderPairObject.takeOrders[0].takeOrder.order.evaluable.interpreter,
                store: orderPairObject.takeOrders[0].takeOrder.order.evaluable.store,
                bytecode: getWithdrawEnsureBytecode(
                    signer.address,
                    orderPairObject.buyToken,
                    orderPairObject.sellToken,
                    inputBalance,
                    outputBalance,
                    ethers.utils.parseUnits(inputToEthPrice),
                    ethers.utils.parseUnits(outputToEthPrice),
                    gasLimitEstimation.mul("107").div("100").mul(gasPrice)
                ),
            },
            signedContext: []
        };
        const withdrawInputCalldata = orderbook.interface.encodeFunctionData(
            "withdraw2",
            [
                orderPairObject.buyToken,
                "1",
                ethers.constants.MaxUint256,
                []
            ]
        );
        const withdrawOutputCalldata = orderbook.interface.encodeFunctionData(
            "withdraw2",
            [
                orderPairObject.sellToken,
                "1",
                ethers.constants.MaxUint256,
                [task]
            ]
        );
        const clear2Calldata = orderbook.interface.encodeFunctionData(
            "clear2",
            [
                orderPairObject.takeOrders[0].takeOrder.order,
                orderbooksOrders[0][0].takeOrders[0].takeOrder.order,
                {
                    aliceInputIOIndex: orderPairObject.takeOrders[0].takeOrder.inputIOIndex,
                    aliceOutputIOIndex: orderPairObject.takeOrders[0].takeOrder.outputIOIndex,
                    bobInputIOIndex: orderbooksOrders[0][0].takeOrders[0].takeOrder.inputIOIndex,
                    bobOutputIOIndex: orderbooksOrders[0][0].takeOrders[0].takeOrder.outputIOIndex,
                    aliceBountyVaultId: "1",
                    bobBountyVaultId: "1",
                },
                [],
                []
            ]
        );
        const expected = {
            value: {
                rawtx: {
                    data: orderbook.interface.encodeFunctionData(
                        "multicall",
                        [[clear2Calldata, withdrawInputCalldata, withdrawOutputCalldata]]
                    ),
                    to: orderPairObject.orderbook,
                    gasPrice,
                    gasLimit: gasLimitEstimation.mul("107").div("100"),
                },
                oppBlockNumber,
                estimatedProfit: estimateProfit(
                    orderPairObject,
                    ethers.utils.parseUnits(inputToEthPrice),
                    ethers.utils.parseUnits(outputToEthPrice),
                    orderbooksOrders[0][0].takeOrders[0],
                )
            },
            reason: undefined,
            spanAttributes: {
                oppBlockNumber,
                foundOpp: true
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
                opposingOrder: orderbooksOrders[0][0].takeOrders[0],
                signer,
                gasPrice,
                inputToEthPrice,
                outputToEthPrice,
                config,
                viemClient,
                inputBalance,
                outputBalance,
            });
            assert.fail("expected to reject, but resolved");
        } catch (error) {
            const expected = {
                value: undefined,
                reason: IntraOrderbookDryrunHaltReason.NoWalletFund,
                spanAttributes: {
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
                opposingOrder: orderbooksOrders[0][0].takeOrders[0],
                signer,
                gasPrice,
                inputToEthPrice,
                outputToEthPrice,
                config,
                viemClient,
                inputBalance,
                outputBalance,
            });
            assert.fail("expected to reject, but resolved");
        } catch (error) {
            const expected = {
                value: undefined,
                reason: IntraOrderbookDryrunHaltReason.NoOpportunity,
                spanAttributes: {
                    blockNumber: oppBlockNumber,
                    error: ethers.errors.UNPREDICTABLE_GAS_LIMIT,
                }
            };
            assert.deepEqual(error, expected);
        }
    });
});

describe("Test intra-orderbook find opp", async function () {
    beforeEach(() => {
        signer = {
            address: `0x${"1".repeat(40)}`,
            provider: {
                getBlockNumber: async () => oppBlockNumber
            },
            estimateGas: async () => gasLimitEstimation,
            getBalance: async () => ethers.BigNumber.from(0)
        };
        dataFetcher = {};
    });
    const balance = ethers.BigNumber.from("1000000000000000000");

    it("should find opp", async function () {
        const result = await findOpp({
            orderPairObject,
            signer,
            gasPrice,
            inputToEthPrice,
            outputToEthPrice,
            config,
            viemClient,
            orderbooksOrders,
        });
        const task = {
            evaluable: {
                interpreter: orderPairObject.takeOrders[0].takeOrder.order.evaluable.interpreter,
                store: orderPairObject.takeOrders[0].takeOrder.order.evaluable.store,
                bytecode: getWithdrawEnsureBytecode(
                    signer.address,
                    orderPairObject.buyToken,
                    orderPairObject.sellToken,
                    balance,
                    balance,
                    ethers.utils.parseUnits(inputToEthPrice),
                    ethers.utils.parseUnits(outputToEthPrice),
                    gasLimitEstimation.mul("107").div("100").mul(gasPrice)
                ),
            },
            signedContext: []
        };
        const withdrawInputCalldata = orderbook.interface.encodeFunctionData(
            "withdraw2",
            [
                orderPairObject.buyToken,
                "1",
                ethers.constants.MaxUint256,
                []
            ]
        );
        const withdrawOutputCalldata = orderbook.interface.encodeFunctionData(
            "withdraw2",
            [
                orderPairObject.sellToken,
                "1",
                ethers.constants.MaxUint256,
                [task]
            ]
        );
        const clear2Calldata = orderbook.interface.encodeFunctionData(
            "clear2",
            [
                orderPairObject.takeOrders[0].takeOrder.order,
                orderbooksOrders[0][0].takeOrders[0].takeOrder.order,
                {
                    aliceInputIOIndex: orderPairObject.takeOrders[0].takeOrder.inputIOIndex,
                    aliceOutputIOIndex: orderPairObject.takeOrders[0].takeOrder.outputIOIndex,
                    bobInputIOIndex: orderbooksOrders[0][0].takeOrders[0].takeOrder.inputIOIndex,
                    bobOutputIOIndex: orderbooksOrders[0][0].takeOrders[0].takeOrder.outputIOIndex,
                    aliceBountyVaultId: "1",
                    bobBountyVaultId: "1",
                },
                [],
                []
            ]
        );
        const expected = {
            value: {
                rawtx: {
                    data: orderbook.interface.encodeFunctionData(
                        "multicall",
                        [[clear2Calldata, withdrawInputCalldata, withdrawOutputCalldata]]
                    ),
                    to: orderPairObject.orderbook,
                    gasPrice,
                    gasLimit: gasLimitEstimation.mul("107").div("100"),
                },
                oppBlockNumber,
                estimatedProfit: estimateProfit(
                    orderPairObject,
                    ethers.utils.parseUnits(inputToEthPrice),
                    ethers.utils.parseUnits(outputToEthPrice),
                    orderbooksOrders[0][0].takeOrders[0],
                )
            },
            reason: undefined,
            spanAttributes: {
                oppBlockNumber,
                foundOpp: true,
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
                inputToEthPrice,
                outputToEthPrice,
                config,
                viemClient,
                orderbooksOrders,
            });
            assert.fail("expected to reject, but resolved");
        } catch (error) {
            const expected = {
                value: undefined,
                reason: IntraOrderbookDryrunHaltReason.NoOpportunity,
                spanAttributes: {
                    intraOrderbook: [JSON.stringify({
                        blockNumber: oppBlockNumber,
                        error: err,
                    })],
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
                inputToEthPrice,
                outputToEthPrice,
                config,
                viemClient,
                orderbooksOrders,
            });
            assert.fail("expected to reject, but resolved");
        } catch (error) {
            const expected = {
                value: undefined,
                reason: IntraOrderbookDryrunHaltReason.NoWalletFund,
                spanAttributes: { currentWalletBalance: "0" },
            };
            assert.deepEqual(error, expected);
        }
    });
});
