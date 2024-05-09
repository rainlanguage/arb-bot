const { assert } = require("chai");
const { getConfig } = require("../src");
const { assertError } = require("./utils");

describe("Test app options", async function () {
    it("should use defaults", async function () {
        const config = await getConfig(
            "https://rpc.ankr.com/polygon", //rpc
            "0x" + "1".repeat(64), // wallet key
            "0x" + "2".repeat(40), // ob address
            "0x" + "3".repeat(40), // arb address
            {}
        );

        assert.equal(config.lps, undefined);
        assert.equal(config.flashbotRpc, undefined);
        assert.equal(config.maxProfit, false);
        assert.equal(config.maxRatio, false);
        assert.equal(config.hops, 11);
        assert.equal(config.retries, 1);
        assert.equal(config.rp32, false);
        assert.equal(config.bundle, true);
        assert.equal(config.chain.id, 137);
    });

    it("should error if retries is not between 1-3", async function () {
        const configPromise = async() => await getConfig(
            "https://rpc.ankr.com/polygon",
            "0x" + "1".repeat(64),
            "0x" + "2".repeat(40),
            "0x" + "3".repeat(40),
            { retries: 5 }
        );
        await assertError(
            configPromise,
            "invalid retries value, must be an integer between 1 - 3",
            "unexpected error"
        );
    });
});