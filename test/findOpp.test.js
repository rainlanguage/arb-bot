const { assert } = require("chai");
const testData = require("./data");
const { findOpp } = require("../src/modes");
const { orderbookAbi } = require("../src/abis");
const { clone, estimateProfit } = require("../src/utils");
const {
    ethers,
    utils: { formatUnits },
} = require("ethers");
const {
    parseRainlang,
    getBountyEnsureRainlang,
    getWithdrawEnsureRainlang,
} = require("../src/task");

// mocking signer and dataFetcher
let signer = {};
let dataFetcher = {};
const viemClient = {
    getBlockNumber: async () => BigInt(oppBlockNumber),
    call: async () => ({ data: ethers.BigNumber.from("1000000000000000000").toHexString() }),
    readContract: async (arg) => {
        if (arg.functionName === "parse2") return "0x1234";
        else return 1000000000000000000n;
    },
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
    fromToken,
    toToken,
    poolCodeMap,
    expectedRouteData,
    expectedRouteVisual,
    getCurrentPrice,
    orderbook,
    getAmountOut,
} = testData;
config.viemClient = viemClient;

describe("Test find opp", async function () {
    beforeEach(() => {
        signer = {
            account: { address: `0x${"1".repeat(40)}` },
            getBlockNumber: async () => oppBlockNumber,
            estimateGas: async () => gasLimitEstimation.toBigInt(),
            getBalance: async () => 0n,
        };
        dataFetcher = {
            fetchedPairPools: [],
        };
    });

    it("should find opp from RP", async function () {
        dataFetcher.getCurrentPoolCodeMap = () => {
            return poolCodeMap;
        };
        const result = await findOpp({
            orderPairObject,
            dataFetcher,
            arb,
            genericArb: undefined,
            fromToken,
            toToken,
            signer,
            gasPrice,
            config,
            viemClient,
            inputToEthPrice,
            outputToEthPrice,
            orderbooksOrders,
        });
        const expectedTakeOrdersConfigStruct = {
            minimumInput: ethers.constants.One,
            maximumInput: vaultBalance,
            maximumIORatio: ethers.constants.MaxUint256,
            orders: [orderPairObject.takeOrders[0].takeOrder],
            data: expectedRouteData,
        };
        const task = {
            evaluable: {
                interpreter: config.dispair.interpreter,
                store: config.dispair.store,
                bytecode: await parseRainlang(
                    await getBountyEnsureRainlang(
                        ethers.utils.parseUnits(inputToEthPrice),
                        ethers.constants.Zero,
                        gasLimitEstimation.mul(gasPrice),
                        signer.account.address,
                    ),
                    viemClient,
                    config.dispair,
                ),
            },
            signedContext: [],
        };
        const expected = {
            value: {
                rawtx: {
                    data: arb.interface.encodeFunctionData("arb3", [
                        orderPairObject.orderbook,
                        expectedTakeOrdersConfigStruct,
                        task,
                    ]),
                    to: arb.address,
                    gasPrice,
                    gas: gasLimitEstimation.toBigInt(),
                },
                maximumInput: vaultBalance,
                price: getCurrentPrice(vaultBalance),
                routeVisual: expectedRouteVisual,
                oppBlockNumber,
                estimatedProfit: estimateProfit(
                    orderPairObject,
                    ethers.utils.parseUnits(inputToEthPrice),
                    ethers.utils.parseUnits(outputToEthPrice),
                    undefined,
                    getCurrentPrice(vaultBalance),
                    vaultBalance,
                ),
            },
            reason: undefined,
            spanAttributes: {
                oppBlockNumber,
                foundOpp: true,
                amountIn: formatUnits(vaultBalance),
                amountOut: formatUnits(getAmountOut(vaultBalance), 6),
                marketPrice: formatUnits(getCurrentPrice(vaultBalance)),
                route: expectedRouteVisual,
                clearModePick: "rp4",
            },
        };
        assert.deepEqual(result, expected);
    });

    it("should find opp from inter-orderbook", async function () {
        dataFetcher.getCurrentPoolCodeMap = () => {
            return poolCodeMap;
        };
        const result = await findOpp({
            orderPairObject,
            dataFetcher,
            arb,
            genericArb: arb,
            fromToken,
            toToken,
            signer,
            gasPrice,
            config,
            viemClient,
            inputToEthPrice,
            outputToEthPrice,
            orderbooksOrders,
        });
        const opposingMaxInput = vaultBalance
            .mul(orderPairObject.takeOrders[0].quote.ratio)
            .div(`1${"0".repeat(36 - orderPairObject.buyTokenDecimals)}`);
        const opposingMaxIORatio = ethers.BigNumber.from(`1${"0".repeat(36)}`).div(
            orderPairObject.takeOrders[0].quote.ratio,
        );
        const obInterface = new ethers.utils.Interface(orderbookAbi);
        const encodedFN = obInterface.encodeFunctionData("takeOrders2", [
            {
                minimumInput: ethers.constants.One,
                maximumInput: opposingMaxInput,
                maximumIORatio: opposingMaxIORatio,
                orders: opposingOrderPairObject.takeOrders.map((v) => v.takeOrder),
                data: "0x",
            },
        ]);
        const expectedTakeOrdersConfigStruct = {
            minimumInput: ethers.constants.One,
            maximumInput: vaultBalance,
            maximumIORatio: ethers.constants.MaxUint256,
            orders: [orderPairObject.takeOrders[0].takeOrder],
            data: ethers.utils.defaultAbiCoder.encode(
                ["address", "address", "bytes"],
                [opposingOrderPairObject.orderbook, opposingOrderPairObject.orderbook, encodedFN],
            ),
        };
        const task = {
            evaluable: {
                interpreter: config.dispair.interpreter,
                store: config.dispair.store,
                bytecode: await parseRainlang(
                    await getBountyEnsureRainlang(
                        ethers.utils.parseUnits(inputToEthPrice),
                        ethers.utils.parseUnits(outputToEthPrice),
                        gasLimitEstimation.mul(gasPrice),
                        signer.account.address,
                    ),
                    viemClient,
                    config.dispair,
                ),
            },
            signedContext: [],
        };
        const expected = {
            value: {
                rawtx: {
                    data: arb.interface.encodeFunctionData("arb3", [
                        orderPairObject.orderbook,
                        expectedTakeOrdersConfigStruct,
                        task,
                    ]),
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
                    vaultBalance,
                ),
            },
            reason: undefined,
            spanAttributes: {
                oppBlockNumber,
                foundOpp: true,
                maxInput: vaultBalance.toString(),
                clearModePick: "inter",
            },
        };
        assert.deepEqual(result, expected);
    });

    it("should find opp from intra-orderbook", async function () {
        dataFetcher.getCurrentPoolCodeMap = () => {
            return new Map();
        };
        const orderbooksOrdersTemp = clone(orderbooksOrders);
        orderbooksOrdersTemp[0][0].orderbook = orderPairObject.orderbook;
        const inputBalance = ethers.BigNumber.from("1000000000000000000000000000000");
        const outputBalance = ethers.BigNumber.from("1000000000000000000");
        const result = await findOpp({
            orderPairObject,
            dataFetcher,
            arb,
            genericArb: arb,
            fromToken,
            toToken,
            signer,
            gasPrice,
            config,
            viemClient,
            inputToEthPrice,
            outputToEthPrice,
            orderbooksOrders: orderbooksOrdersTemp,
        });
        const task = {
            evaluable: {
                interpreter: config.dispair.interpreter,
                store: config.dispair.store,
                bytecode: await parseRainlang(
                    await getWithdrawEnsureRainlang(
                        signer.account.address,
                        orderPairObject.buyToken,
                        orderPairObject.sellToken,
                        inputBalance,
                        outputBalance,
                        ethers.utils.parseUnits(inputToEthPrice),
                        ethers.utils.parseUnits(outputToEthPrice),
                        gasLimitEstimation.mul(gasPrice),
                        signer.account.address,
                    ),
                    viemClient,
                    config.dispair,
                ),
            },
            signedContext: [],
        };
        const withdrawInputCalldata = orderbook.interface.encodeFunctionData("withdraw2", [
            orderPairObject.buyToken,
            "1",
            ethers.constants.MaxUint256,
            [],
        ]);
        const withdrawOutputCalldata = orderbook.interface.encodeFunctionData("withdraw2", [
            orderPairObject.sellToken,
            "1",
            ethers.constants.MaxUint256,
            [task],
        ]);
        const clear2Calldata = orderbook.interface.encodeFunctionData("clear2", [
            orderPairObject.takeOrders[0].takeOrder.order,
            orderbooksOrdersTemp[0][0].takeOrders[0].takeOrder.order,
            {
                aliceInputIOIndex: orderPairObject.takeOrders[0].takeOrder.inputIOIndex,
                aliceOutputIOIndex: orderPairObject.takeOrders[0].takeOrder.outputIOIndex,
                bobInputIOIndex: orderbooksOrders[0][0].takeOrders[0].takeOrder.inputIOIndex,
                bobOutputIOIndex: orderbooksOrders[0][0].takeOrders[0].takeOrder.outputIOIndex,
                aliceBountyVaultId: "1",
                bobBountyVaultId: "1",
            },
            [],
            [],
        ]);
        const expected = {
            value: {
                rawtx: {
                    data: orderbook.interface.encodeFunctionData("multicall", [
                        [clear2Calldata, withdrawInputCalldata, withdrawOutputCalldata],
                    ]),
                    to: orderPairObject.orderbook,
                    gasPrice,
                    gas: gasLimitEstimation.toBigInt(),
                },
                oppBlockNumber,
                estimatedProfit: estimateProfit(
                    orderPairObject,
                    ethers.utils.parseUnits(inputToEthPrice),
                    ethers.utils.parseUnits(outputToEthPrice),
                    orderbooksOrdersTemp[0][0].takeOrders[0],
                    undefined,
                    vaultBalance,
                ),
            },
            reason: undefined,
            spanAttributes: {
                oppBlockNumber,
                foundOpp: true,
                clearModePick: "intra",
            },
        };
        assert.deepEqual(result, expected);
    });

    it("should NOT find opp", async function () {
        const err = ethers.errors.UNPREDICTABLE_GAS_LIMIT;
        signer.estimateGas = async () => {
            return Promise.reject(err);
        };
        dataFetcher.getCurrentPoolCodeMap = () => {
            return poolCodeMap;
        };
        try {
            await findOpp({
                orderPairObject,
                dataFetcher,
                arb,
                genericArb: arb,
                fromToken,
                toToken,
                signer,
                gasPrice,
                config,
                viemClient,
                inputToEthPrice,
                outputToEthPrice,
                orderbooksOrders,
            });
            assert.fail("expected to reject, but resolved");
        } catch (error) {
            const expected = {
                rawtx: undefined,
                oppBlockNumber: undefined,
                spanAttributes: {
                    "route-processor": {
                        hops: [
                            `{"amountIn":"${formatUnits(vaultBalance)}","marketPrice":"${formatUnits(getCurrentPrice(vaultBalance))}","route":${JSON.stringify(expectedRouteVisual)},"blockNumber":${oppBlockNumber},"error":"${ethers.errors.UNPREDICTABLE_GAS_LIMIT}"}`,
                            `{"amountIn":"${formatUnits(vaultBalance.div(2))}","marketPrice":"${formatUnits(getCurrentPrice(vaultBalance.div(2)))}","route":${JSON.stringify(expectedRouteVisual)},"blockNumber":${oppBlockNumber}}`,
                            `{"amountIn":"${formatUnits(vaultBalance.div(4))}","marketPrice":"${formatUnits(getCurrentPrice(vaultBalance.div(4)))}","route":${JSON.stringify(expectedRouteVisual)},"blockNumber":${oppBlockNumber}}`,
                        ],
                    },
                    "inter-orderbook": {
                        againstOrderbooks: {
                            [opposingOrderbookAddress]: {
                                amountIn: formatUnits(vaultBalance),
                                amountOut: formatUnits(getAmountOut(vaultBalance), 6),
                                blockNumber: oppBlockNumber,
                                error: err,
                            },
                        },
                    },
                },
            };
            assert.deepEqual(error.rawtx, expected.rawtx);
            assert.deepEqual(error.oppBlockNumber, expected.oppBlockNumber);
        }
    });
});
