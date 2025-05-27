require("dotenv").config();
const { assert } = require("chai");
const { arbRound } = require("../src/cli");
const mockServer = require("mockttp").getLocal();
const { trace, context } = require("@opentelemetry/api");
const { Resource } = require("@opentelemetry/resources");
const { BasicTracerProvider } = require("@opentelemetry/sdk-trace-base");
const { SEMRESATTRS_SERVICE_NAME } = require("@opentelemetry/semantic-conventions");

describe("Test cli", async function () {
    beforeEach(() => mockServer.start(8080));
    afterEach(() => mockServer.stop());

    it("return correct result for empty orders array", async function () {
        const provider = new BasicTracerProvider({
            resource: new Resource({
                [SEMRESATTRS_SERVICE_NAME]: "rain-solver-test",
            }),
        });
        const tracer = provider.getTracer("rain-solver-tracer");
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
});
