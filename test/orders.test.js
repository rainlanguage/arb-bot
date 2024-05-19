const { assert } = require("chai");
const { bundleOrders } = require("../src/utils");

describe("Test order details", async function () {
    const order1 = {
        orderJSONString: "{\"owner\":\"0x0f47a0c7f86a615606ca315ad83c3e302b474bd6\",\"handleIo\":false,\"evaluable\":{\"interpreter\":\"0x1efd85e6c384fad9b80c6d508e9098eb91c4ed30\",\"store\":\"0x4ffc97bfb6dfce289f9b2a4083f5f5e940c8b88d\",\"expression\":\"0x224f9ca76a6f1b3414280bed0f68227c1b61f2b2\"},\"validInputs\":[{\"token\":\"0xc2132d05d31c914a87c6611c10748aeb04b58e8f\",\"decimals\":\"6\",\"vaultId\":\"0xdce98e3a7ee4b8b7ec1def4542b220083f8c3f0d569f142752cdc5bad6e14092\"}],\"validOutputs\":[{\"token\":\"0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270\",\"decimals\":\"18\",\"vaultId\":\"0xdce98e3a7ee4b8b7ec1def4542b220083f8c3f0d569f142752cdc5bad6e14092\"}]}",
        id: "0x004349d76523bce3b6aeec93cf4c2a396b9cb71bc07f214e271cab363a0c89eb",
        validInputs: [{
            token: {
                id: "0xc2132d05d31c914a87c6611c10748aeb04b58e8f",
                decimals: 6,
                symbol: "USDT"
            }
        }],
        validOutputs: [{
            token: {
                id: "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270",
                decimals: 18,
                symbol: "WMATIC",
            }
        }]
    };
    const orderStruct1 = JSON.parse(order1.orderJSONString);

    const order2 = {
        orderJSONString: "{\"owner\":\"0x0eb840e5acd0125853ad630663d3a62e673c22e6\",\"handleIo\":false,\"evaluable\":{\"interpreter\":\"0x1efd85e6c384fad9b80c6d508e9098eb91c4ed30\",\"store\":\"0x4ffc97bfb6dfce289f9b2a4083f5f5e940c8b88d\",\"expression\":\"0xcc2de1bec57eb64004bcf28cc7cc3c62c4cc574b\"},\"validInputs\":[{\"token\":\"0xc2132d05d31c914a87c6611c10748aeb04b58e8f\",\"decimals\":\"6\",\"vaultId\":\"0xce7cff94ca97c481063dae48cfb378eb4dd3c6b935aef16c2397624c300045fb\"},{\"token\":\"0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270\",\"decimals\":\"18\",\"vaultId\":\"0xce7cff94ca97c481063dae48cfb378eb4dd3c6b935aef16c2397624c300045fb\"}],\"validOutputs\":[{\"token\":\"0xc2132d05d31c914a87c6611c10748aeb04b58e8f\",\"decimals\":\"6\",\"vaultId\":\"0xce7cff94ca97c481063dae48cfb378eb4dd3c6b935aef16c2397624c300045fb\"},{\"token\":\"0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270\",\"decimals\":\"18\",\"vaultId\":\"0xce7cff94ca97c481063dae48cfb378eb4dd3c6b935aef16c2397624c300045fb\"}]}",
        id: "0x008817a4b6f264326ef14357df54e48b9c064051f54f3877807970bb98096c01",
        validInputs: [
            {
                token: {
                    id: "0xc2132d05d31c914a87c6611c10748aeb04b58e8f",
                    decimals: 6,
                    symbol: "USDT"
                }
            },
            {
                token: {
                    id: "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270",
                    decimals: 18,
                    symbol: "WMATIC",
                }
            }
        ],
        validOutputs: [
            {
                token: {
                    id: "0xc2132d05d31c914a87c6611c10748aeb04b58e8f",
                    decimals: 6,
                    symbol: "USDT"
                }
            },
            {
                token: {
                    id: "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270",
                    decimals: 18,
                    symbol: "WMATIC",
                }
            }
        ]
    };
    const orderStruct2 = JSON.parse(order2.orderJSONString);

    it("should return correct order details", async function () {
        const unbundledResult = bundleOrders([order1, order2], false, false);
        const unbundledExpected = [
            {
                buyToken: orderStruct1.validInputs[0].token,
                buyTokenSymbol: order1.validInputs[0].token.symbol,
                buyTokenDecimals: orderStruct1.validInputs[0].decimals,
                sellToken: orderStruct1.validOutputs[0].token,
                sellTokenSymbol: order1.validOutputs[0].token.symbol,
                sellTokenDecimals: orderStruct1.validOutputs[0].decimals,
                takeOrders: [{
                    id: order1.id,
                    takeOrder: {
                        order: {
                            owner: orderStruct1.owner,
                            handleIO: orderStruct1.handleIo,
                            evaluable: orderStruct1.evaluable,
                            validInputs: orderStruct1.validInputs,
                            validOutputs: orderStruct1.validOutputs
                        },
                        inputIOIndex: 0,
                        outputIOIndex: 0,
                        signedContext: []
                    }
                }]
            },
            {
                buyToken: orderStruct2.validInputs[1].token,
                buyTokenSymbol: order2.validInputs[1].token.symbol,
                buyTokenDecimals: orderStruct2.validInputs[1].decimals,
                sellToken: orderStruct2.validOutputs[0].token,
                sellTokenSymbol: order2.validOutputs[0].token.symbol,
                sellTokenDecimals: orderStruct2.validOutputs[0].decimals,
                takeOrders: [{
                    id: order2.id,
                    takeOrder: {
                        order: {
                            owner: orderStruct2.owner,
                            handleIO: orderStruct2.handleIo,
                            evaluable: orderStruct2.evaluable,
                            validInputs: orderStruct2.validInputs,
                            validOutputs: orderStruct2.validOutputs
                        },
                        inputIOIndex: 1,
                        outputIOIndex: 0,
                        signedContext: []
                    }
                }]
            },
            {
                buyToken: orderStruct2.validInputs[0].token,
                buyTokenSymbol: order2.validInputs[0].token.symbol,
                buyTokenDecimals: orderStruct2.validInputs[0].decimals,
                sellToken: orderStruct2.validOutputs[1].token,
                sellTokenSymbol: order2.validOutputs[1].token.symbol,
                sellTokenDecimals: orderStruct2.validOutputs[1].decimals,
                takeOrders: [{
                    id: order2.id,
                    takeOrder: {
                        order: {
                            owner: orderStruct2.owner,
                            handleIO: orderStruct2.handleIo,
                            evaluable: orderStruct2.evaluable,
                            validInputs: orderStruct2.validInputs,
                            validOutputs: orderStruct2.validOutputs
                        },
                        inputIOIndex: 0,
                        outputIOIndex: 1,
                        signedContext: []
                    }
                }]
            },
        ];
        assert.deepEqual(unbundledResult, unbundledExpected);

        const bundledResult = bundleOrders([order1, order2], false, true);
        const bundledExpected = [
            {
                buyToken: orderStruct1.validInputs[0].token,
                buyTokenSymbol: order1.validInputs[0].token.symbol,
                buyTokenDecimals: orderStruct1.validInputs[0].decimals,
                sellToken: orderStruct1.validOutputs[0].token,
                sellTokenSymbol: order1.validOutputs[0].token.symbol,
                sellTokenDecimals: orderStruct1.validOutputs[0].decimals,
                takeOrders: [
                    {
                        id: order1.id,
                        takeOrder: {
                            order: {
                                owner: orderStruct1.owner,
                                handleIO: orderStruct1.handleIo,
                                evaluable: orderStruct1.evaluable,
                                validInputs: orderStruct1.validInputs,
                                validOutputs: orderStruct1.validOutputs
                            },
                            inputIOIndex: 0,
                            outputIOIndex: 0,
                            signedContext: []
                        }
                    },
                    {
                        id: order2.id,
                        takeOrder: {
                            order: {
                                owner: orderStruct2.owner,
                                handleIO: orderStruct2.handleIo,
                                evaluable: orderStruct2.evaluable,
                                validInputs: orderStruct2.validInputs,
                                validOutputs: orderStruct2.validOutputs
                            },
                            inputIOIndex: 0,
                            outputIOIndex: 1,
                            signedContext: []
                        }
                    }
                ]
            },
            {
                buyToken: orderStruct2.validInputs[1].token,
                buyTokenSymbol: order2.validInputs[1].token.symbol,
                buyTokenDecimals: orderStruct2.validInputs[1].decimals,
                sellToken: orderStruct2.validOutputs[0].token,
                sellTokenSymbol: order2.validOutputs[0].token.symbol,
                sellTokenDecimals: orderStruct2.validOutputs[0].decimals,
                takeOrders: [{
                    id: order2.id,
                    takeOrder: {
                        order: {
                            owner: orderStruct2.owner,
                            handleIO: orderStruct2.handleIo,
                            evaluable: orderStruct2.evaluable,
                            validInputs: orderStruct2.validInputs,
                            validOutputs: orderStruct2.validOutputs
                        },
                        inputIOIndex: 1,
                        outputIOIndex: 0,
                        signedContext: []
                    }
                }]
            },
        ];
        assert.deepEqual(bundledResult, bundledExpected);
    });
});