import { AppOptions } from "./yaml";
import { RainSolverConfig } from "./index";
import { LiquidityProviders } from "sushi";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("viem", async (importOriginal) => {
    return {
        ...(await importOriginal()),
        createPublicClient: vi.fn().mockReturnValue({
            getChainId: vi
                .fn()
                .mockResolvedValueOnce(137)
                .mockRejectedValueOnce("no chain id")
                .mockResolvedValue(137),
            readContract: vi
                .fn()
                .mockResolvedValueOnce("0xinterpreter")
                .mockResolvedValueOnce("0xstore")
                .mockRejectedValueOnce("no data")
                .mockResolvedValueOnce("0xinterpreter")
                .mockRejectedValueOnce("no data"),
        }),
    };
});

describe("Test RainSolverConfig", () => {
    let options: AppOptions;

    beforeEach(() => {
        options = {
            rpc: [{ url: "http://example.com" }],
            dispair: "0xdispair",
            key: "key",
            hops: 2,
            retries: 3,
            timeout: 1000,
            writeRpc: undefined,
            maxRatio: true,
            arbAddress: "0xarb",
            genericArbAddress: "0xgen",
            liquidityProviders: ["UniswapV2"],
            selfFundOrders: true,
            route: "route",
            gasPriceMultiplier: 1.1,
            gasLimitMultiplier: 1.2,
            txGas: 100000,
            quoteGas: 50000,
            rpOnly: false,
        } as any;
    });

    it("should successfully return RainSolverConfig", async () => {
        const config = await RainSolverConfig.tryFromAppOptions(options);

        expect(config.chain.id).toBe(137);
        expect(config.lps).toEqual([LiquidityProviders.UniswapV2]);
        expect(config.dispair).toEqual({
            interpreter: "0xinterpreter",
            store: "0xstore",
            deployer: "0xdispair",
        });
        expect(config.walletKey).toBe("key");
        expect(config.watchedTokens).toEqual([]);
    });

    it("should throw if getChainConfig returns undefined", async () => {
        await expect(RainSolverConfig.tryFromAppOptions(options)).rejects.toMatch("no chain id");
    });

    it("should throw if iInterpreter contract call fails", async () => {
        await expect(RainSolverConfig.tryFromAppOptions(options)).rejects.toMatch(
            /failed to get dispair interpreter address/,
        );
    });

    it("should throw if iStore contract call fails", async () => {
        await expect(RainSolverConfig.tryFromAppOptions(options)).rejects.toMatch(
            /failed to get dispair store address/,
        );
    });
});
