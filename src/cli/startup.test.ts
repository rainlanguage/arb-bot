import { sleep } from "../utils";
import { startup } from "./startup";
import { getOrderDetails } from "..";
import { unlinkSync, writeFileSync } from "node:fs";
import { describe, it, expect, vi, assert, Mock } from "vitest";

vi.mock("viem", async (importOriginal) => {
    return {
        ...(await importOriginal()),
        createPublicClient: vi.fn().mockReturnValue({
            getChainId: vi.fn().mockResolvedValue(137),
        }),
    };
});

vi.mock("..", async (importOriginal) => {
    return {
        ...(await importOriginal()),
        getOrderDetails: vi.fn().mockResolvedValue([]),
    };
});

vi.mock("../account", () => ({
    initAccounts: vi.fn().mockResolvedValue({
        mainAccount: {},
        accounts: [],
    }),
}));

vi.mock("../config", async (importOriginal) => {
    return {
        ...(await importOriginal()),
        getDataFetcher: vi.fn(),
        createViemClient: vi.fn().mockResolvedValue({
            getGasPrice: vi.fn().mockResolvedValue(1234n),
            readContract: vi
                .fn()
                .mockResolvedValueOnce("0xC1A14cE2fd58A3A2f99deCb8eDd866204eE07f8D")
                .mockResolvedValueOnce("0xFA4989F5D49197FD9673cE4B7Fe2A045A0F2f9c8"),
        }),
    };
});

describe("Test startup", async function () {
    const deployer = "0xE7116BC05C8afe25e5B54b813A74F916B5D42aB1";
    const yaml = `
key: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
rpc:
    - url: https://example-rpc.com
writeRpc:
    - url: http://write-rpc.example.com
subgraph: ["http://subgraph.example.com"]
arbAddress: "0x${"1".repeat(40)}"
dispair: "${deployer}"
liquidityProviders: 
    - lp1
    - lp2
txGas: 123456789
quoteGas: 7777
botMinBalance: 0.123
gasPriceMultiplier: 120
gasLimitMultiplier: 110
timeout: 20000
hops: 2
retries: 3
maxRatio: true
rpOnly: true
publicRpc: true
sgFilter:
    includeOrders:
        - "0x${"1".repeat(64)}"
        - "0x${"2".repeat(64)}"
    excludeOrders:
        - "0x${"3".repeat(64)}"
        - "0x${"4".repeat(64)}"
    includeOwners:
        - "0x${"1".repeat(40)}"
        - "0x${"2".repeat(40)}"
    excludeOwners:
        - "0x${"3".repeat(40)}"
        - "0x${"4".repeat(40)}"
    includeOrderbooks:
        - "0x${"5".repeat(40)}"
        - "0x${"6".repeat(40)}"
    excludeOrderbooks:
        - "0x${"7".repeat(40)}"
        - "0x${"8".repeat(40)}"
`;
    it("happy", async function () {
        const path = "./second.test.yaml";
        writeFileSync(path, yaml, "utf8");

        const result = await startup(["", "", "--config", path]);
        const expected = {
            roundGap: 10000,
            poolUpdateInterval: 0,
            config: {
                chain: { id: 137 },
                rpc: [{ url: "https://example-rpc.com" }],
                arbAddress: `0x${"1".repeat(40)}`,
                route: "single",
                gasPriceMultiplier: 120,
                gasLimitMultiplier: 110,
                txGas: "123456789",
                quoteGas: 7777n,
                rpOnly: true,
                dispair: {
                    interpreter: "0xC1A14cE2fd58A3A2f99deCb8eDd866204eE07f8D",
                    store: "0xFA4989F5D49197FD9673cE4B7Fe2A045A0F2f9c8",
                    deployer: deployer.toLowerCase(),
                },
            },
            options: {
                botMinBalance: "0.123",
                gasPriceMultiplier: 120,
                gasLimitMultiplier: 110,
                txGas: "123456789",
                quoteGas: 7777n,
                rpOnly: true,
                dispair: deployer.toLowerCase(),
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

        // rm test yaml file
        unlinkSync(path);

        await sleep(1000);
        assert.equal(result.config.chain.id, expected.config.chain.id);
        assert.deepEqual(result.config.rpc[0], expected.config.rpc[0]);
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
        for (const url in result.state.rpc.metrics) {
            assert.ok(result.state.rpc.metrics[url].req == 0);
            assert.ok(result.state.rpc.metrics[url].success == 0);
            assert.ok(result.state.rpc.metrics[url].failure == 0);
            assert.deepEqual(result.state.rpc.metrics[url].cache, {});
            assert.equal(result.state.rpc.metrics[url].lastRequestTimestamp, 0);
            assert.isEmpty(result.state.rpc.metrics[url].requestIntervals);
        }
        assert.deepEqual(result.options.sgFilter, expected.options.sgFilter);
    });

    it("unhappy", async function () {
        // fail at read deafult config file
        await expect(startup(["", ""])).rejects.toThrow(
            "ENOENT: no such file or directory, open './config.yaml'",
        );

        // fail at read config file
        await expect(startup(["", "", "-c", "./some-other-path.yaml"])).rejects.toThrow(
            "ENOENT: no such file or directory, open './some-other-path.yaml'",
        );

        // reject at fetching init orders from sg
        (getOrderDetails as Mock).mockRejectedValue("failed to get orders from subgraph");

        // setup test file
        const path = "./third.test.yaml";
        writeFileSync(path, yaml, "utf8");

        await expect(startup(["", "", "-c", "./third.test.yaml"])).rejects.toThrow(
            "failed to get orders from subgraph",
        );

        // rm test yaml file
        unlinkSync(path);
    });
});
