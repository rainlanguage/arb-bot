import { assert } from "chai";
import { randomInt } from "crypto";
import { getLocal } from "mockttp";
import { polygon } from "viem/chains";
import { normalizeUrl, RpcConfig, RpcState } from "../src/rpc";
import { rainSolverTransport, RainSolverTransportConfig } from "../src/transport";

describe("Test transport", async function () {
    it("should get RainSolver transport", async function () {
        // setup 2 rpc mock servers
        const mockServer1 = getLocal();
        const mockServer2 = getLocal();
        await mockServer1.start(9292);
        await mockServer2.start(9393);

        const rpcConfigs: RpcConfig[] = [
            {
                url: mockServer1.url,
            },
            {
                url: mockServer2.url,
            },
        ];
        const state = new RpcState(rpcConfigs);
        const config: RainSolverTransportConfig = {
            key: "some-key",
            name: "some-name",
            retryCount: 0,
            retryDelay: 2_000,
            timeout: 30_000,
        };
        const transport = rainSolverTransport(state, config)({ chain: polygon });

        // should have correct config
        assert.equal(transport.config.key, "some-key");
        assert.equal(transport.config.name, "some-name");
        assert.equal(transport.config.retryCount, 0);
        assert.equal(transport.config.retryDelay, 2_000);
        assert.equal(transport.config.timeout, 30_000);
        assert.equal(transport.config.type, "RainSolverTransport");

        // call 1000 times with random responses
        for (let i = 0; i < 1000; i++) {
            // randomly revert or resolve the call
            const rand = randomInt(1, 3);
            if (rand === 1) {
                await mockServer1
                    .forPost()
                    .once()
                    .withBodyIncluding("eth_blockNumber")
                    .thenReply(200, JSON.stringify({ jsonrpc: "2.0", id: i, result: 1234 }));
                await mockServer2
                    .forPost()
                    .once()
                    .withBodyIncluding("eth_blockNumber")
                    .thenReply(200, JSON.stringify({ jsonrpc: "2.0", id: i, result: 1234 }));
            } else {
                await mockServer1
                    .forPost()
                    .once()
                    .withBodyIncluding("eth_blockNumber")
                    .thenSendJsonRpcError({
                        jsonrpc: "2.0",
                        id: i,
                        error: { code: -32000, message: "ratelimit exceeded" },
                    });
                await mockServer2
                    .forPost()
                    .once()
                    .withBodyIncluding("eth_blockNumber")
                    .thenSendJsonRpcError({
                        jsonrpc: "2.0",
                        id: i,
                        error: { code: -32000, message: "ratelimit exceeded" },
                    });
            }
            try {
                const result1 = await transport.request({ method: "eth_blockNumber" });
                assert.equal(result1, 1234);
            } catch (error) {
                assert.equal(error.cause.error.code, -32000);
            }
        }

        // both rpcs should have beeen used equally close to each other and close success rate
        assert.closeTo(
            state.metrics[normalizeUrl(mockServer1.url)].success,
            state.metrics[normalizeUrl(mockServer2.url)].success,
            25, // 25 times as delta
        );
        assert.closeTo(
            state.metrics[normalizeUrl(mockServer1.url)].failure,
            state.metrics[normalizeUrl(mockServer2.url)].failure,
            25, // 25 times as delta
        );
        assert.closeTo(
            state.metrics[normalizeUrl(mockServer1.url)].progress.successRate,
            state.metrics[normalizeUrl(mockServer2.url)].progress.successRate,
            5, // 5% delta
        );

        await mockServer1.stop();
        await mockServer2.stop();
    });
});
