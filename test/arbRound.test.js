const { assert } = require("chai");
const { arbRound } = require("../cli");
const mockServer = require("mockttp").getLocal();
const { trace, context } = require("@opentelemetry/api");
const { Resource } = require("@opentelemetry/resources");
const { BasicTracerProvider } = require("@opentelemetry/sdk-trace-base");
const { SEMRESATTRS_SERVICE_NAME } = require("@opentelemetry/semantic-conventions");

describe("Test arb round", async function () {

    beforeEach(() => mockServer.start(8080));
    afterEach(() => mockServer.stop());

    it("return correct result for empty orders array", async function () {
        const provider = new BasicTracerProvider({
            resource: new Resource({
                [SEMRESATTRS_SERVICE_NAME]: "arb-bot-test"
            }),
        });
        const tracer = provider.getTracer("arb-bot-tracer");
        const testSpan = tracer.startSpan("test");
        const ctx = trace.setSpan(context.active(), testSpan);

        // Mock sg
        await mockServer.forPost("/sg-url").withBodyIncluding("_meta").thenReply(
            200,
            JSON.stringify({data: {_meta: {hasIndexingErrors: false}}})
        );
        await mockServer.forPost("/sg-url").withBodyIncluding("orders").thenReply(
            200,
            JSON.stringify({data: {orders: []}})
        );

        const options = {
            rpc: process?.env?.TEST_POLYGON_RPC,
            key: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
            orderbookAddress: "0x" + "0".repeat(40),
            arbAddress: "0x" + "0".repeat(40),
            maxRatio: true,
            subgraph: ["http://localhost:8080/sg-url"],
        };

        const response = await arbRound(tracer, ctx, options);
        const expected = { txs: [], foundOpp: false };
        assert.deepEqual(response, expected);

        testSpan.end();
    });
});