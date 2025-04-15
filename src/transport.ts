import { RpcState } from "./rpc";
import { shouldThrow } from "./error";
import { createTransport, Transport, TransportConfig } from "viem";

/** Rain solver transport configurations */
export type RainSolverTransportConfig = {
    /** The key of the transport */
    key?: TransportConfig["key"];
    /** The name of the transport */
    name?: TransportConfig["name"];
    /** The timeout in milliseconds */
    timeout?: TransportConfig["timeout"];
    /** The max number of times to retry */
    retryCount?: TransportConfig["retryCount"];
    /** The base delay (in ms) between retries */
    retryDelay?: TransportConfig["retryDelay"];
};

/** Type of rain solver viem transport */
export type RainSolverTransport = Transport<"RainSolverTransport">;

/**
 * RainSolver viem Transport that can be used for any viem client,
 * the `rpcState.nextRpc` dictates which rpc is used for any incoming requests.
 * @param state - The rpc state
 * @param config - Configurations
 */
export function rainSolverTransport(
    state: RpcState,
    config: RainSolverTransportConfig = {},
): RainSolverTransport {
    const {
        timeout,
        retryDelay,
        retryCount = 1,
        key = "RainSolverTransport",
        name = "Rain Solver Transport",
    } = config;
    return (({ chain }) => {
        return createTransport({
            key,
            name,
            timeout,
            retryDelay,
            retryCount,
            type: "RainSolverTransport",
            async request(args) {
                const req = async (tryNext = true): Promise<any> => {
                    try {
                        return await state.nextRpc({ chain, retryCount: 0 }).request(args);
                    } catch (error: any) {
                        if (shouldThrow(error)) throw error;
                        if (tryNext) return await req(false);
                        throw error;
                    }
                };
                return req();
            },
        });
    }) as RainSolverTransport;
}
