const { assert } = require("chai");
const { abi: arbRp4Abi } = require("./abis/RouteProcessorOrderBookV4ArbOrderTaker.json");
const {
    BaseError,
    HttpRequestError,
    CallExecutionError,
    encodeFunctionData,
    TransactionRejectedRpcError,
} = require("viem");
const {
    hasFrontrun,
    shouldThrow,
    getRpcError,
    tryDecodeError,
    parseRevertError,
} = require("../src/error");

describe("Test error", async function () {
    const data = "0x963b34a500000000000000000000000000000000000000000000000340bda9d7e155feb0";

    it("should decode the error data", async function () {
        const result = tryDecodeError(data);
        const expected = {
            name: "MinimalOutputBalanceViolation",
            args: ["60005303754817928880"],
        };
        assert.deepEqual(result, expected);
    });

    it("should parse viem revert error", async function () {
        const rawError = {
            code: -3,
            message: "some msg",
            data,
        };
        const error = new BaseError("some msg", { cause: rawError });
        const result = parseRevertError(error);
        const expected = {
            raw: rawError,
            decoded: {
                name: "MinimalOutputBalanceViolation",
                args: ["60005303754817928880"],
            },
        };
        assert.deepEqual(result, expected);
    });

    it("should find frontrun tx", async function () {
        const takeOrderV3Config = {
            order: {
                owner: "0x7177b9d00bB5dbcaaF069CC63190902763783b09",
                evaluable: {
                    interpreter: "0xC1A14cE2fd58A3A2f99deCb8eDd866204eE07f8D",
                    store: "0xFA4989F5D49197FD9673cE4B7Fe2A045A0F2f9c8",
                    bytecode: "0x1234",
                },
                validInputs: [
                    {
                        token: "0x4Aa9AEf59C7B63CD5C4B2eDE81F65A4225a99d9d",
                        decimals: 18,
                        vaultId: 1n,
                    },
                ],
                validOutputs: [
                    {
                        token: "0xc92be5C1a82da1Ab3984a3923dCC5d8576279c7d",
                        decimals: 18,
                        vaultId: 1n,
                    },
                ],
                nonce: "0x8170f8b00c92678800474dfc16369f1cb5ca8a8c70b620a3b9a103e04f750ae2",
            },
            inputIOIndex: 0n,
            outputIOIndex: 0n,
            signedContext: [],
        };
        const rawtx = {
            to: "0x7D2f700b1f6FD75734824EA4578960747bdF269A",
            data: encodeFunctionData({
                abi: arbRp4Abi,
                functionName: "arb3",
                args: [
                    "0x245fCcE2d5D0E365C2777B5984460742cE438e7e",
                    {
                        minimumInput: 1n,
                        maximumInput: 100000000000n,
                        maximumIORatio: 115792089237316195423570985n,
                        orders: [takeOrderV3Config],
                        data: "0x",
                    },
                    {
                        evaluable: {
                            interpreter: "0x0000000000000000000000000000000000000000",
                            store: "0x0000000000000000000000000000000000000000",
                            bytecode: "0x",
                        },
                        signedContext: [],
                    },
                ],
            }),
        };
        const receipt = {
            transactionIndex: 2,
            transactionHash: "0x2",
        };
        const expectedReceipt = {
            transactionIndex: 1,
            transactionHash: "0x1",
        };
        const viemClient = {
            getLogs: async () => [
                {
                    ...expectedReceipt,
                    args: {
                        config: takeOrderV3Config,
                    },
                },
                {
                    ...receipt,
                    args: {
                        config: takeOrderV3Config,
                    },
                },
            ],
        };
        const result = await hasFrontrun(viemClient, rawtx, receipt, "");

        assert.equal(result, expectedReceipt.transactionHash);
    });

    it("should test shouldThrow", async function () {
        const error = { code: -32003, message: "execution reverted" };
        assert(shouldThrow(error));
        delete error.message;

        error.code = 4001;
        assert(shouldThrow(error));

        error.code = 5000;
        assert(shouldThrow(error));

        error.code = -32006;
        assert(!shouldThrow(error));

        delete error.code;
        assert(!shouldThrow(error));
    });

    it("should test getRpcError", async function () {
        // not rpc error
        let result = getRpcError(new HttpRequestError({ url: "https://example.com", body: {} }));
        let expected = {
            data: undefined,
            code: undefined,
            message: undefined,
        };
        assert.deepEqual(result, expected);

        // rpc error wrapped by viem
        result = getRpcError(
            new CallExecutionError(
                new TransactionRejectedRpcError({ message: "execution reverted", code: -32003 }),
                { account: {} },
            ),
        );
        expected = {
            data: undefined,
            code: -32003,
            message: "execution reverted",
        };
        assert.deepEqual(result, expected);
    });
});
