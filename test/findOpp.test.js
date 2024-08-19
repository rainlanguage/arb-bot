const { assert } = require("chai");
const testData = require("./data");
const { findOpp } = require("../src/modes");
const { orderbookAbi } = require("../src/abis");
const { getBountyEnsureBytecode } = require("../src/config");
const { ethers, utils: { formatUnits } } = require("ethers");

// mocking signer and dataFetcher
let signer = {};
let dataFetcher = {};
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
    fromToken,
    toToken,
    poolCodeMap,
    expectedRouteData,
    expectedRouteVisual,
    getCurrentPrice,
} = testData;

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
            data: expectedRouteData
        };
        const task = {
            evaluable: {
                interpreter: orderPairObject.takeOrders[0].takeOrder.order.evaluable.interpreter,
                store: orderPairObject.takeOrders[0].takeOrder.order.evaluable.store,
                bytecode: getBountyEnsureBytecode(
                    ethers.utils.parseUnits(inputToEthPrice),
                    ethers.constants.Zero,
                    gasLimitEstimation.mul("107").div("100").mul(gasPrice)
                )
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
                    gasLimit: gasLimitEstimation.mul("107").div("100"),
                },
                maximumInput: vaultBalance,
                price: getCurrentPrice(vaultBalance),
                routeVisual: expectedRouteVisual,
                oppBlockNumber,
            },
            reason: undefined,
            spanAttributes: {
                oppBlockNumber,
                foundOpp: true,
                maxInput: vaultBalance.toString(),
                marketPrice: ethers.utils.formatUnits(getCurrentPrice(vaultBalance)),
                route: expectedRouteVisual,
            }
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
                    gasLimitEstimation.mul("107").div("100").mul(gasPrice)
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
                    gasLimit: gasLimitEstimation.mul("107").div("100"),
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
                    "route-processor": JSON.stringify({
                        hops: [
                            `{"maxInput":"${vaultBalance.toString()}","marketPrice":"${formatUnits(getCurrentPrice(vaultBalance))}","route":${JSON.stringify(expectedRouteVisual)},"blockNumber":${oppBlockNumber},"error":"${ethers.errors.UNPREDICTABLE_GAS_LIMIT}"}`,
                            `{"maxInput":"${vaultBalance.div(2).toString()}","marketPrice":"${formatUnits(getCurrentPrice(vaultBalance.div(2)))}","route":${JSON.stringify(expectedRouteVisual)},"blockNumber":${oppBlockNumber}}`,
                            `{"maxInput":"${vaultBalance.div(4).toString()}","marketPrice":"${formatUnits(getCurrentPrice(vaultBalance.div(4)))}","route":${JSON.stringify(expectedRouteVisual)},"blockNumber":${oppBlockNumber}}`,
                        ]
                    }),
                    "inter-orderbook": JSON.stringify({
                        againstOrderbooks: JSON.stringify({
                            [opposingOrderbookAddress]: {
                                maxInput: vaultBalance.toString(),
                                blockNumber: oppBlockNumber,
                                error: err,
                            }
                        }),
                    })
                }
            };
            assert.deepEqual(error, expected);
        }
    });
});
