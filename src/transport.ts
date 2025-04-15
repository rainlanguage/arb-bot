import { RpcState } from "./rpc";
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
 * @param rpcState - The rpc state
 * @param config - Configurations
 */
export function rainSolverTransport(
    rpcState: RpcState,
    config: RainSolverTransportConfig = {},
): RainSolverTransport {
    const {
        key = "RainSolverTransport",
        name = "Rain Solver Transport",
        retryCount = 1,
        retryDelay,
        timeout,
    } = config;
    return (({ chain }) => {
        return createTransport({
            key,
            name,
            retryCount,
            retryDelay,
            timeout,
            type: "RainSolverTransport",
            async request({ method, params }) {
                return rpcState.nextRpc({ chain }).request({
                    method,
                    params,
                }) as any;
            },
        });
    }) as RainSolverTransport;
}
