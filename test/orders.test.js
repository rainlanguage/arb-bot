const { assert } = require("chai");
const { bundleOrders } = require("../src/utils");

describe("Test order details", async function () {
    it("should return correct order details", async function () {
        const order1 = {
            orderJSONString: "{\"owner\":\"0x0f47a0c7f86a615606ca315ad83c3e302b474bd6\",\"handleIo\":false,\"evaluable\":{\"interpreter\":\"0x1efd85e6c384fad9b80c6d508e9098eb91c4ed30\",\"store\":\"0x4ffc97bfb6dfce289f9b2a4083f5f5e940c8b88d\",\"expression\":\"0x224f9ca76a6f1b3414280bed0f68227c1b61f2b2\"},\"validInputs\":[{\"token\":\"0x96b41289d90444b8add57e6f265db5ae8651df29\",\"decimals\":\"6\",\"vaultId\":\"0xdce98e3a7ee4b8b7ec1def4542b220083f8c3f0d569f142752cdc5bad6e14092\"}],\"validOutputs\":[{\"token\":\"0x1d80c49bbbcd1c0911346656b529df9e5c2f783d\",\"decimals\":\"18\",\"vaultId\":\"0xdce98e3a7ee4b8b7ec1def4542b220083f8c3f0d569f142752cdc5bad6e14092\"}]}",
            id: "0x004349d76523bce3b6aeec93cf4c2a396b9cb71bc07f214e271cab363a0c89eb",
            validInputs: [{
                token: {
                    id: "0x96b41289d90444b8add57e6f265db5ae8651df29",
                    decimals: 6,
                    symbol: "eUSDT"
                }
            }],
            validOutputs: [{
                token: {
                    id: "0x1d80c49bbbcd1c0911346656b529df9e5c2f783d",
                    decimals: 18,
                    symbol: "WFLR",
                }
            }]
        };
        const orderStruct1 = JSON.parse(order1.orderJSONString);

        const order2 = {
            orderJSONString: "{\"owner\":\"0x0eb840e5acd0125853ad630663d3a62e673c22e6\",\"handleIo\":false,\"evaluable\":{\"interpreter\":\"0x1efd85e6c384fad9b80c6d508e9098eb91c4ed30\",\"store\":\"0x4ffc97bfb6dfce289f9b2a4083f5f5e940c8b88d\",\"expression\":\"0xcc2de1bec57eb64004bcf28cc7cc3c62c4cc574b\"},\"validInputs\":[{\"token\":\"0x96b41289d90444b8add57e6f265db5ae8651df29\",\"decimals\":\"6\",\"vaultId\":\"0xce7cff94ca97c481063dae48cfb378eb4dd3c6b935aef16c2397624c300045fb\"},{\"token\":\"0x1d80c49bbbcd1c0911346656b529df9e5c2f783d\",\"decimals\":\"18\",\"vaultId\":\"0xce7cff94ca97c481063dae48cfb378eb4dd3c6b935aef16c2397624c300045fb\"}],\"validOutputs\":[{\"token\":\"0x96b41289d90444b8add57e6f265db5ae8651df29\",\"decimals\":\"6\",\"vaultId\":\"0xce7cff94ca97c481063dae48cfb378eb4dd3c6b935aef16c2397624c300045fb\"},{\"token\":\"0x1d80c49bbbcd1c0911346656b529df9e5c2f783d\",\"decimals\":\"18\",\"vaultId\":\"0xce7cff94ca97c481063dae48cfb378eb4dd3c6b935aef16c2397624c300045fb\"}]}",
            id: "0x008817a4b6f264326ef14357df54e48b9c064051f54f3877807970bb98096c01",
            validInputs: [
                {
                    token: {
                        id: "0x96b41289d90444b8add57e6f265db5ae8651df29",
                        decimals: 6,
                        symbol: "eUSDT"
                    }
                },
                {
                    token: {
                        id: "0x1d80c49bbbcd1c0911346656b529df9e5c2f783d",
                        decimals: 18,
                        symbol: "WFLR",
                    }
                }
            ],
            validOutputs: [
                {
                    token: {
                        id: "0x96b41289d90444b8add57e6f265db5ae8651df29",
                        decimals: 6,
                        symbol: "eUSDT"
                    }
                },
                {
                    token: {
                        id: "0x1d80c49bbbcd1c0911346656b529df9e5c2f783d",
                        decimals: 18,
                        symbol: "WFLR",
                    }
                }
            ]
        };
        const orderStruct2 = JSON.parse(order2.orderJSONString);

        const result = bundleOrders([order1, order2], false, false);
        const expected = [
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
                        order: orderStruct1,
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
                        order: orderStruct2,
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
                        order: orderStruct2,
                        inputIOIndex: 0,
                        outputIOIndex: 1,
                        signedContext: []
                    }
                }]
            },
        ];

        assert.deepEqual(result, expected);
    });
});