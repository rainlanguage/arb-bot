/* eslint-disable @typescript-eslint/ban-ts-comment */
import { ViemClient } from "./types";
// @ts-ignore
import { abi as obAbi } from "../test/abis/OrderBook.json";
// @ts-ignore
import { abi as rp4Abi } from "../test/abis/RouteProcessor4.json";
// @ts-ignore
import { abi as arbRp4Abi } from "../test/abis/RouteProcessorOrderBookV4ArbOrderTaker.json";
// @ts-ignore
import { abi as genericArbAbi } from "../test/abis/GenericPoolOrderBookV4ArbOrderTaker.json";
import {
    isHex,
    BaseError,
    TimeoutError,
    RpcRequestError,
    FeeCapTooLowError,
    decodeErrorResult,
    ExecutionRevertedError,
    InsufficientFundsError,
    // InvalidInputRpcError,
    // TransactionRejectedRpcError,
} from "viem";

/**
 * Specifies error severity
 */
export enum ErrorSeverity {
    LOW = "LOW",
    MEDIUM = "MEDIUM",
    HIGH = "HIGH",
}

/**
 * Specifies a decoded contract error
 */
export type DecodedError = {
    name: string;
    args: string[];
};

/**
 * Raw error returned from rpc call
 */
export type RawError = {
    code: number;
    message: string;
    data?: string;
};

/**
 * Represents a revert error that happened for a transaction
 */
export type TxRevertError = {
    raw: RawError;
    decoded?: DecodedError;
};

/**
 * Get error with snapshot
 */
export function errorSnapshot(header: string, err: any): string {
    const message = [header];
    if (err instanceof BaseError) {
        if (err.shortMessage) message.push("Reason: " + err.shortMessage);
        if (err.name) message.push("Error: " + err.name);
        if (err.details) {
            message.push("Details: " + err.details);
            if (message.some((v) => v.includes("unknown reason"))) {
                const { raw, decoded } = parseRevertError(err);
                if (decoded) {
                    message.push("Error Name: " + decoded.name);
                    if (decoded.args.length) {
                        message.push("Error Args: " + JSON.stringify(decoded.args));
                    }
                } else {
                    if (raw.data) message.push("Error Raw Data: " + raw.data);
                }
            }
        }
    } else if (err instanceof Error) {
        if ("reason" in err) message.push("Reason: " + err.reason);
        else message.push("Reason: " + err.message);
    } else if (typeof err === "string") {
        message.push("Reason: " + err);
    } else {
        try {
            message.push("Reason: " + err.toString());
        } catch {
            message.push("Reason: unknown error type");
        }
    }
    return message.join("\n");
}

/**
 * Checks if a viem BaseError is from eth node, copied from
 * "viem/_types/utils/errors/getNodeError" since not a default export
 */
export function containsNodeError(err: BaseError): boolean {
    try {
        const snapshot = errorSnapshot("", err);
        return (
            // err instanceof TransactionRejectedRpcError ||
            // err instanceof InvalidInputRpcError ||
            err instanceof FeeCapTooLowError ||
            err instanceof ExecutionRevertedError ||
            err instanceof InsufficientFundsError ||
            (err instanceof RpcRequestError && err.code === ExecutionRevertedError.code) ||
            (snapshot.includes("exceeds allowance") && !snapshot.includes("out of gas")) ||
            ("cause" in err && containsNodeError(err.cause as any))
        );
    } catch (error) {
        return false;
    }
}

/**
 * Checks if a viem BaseError is timeout error
 */
export function isTimeout(err: BaseError): boolean {
    try {
        return err instanceof TimeoutError || ("cause" in err && isTimeout(err.cause as any));
    } catch (error) {
        return false;
    }
}

/**
 * Handles a reverted transaction by simulating it and returning the revert error
 */
export async function handleRevert(
    viemClient: ViemClient,
    hash: `0x${string}`,
): Promise<{ err: any; nodeError: boolean } | undefined> {
    try {
        const tx = await viemClient.getTransaction({ hash });
        await viemClient.call({
            account: tx.from,
            to: tx.to,
            data: tx.input,
            gas: tx.gas,
            gasPrice: tx.gasPrice,
            blockNumber: tx.blockNumber,
        });
        return undefined;
    } catch (err) {
        if (err instanceof BaseError) {
            const { raw, decoded } = parseRevertError(err);
            if (decoded || raw.data) return { err, nodeError: true };
        }
        return { err, nodeError: false };
    }
}

/**
 * Parses a revert error to TxRevertError type
 */
export function parseRevertError(error: BaseError): TxRevertError {
    if ("cause" in error) {
        return parseRevertError(error.cause as any);
    } else {
        let decoded: DecodedError | undefined;
        const raw: RawError = {
            code: (error as any).code ?? NaN,
            message: error.message,
            data: (error as any).data ?? undefined,
        };
        if ("data" in error && isHex(error.data)) {
            decoded = tryDecodeError(error.data);
        }
        return { raw, decoded };
    }
}

/**
 * Tries to decode an error data with known contract error selectors
 */
export function tryDecodeError(data: `0x${string}`): DecodedError | undefined {
    const handleArgs = (args: readonly unknown[]): string[] => {
        return (
            args?.map((arg) => {
                if (typeof arg === "string") {
                    return arg;
                } else {
                    try {
                        return arg!.toString();
                    } catch (error) {
                        return "";
                    }
                }
            }) ?? []
        );
    };
    try {
        const result = decodeErrorResult({ data, abi: rp4Abi });
        return {
            name: result.errorName,
            args: handleArgs(result.args ?? []),
        };
    } catch {
        try {
            const result = decodeErrorResult({ data, abi: obAbi });
            return {
                name: result.errorName,
                args: handleArgs(result.args ?? []),
            };
        } catch {
            try {
                const result = decodeErrorResult({ data, abi: arbRp4Abi });
                return {
                    name: result.errorName,
                    args: handleArgs(result.args ?? []),
                };
            } catch {
                try {
                    const result = decodeErrorResult({ data, abi: genericArbAbi });
                    return {
                        name: result.errorName,
                        args: handleArgs(result.args ?? []),
                    };
                } catch {
                    return undefined;
                }
            }
        }
    }
}
