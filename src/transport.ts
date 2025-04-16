import { RpcState } from "./rpc";
import { shouldThrow } from "./error";
import { BaseError, createTransport, Transport, TransportConfig } from "viem";

/** Rain solver transport configurations */
export type RainSolverTransportConfig = {
    /** The key of the transport */
    key?: TransportConfig["key"];
    /** The name of the transport */
    name?: TransportConfig["name"];
    /** The request timeout in milliseconds, default: 10_000ms */
    timeout?: TransportConfig["timeout"];
    /** The max number of times to retry, default: 1 */
    retryCount?: TransportConfig["retryCount"];
    /** The base delay (in ms) between retries, defaukt: 150ms */
    retryDelay?: TransportConfig["retryDelay"];
    /** The polling timeout in milliseconds when no rpc becomes available, default: 10_000ms */
    pollingTimeout?: number;
    /** The polling interval (in ms) to check for next available rpc, default: 250ms */
    pollingInterval?: number;
};

/**
 * Type of Rainsolver timeout error in viem error type format
 */
export type TimeoutErrorType = RainSolverTransportTimeoutError & {
    name: "RainSolverTransportTimeoutError";
};

/**
 * Viem based timeout error format for RainSolver transport
 */
export class RainSolverTransportTimeoutError extends BaseError {
    constructor(timeout: number) {
        super("Timed out while waiting for next available rpc.", {
            details: "No RPC available for the moment",
            metaMessages: [`timed out in: ${timeout} ms`],
            name: "RainSolverTransportTimeoutError",
        });
    }
}

/** Type of rain solver viem transport */
export type RainSolverTransport = Transport<"RainSolverTransport">;

/**
 * RainSolver viem Transport that can be used for any viem client, it operates on
 * the given `RpcState` with as many number of desired urls, incoming requests are
 * passed to any transport that `RpcState.nextRpc` provides at the time, so the
 * `RpcState.nextRpc` inner logic dictates which rpc is used for any incoming requests.
 * @param state - The rpc state
 * @param config - Configurations
 */
export function rainSolverTransport(
    state: RpcState,
    config: RainSolverTransportConfig = {},
): RainSolverTransport {
    const {
        retryDelay,
        retryCount = 1,
        timeout = 10_000,
        pollingInterval = 250,
        pollingTimeout = 10_000,
        key = "RainSolverTransport",
        name = "Rain Solver Transport",
    } = config;
    return (({
        chain,
        timeout: timeout_,
        retryCount: retryCount_,
        pollingInterval: pollingInterval_,
    }) => {
        return createTransport({
            key,
            name,
            retryDelay,
            timeout: timeout_ ?? timeout,
            retryCount: retryCount_ ?? retryCount,
            type: "RainSolverTransport",
            async request(args) {
                const req = async (tryNext = true): Promise<any> => {
                    try {
                        const transport = await state.nextRpc({
                            timeout: pollingTimeout,
                            pollingInterval: pollingInterval_ ?? pollingInterval,
                        });
                        return await transport({ chain, retryCount: 0 }).request(args);
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
