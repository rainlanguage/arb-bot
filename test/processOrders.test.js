const { assert } = require("chai");
const { ethers } = require("ethers");
const fixtures = require("./fixtures");
const { SpanStatusCode } = require("@opentelemetry/api");
const { processOrders } = require("../src/processes/processOrders");
const { AttemptOppAndClearHaltReason } = require("../src/processes/processOpp");

describe("Test process orders", async function () {
    let dataFetcher = {};
    let signer = {};
    let viemClient = {};

    const {
        arb,
        pair,
        usdt,
        wmatic,
        gasPrice,
        gasLimitEstimation,
        vaultBalance,
        config: fixtureConfig,
        poolCodeMap,
        txHash,
        effectiveGasPrice,
        gasUsed,
        expectedRouteVisual,
        expectedRouteData,
    } = fixtures;
    const ordersDetails = [{
        orderJSONString: `{"owner":"0x0f47a0c7f86a615606ca315ad83c3e302b474bd6","handleIo":false,"evaluable":{"interpreter":"0x1efd85e6c384fad9b80c6d508e9098eb91c4ed30","store":"0x4ffc97bfb6dfce289f9b2a4083f5f5e940c8b88d","expression":"0x224f9ca76a6f1b3414280bed0f68227c1b61f2b2"},"validInputs":[{"token":"${usdt.address}","decimals":${usdt.decimals},"vaultId":"0xdce98e3a7ee4b8b7ec1def4542b220083f8c3f0d569f142752cdc5bad6e14092"}],"validOutputs":[{"token":"${wmatic.address}","decimals":${wmatic.decimals},"vaultId":"0xdce98e3a7ee4b8b7ec1def4542b220083f8c3f0d569f142752cdc5bad6e14092"}]}`,
        id: "0x004349d76523bce3b6aeec93cf4c2a396b9cb71bc07f214e271cab363a0c89eb",
        validInputs: [{
            token: {
                id: usdt.address,
                decimals: usdt.decimals,
                symbol: usdt.symbol,
            }
        }],
        validOutputs: [{
            token: {
                id: wmatic.address,
                decimals: wmatic.decimals,
                symbol: wmatic.symbol,
            }
        }]
    }];
    const config = JSON.parse(JSON.stringify(fixtureConfig));

    // mock otel tracer and capture otel result
    let otelResult = {
        attributes: {},
        status: undefined,
        exception: undefined,
    };
    const tracer = {
        startSpan: () => {
            return {
                setAttribute: (key, value) => {
                    otelResult.attributes[key] = value;
                },
                setAttributes: (attrs) => {
                    for (attrKey in attrs) {
                        otelResult.attributes[attrKey] = attrs[attrKey];
                    }
                },
                setStatus: (status) => otelResult.status = status,
                recordException: (error) => otelResult.exception = error,
                end: () => {},
            };
        }
    };

    beforeEach(() => {
        config.gasCoveragePercentage = "0";
        otelResult = {
            attributes: {},
            status: undefined,
            exception: undefined,
        };
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
        config.dataFetcher = dataFetcher;
        config.viemClient = viemClient;
        config.signer = signer;
    });

    it("should process orders successfully with clears", async function () {
        dataFetcher.getCurrentPoolCodeMap = () => {
            return poolCodeMap;
        };
        const result = await processOrders(
            config,
            ordersDetails,
            tracer,
            undefined,
        );
        const expectedSpanAttributes = {
            "details.blockDiff": 0,
            "details.clearBlockNumber": 123456,
            "details.estimatedGasCostInToken": "0.0",
            "details.gasCost": ethers.utils.formatUnits(effectiveGasPrice.mul(gasUsed)),
            "details.gasCostInToken": "0.0",
            "details.marketPrice": "0.9969006",
            "details.maxInput": vaultBalance.toString(),
            "details.oppBlockNumber": 123456,
            "details.order": ordersDetails[0].id,
            "details.route": expectedRouteVisual,
            "details.tx": `{"hash":"${txHash}"}`,
            "details.txUrl": "https://polygonscan.com/tx/" + txHash,
        };
        const expectedResult = {
            reports: [
                {
                    txUrl: "https://polygonscan.com/tx/" + txHash,
                    tokenPair: pair,
                    buyToken: usdt.address,
                    sellToken: wmatic.address,
                    clearedAmount: undefined,
                    actualGasCost: ethers.utils.formatUnits(effectiveGasPrice.mul(gasUsed)),
                    actualGasCostInToken: "0.0",
                    income: undefined,
                    netProfit: undefined,
                    clearedOrders: [ordersDetails[0].id],
                    order: ordersDetails[0].id,
                    spanAttributes: expectedSpanAttributes,
                }
            ],
            foundOppsCount: 1,
            clearsCount: 1,
            txUrls: [ "https://polygonscan.com/tx/" + txHash ]
        };
        const expectedOtelResult = {
            attributes: {
                ...expectedSpanAttributes,
                "details.gasPrice": gasPrice.toString(),
                "details.input": usdt.address,
                "details.output": wmatic.address,
                "details.pair": pair,
                foundOpp: true,
                didClear: true,
            },
            status: { code: SpanStatusCode.OK, message: "successfully cleared" },
            exception: undefined,
        };
        assert.deepEqual(result, expectedResult);
        assert.deepEqual(expectedOtelResult, otelResult);
    });

    it("should process orders with no opp", async function () {
        dataFetcher.getCurrentPoolCodeMap = () => {
            return poolCodeMap;
        };
        signer.estimateGas = async () => {
            return Promise.reject(ethers.errors.UNPREDICTABLE_GAS_LIMIT);
        };
        const result = await processOrders(
            config,
            ordersDetails,
            tracer,
            undefined,
        );
        const expectedSpanAttributes = {
            "details.order": ordersDetails[0].id,
            "details.hops": [
                `{"maxInput":"10000000000000000000","marketPrice":"0.9969006","blockNumber":123456,"route":${JSON.stringify(expectedRouteVisual)},"error":"${ethers.errors.UNPREDICTABLE_GAS_LIMIT}"}`,
                "{\"maxInput\":\"5000000000000000000\",\"marketPrice\":\"0.9969502\",\"blockNumber\":123456}",
                "{\"maxInput\":\"2500000000000000000\",\"marketPrice\":\"0.9969748\",\"blockNumber\":123456}"
            ]
        };
        const expectedResult = {
            reports: [{
                spanAttributes: expectedSpanAttributes,
                order: ordersDetails[0].id,
                error: undefined,
                reason: AttemptOppAndClearHaltReason.NoOpportunity
            }],
            foundOppsCount: 0,
            clearsCount: 0,
            txUrls: []
        };
        const expectedOtelResult = {
            attributes: {
                ...expectedSpanAttributes,
                "details.input": usdt.address,
                "details.output": wmatic.address,
                "details.pair": pair,
                "details.gasPrice": gasPrice.toString(),
            },
            status: { code: SpanStatusCode.OK, message: "no opportunity" },
            exception: undefined
        };
        assert.deepEqual(result, expectedResult);
        assert.deepEqual(expectedOtelResult, otelResult);
    });

    it("should process orders with no route", async function () {
        dataFetcher.getCurrentPoolCodeMap = () => {
            return new Map();
        };
        const result = await processOrders(
            config,
            ordersDetails,
            tracer,
            undefined,
        );
        const expectedSpanAttributes = {
            "details.order": ordersDetails[0].id,
        };
        const expectedResult = {
            reports: [{
                spanAttributes: expectedSpanAttributes,
                order: ordersDetails[0].id,
                error: undefined,
                reason: AttemptOppAndClearHaltReason.NoRoute
            }],
            foundOppsCount: 0,
            clearsCount: 0,
            txUrls: []
        };
        const expectedOtelResult = {
            attributes: {
                ...expectedSpanAttributes,
                "details.input": usdt.address,
                "details.output": wmatic.address,
                "details.pair": pair,
                "details.gasPrice": gasPrice.toString(),
            },
            status: { code: SpanStatusCode.OK, message: "no route" },
            exception: undefined
        };
        assert.deepEqual(result, expectedResult);
        assert.deepEqual(expectedOtelResult, otelResult);
    });

    it("should process orders with no wallet fund", async function () {
        dataFetcher.getCurrentPoolCodeMap = () => {
            return poolCodeMap;
        };
        signer.estimateGas = async () => {
            return Promise.reject({ code: ethers.errors.INSUFFICIENT_FUNDS });
        };
        const result = await processOrders(
            config,
            ordersDetails,
            tracer,
            undefined,
        );
        const expectedSpanAttributes = {
            "details.order": ordersDetails[0].id,
        };
        const expectedResult = {
            reports: [{
                spanAttributes: expectedSpanAttributes,
                order: ordersDetails[0].id,
                error: undefined,
                reason: AttemptOppAndClearHaltReason.NoWalletFund
            }],
            foundOppsCount: 0,
            clearsCount: 0,
            txUrls: []
        };
        const expectedOtelResult = {
            attributes: {
                ...expectedSpanAttributes,
                "details.input": usdt.address,
                "details.output": wmatic.address,
                "details.pair": pair,
                "details.gasPrice": gasPrice.toString(),
            },
            status: { code: SpanStatusCode.ERROR, message: "empty wallet" },
            exception: undefined
        };
        assert.deepEqual(result, expectedResult);
        assert.deepEqual(expectedOtelResult, otelResult);
    });

    it("should process orders with fail to submit tx", async function () {
        dataFetcher.getCurrentPoolCodeMap = () => {
            return poolCodeMap;
        };
        signer.sendTransaction = async () => {
            return Promise.reject({ code: ethers.errors.UNPREDICTABLE_GAS_LIMIT });
        };
        const result = await processOrders(
            config,
            ordersDetails,
            tracer,
            undefined,
        );
        const expectedTakeOrdersConfigStruct = {
            minimumInput: ethers.BigNumber.from("1"),
            maximumInput: vaultBalance,
            maximumIORatio: ethers.constants.MaxUint256,
            orders: [{
                order: JSON.parse(ordersDetails[0].orderJSONString),
                inputIOIndex: 0,
                outputIOIndex: 0,
                signedContext: []
            }],
            data: expectedRouteData
        };
        const rawtx = {
            data: arb.interface.encodeFunctionData(
                "arb",
                [
                    expectedTakeOrdersConfigStruct,
                    "0"
                ]
            ),
            to: arb.address,
            gasPrice,
            gasLimit: gasLimitEstimation.mul("103").div("100"),
        };
        const expectedSpanAttributes = {
            "details.order": ordersDetails[0].id,
            "details.oppBlockNumber": 123456,
            "details.clearBlockNumber": 123456,
            "details.blockDiff": 0,
            "details.route": expectedRouteVisual,
            "details.maxInput": vaultBalance.toString(),
            "details.marketPrice": "0.9969006",
            "details.estimatedGasCostInToken": "0.0",
            "details.rawTx": JSON.stringify(rawtx),
        };
        const expectedResult = {
            reports: [{
                tokenPair: pair,
                buyToken: usdt.address,
                sellToken: wmatic.address,
                order: ordersDetails[0].id,
                spanAttributes: expectedSpanAttributes,
                error: { code: ethers.errors.UNPREDICTABLE_GAS_LIMIT },
                reason: AttemptOppAndClearHaltReason.TxFailed
            }],
            foundOppsCount: 1,
            clearsCount: 0,
            txUrls: []
        };
        const expectedOtelResult = {
            attributes: {
                ...expectedSpanAttributes,
                "details.input": usdt.address,
                "details.output": wmatic.address,
                "details.pair": pair,
                "details.gasPrice": gasPrice.toString(),
                "details.error": JSON.stringify({ code: ethers.errors.UNPREDICTABLE_GAS_LIMIT }),
                "foundOpp": true,
            },
            status: { code: SpanStatusCode.OK, message: "failed to send the transaction" },
            exception: undefined
        };
        assert.deepEqual(result, expectedResult);
        assert.deepEqual(expectedOtelResult, otelResult);
    });

    it("should process orders with fail to mine tx", async function () {
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
        const result = await processOrders(
            config,
            ordersDetails,
            tracer,
            undefined,
        );
        const expectedSpanAttributes = {
            "details.order": ordersDetails[0].id,
            "details.oppBlockNumber": 123456,
            "details.clearBlockNumber": 123456,
            "details.blockDiff": 0,
            "details.route": expectedRouteVisual,
            "details.maxInput": vaultBalance.toString(),
            "details.marketPrice": "0.9969006",
            "details.estimatedGasCostInToken": "0.0",
            "details.receipt": JSON.stringify(receipt),
            "details.txUrl": "https://polygonscan.com/tx/" + txHash,
            "details.tx": JSON.stringify({ hash: txHash })
        };
        const expectedResult = {
            reports: [{
                txUrl: "https://polygonscan.com/tx/" + txHash,
                tokenPair: pair,
                buyToken: usdt.address,
                sellToken: wmatic.address,
                order: ordersDetails[0].id,
                spanAttributes: expectedSpanAttributes,
                error: undefined,
                reason: AttemptOppAndClearHaltReason.TxMineFailed
            }],
            foundOppsCount: 1,
            clearsCount: 0,
            txUrls: ["https://polygonscan.com/tx/" + txHash]
        };
        const expectedOtelResult = {
            attributes: {
                ...expectedSpanAttributes,
                "details.input": usdt.address,
                "details.output": wmatic.address,
                "details.pair": pair,
                "details.gasPrice": gasPrice.toString(),
                foundOpp: true,
            },
            status: { code: SpanStatusCode.OK, message: "transaction was included in block, but execution failed" },
            exception: undefined
        };
        assert.deepEqual(result, expectedResult);
        assert.deepEqual(expectedOtelResult, otelResult);
    });

    it("should process orders with have no vault balance", async function () {
        viemClient.multicall = async () => [0n];
        const result = await processOrders(
            config,
            ordersDetails,
            tracer,
            undefined,
        );
        const expectedSpanAttributes = {
            "details.orders": [ordersDetails[0].id]
        };
        const expectedResult = {
            reports: [],
            foundOppsCount: 0,
            clearsCount: 0,
            txUrls: []
        };
        const expectedOtelResult = {
            attributes: {
                ...expectedSpanAttributes,
                "details.input": usdt.address,
                "details.output": wmatic.address,
                "details.pair": pair,
            },
            status: { code: SpanStatusCode.OK, message: "all orders have empty vault" },
            exception: undefined
        };
        assert.deepEqual(result, expectedResult);
        assert.deepEqual(expectedOtelResult, otelResult);
    });

    it("should process orders with fail to get vault balance", async function () {
        const evmError = { code: ethers.errors.CALL_EXCEPTION };
        viemClient.multicall = async () => {
            return Promise.reject(evmError);
        };
        const result = await processOrders(
            config,
            ordersDetails,
            tracer,
            undefined,
        );
        const expectedSpanAttributes = {
            "details.orders": [ordersDetails[0].id]
        };
        const expectedResult = {
            reports: [],
            foundOppsCount: 0,
            clearsCount: 0,
            txUrls: []
        };
        const expectedOtelResult = {
            attributes: {
                ...expectedSpanAttributes,
                "details.input": usdt.address,
                "details.output": wmatic.address,
                "details.pair": pair,
            },
            status: { code: SpanStatusCode.ERROR, message: pair + ": failed to get vault balances" },
            exception: evmError
        };
        assert.deepEqual(result, expectedResult);
        assert.deepEqual(expectedOtelResult, otelResult);
    });

    it("should process orders with fail to get gas price", async function () {
        const evmError = { code: ethers.errors.CALL_EXCEPTION };
        signer.provider.getGasPrice = async () => {
            return Promise.reject(evmError);
        };
        const result = await processOrders(
            config,
            ordersDetails,
            tracer,
            undefined,
        );
        const expectedSpanAttributes = {
            "details.orders": [ordersDetails[0].id]
        };
        const expectedResult = {
            reports: [],
            foundOppsCount: 0,
            clearsCount: 0,
            txUrls: []
        };
        const expectedOtelResult = {
            attributes: {
                ...expectedSpanAttributes,
                "details.input": usdt.address,
                "details.output": wmatic.address,
                "details.pair": pair,
            },
            status: { code: SpanStatusCode.ERROR, message: pair + ": failed to get gas price" },
            exception: evmError
        };
        assert.deepEqual(result, expectedResult);
        assert.deepEqual(expectedOtelResult, otelResult);
    });

    it("should process orders with fail to get eth price", async function () {
        config.gasCoveragePercentage = "100";
        dataFetcher.getCurrentPoolCodeMap = () => {
            return new Map();
        };
        const result = await processOrders(
            config,
            ordersDetails,
            tracer,
            undefined,
        );
        const expectedSpanAttributes = {
            "details.orders": [ordersDetails[0].id]
        };
        const expectedResult = {
            reports: [],
            foundOppsCount: 0,
            clearsCount: 0,
            txUrls: []
        };
        const expectedOtelResult = {
            attributes: {
                ...expectedSpanAttributes,
                "details.input": usdt.address,
                "details.output": wmatic.address,
                "details.pair": pair,
                "details.gasPrice": gasPrice.toString(),
            },
            status: { code: SpanStatusCode.OK, message: "failed to get eth price" },
            exception: undefined
        };
        assert.deepEqual(result, expectedResult);
        assert.deepEqual(expectedOtelResult, otelResult);
    });

    it("should process orders with fail to get pools", async function () {
        const evmError = { code: ethers.errors.CALL_EXCEPTION };
        dataFetcher.fetchPoolsForToken = () => {
            return Promise.reject(evmError);
        };
        const result = await processOrders(
            config,
            ordersDetails,
            tracer,
            undefined,
        );
        const expectedSpanAttributes = {
            "details.orders": [ordersDetails[0].id]
        };
        const expectedResult = {
            reports: [],
            foundOppsCount: 0,
            clearsCount: 0,
            txUrls: []
        };
        const expectedOtelResult = {
            attributes: {
                ...expectedSpanAttributes,
                "details.input": usdt.address,
                "details.output": wmatic.address,
                "details.pair": pair,
                "details.gasPrice": gasPrice.toString()
            },
            status: { code: SpanStatusCode.ERROR, message: pair + ": failed to get pool details" },
            exception: evmError
        };
        assert.deepEqual(result, expectedResult);
        assert.deepEqual(expectedOtelResult, otelResult);
    });
});