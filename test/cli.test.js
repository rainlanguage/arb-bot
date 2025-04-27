require("dotenv").config();
const { assert } = require("chai");
const { sleep } = require("../src/utils");
const mockServer = require("mockttp").getLocal();
const { trace, context } = require("@opentelemetry/api");
const { Resource } = require("@opentelemetry/resources");
const { BasicTracerProvider } = require("@opentelemetry/sdk-trace-base");
const { SEMRESATTRS_SERVICE_NAME } = require("@opentelemetry/semantic-conventions");
const {
    startup,
    arbRound,
    validateHash,
    validateAddress,
    parseArrayFromEnv,
} = require("../src/cli");

describe("Test cli", async function () {
    beforeEach(() => mockServer.start(8080));
    afterEach(() => mockServer.stop());

    it("return correct result for empty orders array", async function () {
        const provider = new BasicTracerProvider({
            resource: new Resource({
                [SEMRESATTRS_SERVICE_NAME]: "arb-bot-test",
            }),
        });
        const tracer = provider.getTracer("arb-bot-tracer");
        const testSpan = tracer.startSpan("test");
        const ctx = trace.setSpan(context.active(), testSpan);

        // Mock sg status and orders query
        await mockServer
            .forPost("/sg-url")
            .withBodyIncluding("_meta")
            .thenReply(200, JSON.stringify({ data: { _meta: { hasIndexingErrors: false } } }));
        await mockServer
            .forPost("/sg-url")
            .withBodyIncluding("orders")
            .thenReply(200, JSON.stringify({ data: { orders: [] } }));

        // mock provider chain id call
        await mockServer
            .forPost("/rpc-url")
            .withBodyIncluding("eth_chainId")
            .thenReply(200, JSON.stringify({ jsonrpc: "2.0", id: 1, result: "137" }));

        const options = {
            rpc: ["http://localhost:8080/rpc-url"],
            key: "0x" + "1".repeat(64),
            arbAddress: "0x" + "0".repeat(40),
            maxRatio: true,
            subgraph: ["http://localhost:8080/sg-url"],
        };

        const response = await arbRound(tracer, ctx, options, { mainAccount: {} });
        const expected = { txs: [], foundOpp: false, didClear: false, avgGasCost: undefined };
        assert.deepEqual(response, expected);

        testSpan.end();
    });

    it("test cli startup", async function () {
        process.env.CLI_STARTUP_TEST = true;
        const deployer = "0xE7116BC05C8afe25e5B54b813A74F916B5D42aB1";

        try {
            await startup(["", ""]);
            assert.fail("expected to fail, but resolved");
        } catch (error) {
            const expected = "undefined wallet, only one of key or mnemonic should be specified";
            assert.equal(error, expected);
        }

        try {
            await startup(["", "", "--key", `0x${"0".repeat(64)}`, "-m", "something"]);
            assert.fail("expected to fail, but resolved");
        } catch (error) {
            const expected = "undefined wallet, only one of key or mnemonic should be specified";
            assert.equal(error, expected);
        }

        try {
            await startup(["", "", "--key", `0x${"0".repeat(63)}`]);
            assert.fail("expected to fail, but resolved");
        } catch (error) {
            const expected = "invalid wallet private key";
            assert.equal(error, expected);
        }

        try {
            await startup([
                "",
                "",
                "-m",
                "test test test test test test test test test test test junk",
            ]);
            assert.fail("expected to fail, but resolved");
        } catch (error) {
            const expected =
                "--wallet-count and --toptup-amount are required when using mnemonic option";
            assert.equal(error, expected);
        }

        try {
            await startup(["", "", "--key", `0x${"0".repeat(64)}`]);
            assert.fail("expected to fail, but resolved");
        } catch (error) {
            const expected = "undefined RPC URL";
            assert.equal(error, expected);
        }

        try {
            await startup(["", "", "--key", `0x${"0".repeat(64)}`, "--rpc", "some-rpc"]);
            assert.fail("expected to fail, but resolved");
        } catch (error) {
            const expected = "undefined arb contract address";
            assert.equal(error, expected);
        }

        try {
            await startup([
                "",
                "",
                "--key",
                `0x${"0".repeat(64)}`,
                "--rpc",
                "some-rpc",
                "--arb-address",
                `0x${"0".repeat(64)}`,
                "--sleep",
                "abcd",
            ]);
            assert.fail("expected to fail, but resolved");
        } catch (error) {
            const expected = "invalid sleep value, must be an integer greater than equal 0";
            assert.equal(error, expected);
        }

        try {
            await startup([
                "",
                "",
                "--key",
                `0x${"0".repeat(64)}`,
                "--rpc",
                "some-rpc",
                "--arb-address",
                `0x${"0".repeat(64)}`,
                "--pool-update-interval",
                "abcd",
            ]);
            assert.fail("expected to fail, but resolved");
        } catch (error) {
            const expected =
                "invalid poolUpdateInterval value, must be an integer greater than equal zero";
            assert.equal(error, expected);
        }

        try {
            await startup([
                "",
                "",
                "--key",
                `0x${"0".repeat(64)}`,
                "--rpc",
                "some-rpc",
                "--arb-address",
                `0x${"0".repeat(64)}`,
                "--pool-update-interval",
                "10",
            ]);
            assert.fail("expected to fail, but resolved");
        } catch (error) {
            const expected =
                "expected a valid value for --bot-min-balance, it should be an number greater than 0";
            assert.equal(error, expected);
        }

        try {
            await startup([
                "",
                "",
                "--key",
                `0x${"0".repeat(64)}`,
                "--rpc",
                "some-rpc",
                "--arb-address",
                `0x${"0".repeat(64)}`,
                "--pool-update-interval",
                "10",
                "--bot-min-balance",
                "12",
            ]);
            assert.fail("expected to fail, but resolved");
        } catch (error) {
            const expected = "undefined dispair address";
            assert.equal(error, expected);
        }

        try {
            await startup([
                "",
                "",
                "--key",
                `0x${"1".repeat(64)}`,
                "--rpc",
                "https://polygon.drpc.org",
                "--arb-address",
                `0x${"1".repeat(40)}`,
                "--pool-update-interval",
                "10",
                "--bot-min-balance",
                "12",
                "--dispair",
                "0x783b82f0fBF6743882072AE2393B108F5938898B",
            ]);
            assert.fail("expected to fail, but resolved");
        } catch (error) {
            const expected = "failed to get dispair interpreter address";
            assert.equal(error, expected);
        }

        try {
            await startup([
                "",
                "",
                "--key",
                `0x${"1".repeat(64)}`,
                "--rpc",
                "https://rpc.ankr.com/polygon",
                "--arb-address",
                `0x${"1".repeat(40)}`,
                "--pool-update-interval",
                "10",
                "--bot-min-balance",
                "12",
                "--dispair",
                "0x783b82f0fBF6743882072AE2393B108F5938898B",
                "--include-orders",
                `0x${"1".repeat(64)}`,
                `0x${"2".repeat(40)}`,
            ]);
            assert.fail("expected to fail, but resolved");
        } catch (error) {
            const expected = `0x${"2".repeat(40)} is not a valid hash`;
            assert.equal(error, expected);
        }

        try {
            await startup([
                "",
                "",
                "--key",
                `0x${"1".repeat(64)}`,
                "--rpc",
                "https://rpc.ankr.com/polygon",
                "--arb-address",
                `0x${"1".repeat(40)}`,
                "--pool-update-interval",
                "10",
                "--bot-min-balance",
                "12",
                "--dispair",
                "0x783b82f0fBF6743882072AE2393B108F5938898B",
                "--exclude-orders",
                `0x${"1".repeat(64)}`,
                `0x${"2".repeat(40)}`,
            ]);
            assert.fail("expected to fail, but resolved");
        } catch (error) {
            const expected = `0x${"2".repeat(40)} is not a valid hash`;
            assert.equal(error, expected);
        }

        try {
            await startup([
                "",
                "",
                "--key",
                `0x${"1".repeat(64)}`,
                "--rpc",
                "https://rpc.ankr.com/polygon",
                "--arb-address",
                `0x${"1".repeat(40)}`,
                "--pool-update-interval",
                "10",
                "--bot-min-balance",
                "12",
                "--dispair",
                "0x783b82f0fBF6743882072AE2393B108F5938898B",
                "--include-owners",
                `0x${"1".repeat(40)}`,
                `0x${"2".repeat(64)}`,
            ]);
            assert.fail("expected to fail, but resolved");
        } catch (error) {
            const expected = `0x${"2".repeat(64)} is not a valid address`;
            assert.equal(error, expected);
        }

        try {
            await startup([
                "",
                "",
                "--key",
                `0x${"1".repeat(64)}`,
                "--rpc",
                "https://rpc.ankr.com/polygon",
                "--arb-address",
                `0x${"1".repeat(40)}`,
                "--pool-update-interval",
                "10",
                "--bot-min-balance",
                "12",
                "--dispair",
                "0x783b82f0fBF6743882072AE2393B108F5938898B",
                "--exclude-owners",
                `0x${"1".repeat(40)}`,
                `0x${"2".repeat(64)}`,
            ]);
            assert.fail("expected to fail, but resolved");
        } catch (error) {
            const expected = `0x${"2".repeat(64)} is not a valid address`;
            assert.equal(error, expected);
        }

        try {
            await startup([
                "",
                "",
                "--key",
                `0x${"1".repeat(64)}`,
                "--rpc",
                "https://rpc.ankr.com/polygon",
                "--arb-address",
                `0x${"1".repeat(40)}`,
                "--pool-update-interval",
                "10",
                "--bot-min-balance",
                "12",
                "--dispair",
                "0x783b82f0fBF6743882072AE2393B108F5938898B",
                "--include-orderbooks",
                `0x${"1".repeat(40)}`,
                `0x${"2".repeat(64)}`,
            ]);
            assert.fail("expected to fail, but resolved");
        } catch (error) {
            const expected = `0x${"2".repeat(64)} is not a valid address`;
            assert.equal(error, expected);
        }

        try {
            await startup([
                "",
                "",
                "--key",
                `0x${"1".repeat(64)}`,
                "--rpc",
                "https://rpc.ankr.com/polygon",
                "--arb-address",
                `0x${"1".repeat(40)}`,
                "--pool-update-interval",
                "10",
                "--bot-min-balance",
                "12",
                "--dispair",
                "0x783b82f0fBF6743882072AE2393B108F5938898B",
                "--exclude-orderbooks",
                `0x${"1".repeat(40)}`,
                `0x${"2".repeat(64)}`,
            ]);
            assert.fail("expected to fail, but resolved");
        } catch (error) {
            const expected = `0x${"2".repeat(64)} is not a valid address`;
            assert.equal(error, expected);
        }

        const result = await startup([
            "",
            "",
            "--key",
            "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
            "--rpc",
            "https://polygon.drpc.org",
            "--arb-address",
            `0x${"1".repeat(40)}`,
            "--bot-min-balance",
            "0.123",
            "--gas-price-multiplier",
            "120",
            "--gas-limit-multiplier",
            "110",
            "--tx-gas",
            "123456789",
            "--quote-gas",
            "7777",
            "--rp-only",
            "--dispair",
            deployer,
            "--include-orders",
            `0x${"1".repeat(64)}`,
            `0x${"2".repeat(64)}`,
            "--exclude-orders",
            `0x${"3".repeat(64)}`,
            `0x${"4".repeat(64)}`,
            "--include-owners",
            `0x${"1".repeat(40)}`,
            `0x${"2".repeat(40)}`,
            "--exclude-owners",
            `0x${"3".repeat(40)}`,
            `0x${"4".repeat(40)}`,
            "--include-orderbooks",
            `0x${"5".repeat(40)}`,
            `0x${"6".repeat(40)}`,
            "--exclude-orderbooks",
            `0x${"7".repeat(40)}`,
            `0x${"8".repeat(40)}`,
        ]);
        const expected = {
            roundGap: 10000,
            poolUpdateInterval: 0,
            config: {
                chain: { id: 137 },
                rpc: ["https://polygon.drpc.org"],
                arbAddress: `0x${"1".repeat(40)}`,
                route: "single",
                rpcState: {
                    metrics: {
                        "https://polygon.drpc.org/": {
                            req: 5,
                            success: 5,
                            failure: 0,
                            cache: {},
                        },
                    },
                },
                gasPriceMultiplier: 120,
                gasLimitMultiplier: 110,
                txGas: "123456789",
                quoteGas: 7777n,
                rpOnly: true,
                dispair: {
                    interpreter: "0xC1A14cE2fd58A3A2f99deCb8eDd866204eE07f8D",
                    store: "0xFA4989F5D49197FD9673cE4B7Fe2A045A0F2f9c8",
                    deployer,
                },
            },
            options: {
                botMinBalance: "0.123",
                gasPriceMultiplier: 120,
                gasLimitMultiplier: 110,
                txGas: "123456789",
                quoteGas: 7777n,
                rpOnly: true,
                dispair: deployer,
                sgFilter: {
                    includeOrders: new Set([`0x${"1".repeat(64)}`, `0x${"2".repeat(64)}`]),
                    excludeOrders: new Set([`0x${"3".repeat(64)}`, `0x${"4".repeat(64)}`]),
                    includeOwners: new Set([`0x${"1".repeat(40)}`, `0x${"2".repeat(40)}`]),
                    excludeOwners: new Set([`0x${"3".repeat(40)}`, `0x${"4".repeat(40)}`]),
                    includeOrderbooks: new Set([`0x${"5".repeat(40)}`, `0x${"6".repeat(40)}`]),
                    excludeOrderbooks: new Set([`0x${"7".repeat(40)}`, `0x${"8".repeat(40)}`]),
                },
            },
        };
        await sleep(1000);
        assert.equal(result.roundGap, expected.roundGap);
        assert.equal(result.poolUpdateInterval, expected.poolUpdateInterval);
        assert.equal(result.config.chain.id, expected.config.chain.id);
        assert.equal(result.config.rpc[0], expected.config.rpc[0]);
        assert.equal(result.config.arbAddress, expected.config.arbAddress);
        assert.equal(result.config.route, expected.config.route);
        assert.equal(result.options.botMinBalance, expected.options.botMinBalance);
        assert.equal(result.options.gasPriceMultiplier, expected.options.gasPriceMultiplier);
        assert.equal(result.config.gasPriceMultiplier, expected.config.gasPriceMultiplier);
        assert.equal(result.options.gasLimitMultiplier, expected.options.gasLimitMultiplier);
        assert.equal(result.config.gasLimitMultiplier, expected.config.gasLimitMultiplier);
        assert.equal(result.options.txGas, expected.options.txGas);
        assert.equal(result.config.txGas, expected.config.txGas);
        assert.equal(result.options.quoteGas, expected.options.quoteGas);
        assert.equal(result.config.quoteGas, expected.config.quoteGas);
        assert.equal(result.options.rpOnly, expected.options.rpOnly);
        assert.equal(result.config.rpOnly, expected.config.rpOnly);
        assert.deepEqual(result.options.dispair, expected.options.dispair);
        assert.deepEqual(result.config.dispair, expected.config.dispair);
        for (const url in result.config.rpcState.metrics) {
            assert.equal(
                result.config.rpcState.metrics[url].req,
                expected.config.rpcState.metrics[url].req,
            );
            assert.equal(
                result.config.rpcState.metrics[url].success,
                expected.config.rpcState.metrics[url].success,
            );
            assert.equal(
                result.config.rpcState.metrics[url].failure,
                expected.config.rpcState.metrics[url].failure,
            );
            assert.deepEqual(
                result.config.rpcState.metrics[url].cache,
                expected.config.rpcState.metrics[url].cache,
            );
            assert.notEqual(result.config.rpcState.metrics[url].lastRequestTimestamp, 0);
            assert.isNotEmpty(result.config.rpcState.metrics[url].requestIntervals);
        }
        assert.deepEqual(result.options.sgFilter, expected.options.sgFilter);
    });

    it("test get array from env", async function () {
        let result = parseArrayFromEnv("a, b,c, d");
        let expected = ["a", "b", "c", "d"];
        assert.deepEqual(result, expected);

        result = parseArrayFromEnv("  abcd   ");
        expected = ["abcd"];
        assert.deepEqual(result, expected);

        result = parseArrayFromEnv("");
        expected = undefined;
        assert.deepEqual(result, expected);

        result = parseArrayFromEnv();
        expected = undefined;
        assert.deepEqual(result, expected);
    });

    it("test validate address", async function () {
        assert.ok(validateAddress("0xC1A14cE2fd58A3A2f99deCb8eDd866204eE07f8D"));

        assert.throws(() => validateAddress(), "expected string");
        assert.throws(() => validateAddress(0x1234567), "expected string");
        assert.throws(() => validateAddress(""), " is not a valid address");
        assert.throws(
            () => validateAddress("0xC1A14cE2fd58A3A2f99deCb8eDd866204eE07f8"),
            "0xC1A14cE2fd58A3A2f99deCb8eDd866204eE07f8 is not a valid address",
        );
        assert.throws(
            () => validateAddress("0xC1A14cE2fd58A3A2f99deCb8eDd866204eE07f8GGG"),
            "0xC1A14cE2fd58A3A2f99deCb8eDd866204eE07f8GGG is not a valid address",
        );
    });

    it("test validate hash", async function () {
        assert.ok(
            validateHash("0xC1A14cE2fd58A3A2f99deCb8eDd866204eE07f8DeDd866204eE07f8DeDd86620"),
        );

        assert.throws(() => validateHash(), "expected string");
        assert.throws(() => validateHash(0x1234567), "expected string");
        assert.throws(() => validateHash(""), " is not a valid hash");
        assert.throws(
            () => validateHash("0xC1A14cE2fd58A3A2f99deCb8eDd866204eE07f8"),
            "0xC1A14cE2fd58A3A2f99deCb8eDd866204eE07f8 is not a valid hash",
        );
        assert.throws(
            () => validateHash("0xC1A14cE2fd58A3A2f99deCb8eDd866204eE07f8GGG"),
            "0xC1A14cE2fd58A3A2f99deCb8eDd866204eE07f8GGG is not a valid hash",
        );
    });
});
