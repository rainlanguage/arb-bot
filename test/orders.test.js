const { assert } = require("chai");
const { bundleOrders } = require("../src/utils");

describe("Test order details", async function () {
    it("should return correct order details", async function () {
        const mockedOrder = {
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
        const mockOrderStruct = JSON.parse(mockedOrder.orderJSONString);

        const result = bundleOrders([mockedOrder], false, false);
        const expected = [{
            buyToken: mockOrderStruct.validInputs[0].token,
            buyTokenSymbol: mockedOrder.validInputs[0].token.symbol,
            buyTokenDecimals: mockOrderStruct.validInputs[0].decimals,
            sellToken: mockOrderStruct.validOutputs[0].token,
            sellTokenSymbol: mockedOrder.validOutputs[0].token.symbol,
            sellTokenDecimals: mockOrderStruct.validOutputs[0].decimals,
            takeOrders: [{
                id: mockedOrder.id,
                takeOrder: {
                    order: mockOrderStruct,
                    inputIOIndex: 0,
                    outputIOIndex: 0,
                    signedContext: []
                }
            }]
        }];

        assert.deepEqual(result, expected);
    });
});