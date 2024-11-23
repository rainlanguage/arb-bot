const { assert } = require("chai");
const { BaseError } = require("viem");
const { tryDecodeError, parseRevertError } = require("../src/error");

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
});
