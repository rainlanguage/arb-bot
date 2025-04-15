import { assert } from "chai";
import { polygon } from "viem/chains";
import { RpcConfig, RpcState } from "../src/rpc";
import { rainSolverTransport, RainSolverTransportConfig } from "../src/transport";

describe("Test transport", async function () {
    it("should get RainSolver transport", async function () {
        const rpcConfigs: RpcConfig[] = [
            {
                url: "https://example1.com/",
            },
            {
                url: "https://example2.com/",
            },
        ];
        const rpcState = new RpcState(rpcConfigs);
        const config: RainSolverTransportConfig = {
            key: "some-key",
            name: "some-name",
            retryCount: 4,
            retryDelay: 2_000,
            timeout: 30_000,
        };
        const result = rainSolverTransport(rpcState, config)({ chain: polygon });

        assert.equal(result.config.key, "some-key");
        assert.equal(result.config.name, "some-name");
        assert.equal(result.config.retryCount, 4);
        assert.equal(result.config.retryDelay, 2_000);
        assert.equal(result.config.timeout, 30_000);
        assert.equal(result.config.type, "RainSolverTransport");
    });
});
