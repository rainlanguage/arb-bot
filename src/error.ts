/* eslint-disable @typescript-eslint/ban-ts-comment */
import { BigNumber } from "ethers";
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
    isAddress,
    RpcRequestError,
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

export type DecodedError = {
    name: string;
    args: string[];
};

export type RawError = {
    code: number;
    message: string;
    data?: string;
};

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
            if (
                err.name.includes("unknown reason") ||
                err.details.includes("unknown reason") ||
                err.shortMessage.includes("unknown reason")
            ) {
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
        return (
            // err instanceof TransactionRejectedRpcError ||
            // err instanceof InvalidInputRpcError ||
            err instanceof ExecutionRevertedError ||
            err instanceof InsufficientFundsError ||
            (err instanceof RpcRequestError && err.code === ExecutionRevertedError.code) ||
            ("cause" in err && containsNodeError(err.cause as any))
        );
    } catch (error) {
        return false;
    }
}

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

export function tryDecodeError(data: `0x${string}`): DecodedError | undefined {
    const handleArgs = (args: readonly unknown[]): string[] => {
        return (
            args?.map((arg) => {
                if (typeof arg === "string") {
                    return arg;
                }
                if (typeof arg === "bigint") {
                    const str = BigNumber.from(arg).toHexString();
                    if (isAddress(str)) {
                        return str;
                    } else {
                        return arg.toString();
                    }
                }
                if (typeof arg === "number") {
                    return arg.toString();
                }
                try {
                    return arg!.toString();
                } catch (error) {
                    return "";
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
