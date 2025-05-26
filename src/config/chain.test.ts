import { ChainId } from "sushi/chain";
import { WNATIVE } from "sushi/currency";
import { describe, it, expect } from "vitest";
import { getChainConfig, SpecialL2Chains } from "./chain";
import {
    STABLES,
    publicClientConfig,
    ROUTE_PROCESSOR_3_ADDRESS,
    ROUTE_PROCESSOR_4_ADDRESS,
    ROUTE_PROCESSOR_3_1_ADDRESS,
    ROUTE_PROCESSOR_3_2_ADDRESS,
} from "sushi/config";

describe("Test getChainConfig", () => {
    it("should return correct config for a supported chain", () => {
        const chainId = ChainId.ETHEREUM;
        const config = getChainConfig(chainId);

        expect(config.chain).toEqual(publicClientConfig[chainId].chain);
        expect(config.nativeWrappedToken).toEqual(WNATIVE[chainId]);
        expect(config.routeProcessors["3"]).toBe(ROUTE_PROCESSOR_3_ADDRESS[chainId]);
        expect(config.routeProcessors["3.1"]).toBe(ROUTE_PROCESSOR_3_1_ADDRESS[chainId]);
        expect(config.routeProcessors["3.2"]).toBe(ROUTE_PROCESSOR_3_2_ADDRESS[chainId]);
        expect(config.routeProcessors["4"]).toBe(ROUTE_PROCESSOR_4_ADDRESS[chainId]);
        expect(config.stableTokens).toEqual(STABLES[chainId]);
        expect(config.isSpecialL2).toBe(SpecialL2Chains.is(config.chain.id));
    });

    it("should throw if chain is not supported", () => {
        const invalidChainId = 999999 as ChainId;
        expect(() => getChainConfig(invalidChainId)).toThrow("network not supported");
    });

    it("should throw if native wrapped token is not supported", () => {
        const fakeChainId = 123456 as ChainId;
        (publicClientConfig as any)[fakeChainId] = { chain: { id: fakeChainId } };
        (WNATIVE as any)[fakeChainId] = undefined;

        expect(() => getChainConfig(fakeChainId)).toThrow("network not supported");

        delete (publicClientConfig as any)[fakeChainId];
    });

    it("should only include route processors that exist for the chain", () => {
        const chainId = ChainId.FLARE;
        const config = getChainConfig(chainId);
        expect(config.routeProcessors["3.1"]).toBeUndefined();
    });

    it("should correctly identify special L2 chains", () => {
        expect(SpecialL2Chains.is(SpecialL2Chains.BASE)).toBe(true);
        expect(SpecialL2Chains.is(SpecialL2Chains.OPTIMISM)).toBe(true);
        expect(SpecialL2Chains.is(ChainId.ETHEREUM)).toBe(false);
    });
});
