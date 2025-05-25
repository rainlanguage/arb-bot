import { WNATIVE } from "sushi/currency";
import { ChainId } from "sushi/chain";
import { Token } from "sushi/currency";
import {
    STABLES,
    publicClientConfig,
    ROUTE_PROCESSOR_3_ADDRESS,
    ROUTE_PROCESSOR_4_ADDRESS,
    ROUTE_PROCESSOR_3_1_ADDRESS,
    ROUTE_PROCESSOR_3_2_ADDRESS,
} from "sushi/config";
import { Chain } from "viem";

export type ChainConfig = {
    chain: Chain;
    nativeWrappedToken: Token;
    routeProcessors: { [key: string]: `0x${string}` };
    stableTokens?: Token[];
    isSpecialL2: boolean;
};

/**
 * Get the chain config for a given chain id
 * @param chainId - The chain id
 */
export function getChainConfig(chainId: ChainId): ChainConfig {
    // get chain config
    const chain = publicClientConfig[chainId].chain;
    if (!chain) throw new Error("network not supported");

    // get native wrapped token details
    const nativeWrappedToken = WNATIVE[chainId];
    if (!nativeWrappedToken) throw new Error("network not supported");

    // get route processor addresses
    const routeProcessors: Record<string, `0x${string}`> = {};
    [
        ["3", ROUTE_PROCESSOR_3_ADDRESS],
        ["3.1", ROUTE_PROCESSOR_3_1_ADDRESS],
        ["3.2", ROUTE_PROCESSOR_3_2_ADDRESS],
        ["4", ROUTE_PROCESSOR_4_ADDRESS],
    ].forEach(([key, addresses]: any[]) => {
        const address = addresses[chainId];
        if (address) {
            routeProcessors[key] = address;
        }
    });

    // get known stable coins of the chain
    const stableTokens = (STABLES as any)[chainId];

    return {
        chain,
        nativeWrappedToken,
        routeProcessors,
        stableTokens,
        isSpecialL2: SpecialL2Chains.is(chain.id),
    };
}

/**
 * List of L2 chains that require SEPARATE L1 gas actions.
 * other L2 chains that dont require separate L1 gas actions
 * such as Arbitrum and Polygon zkEvm are excluded, these chains'
 * gas actions are performed the same as usual L1 chains.
 */
export enum SpecialL2Chains {
    BASE = ChainId.BASE,
    OPTIMISM = ChainId.OPTIMISM,
}
export namespace SpecialL2Chains {
    export function is(chainId: number): boolean {
        return Object.values(SpecialL2Chains).includes(chainId as any);
    }
}
