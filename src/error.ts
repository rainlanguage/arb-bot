/* eslint-disable @typescript-eslint/ban-ts-comment */
import { BigNumber } from "ethers";
import { isDeepStrictEqual } from "util";
import { RawTx, ViemClient } from "./types";
import { TakeOrderV2EventAbi } from "./abis";
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
    TransactionReceipt,
    decodeFunctionData,
    ExecutionRevertedError,
    InsufficientFundsError,
    TransactionNotFoundError,
    TransactionReceiptNotFoundError,
    WaitForTransactionReceiptTimeoutError,
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
 * Known errors
 */
export const KnownErrors = [
    "unknown sender",
    "minimumSenderOutput",
    "minimum sender output",
    "MinimalOutputBalanceViolation",
] as const;

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
export function errorSnapshot(
    header: string,
    err: any,
    data?: {
        receipt: TransactionReceipt;
        rawtx: RawTx;
        signerBalance: BigNumber;
        frontrun?: string;
    },
): string {
    const message = [header];
    if (err instanceof BaseError) {
        if (err.shortMessage) message.push("Reason: " + err.shortMessage);
        if (err.name) message.push("Error: " + err.name);
        if (err.details) message.push("Details: " + err.details);
        if (message.some((v) => v.includes("unknown reason") || v.includes("execution reverted"))) {
            const { raw, decoded } = parseRevertError(err);
            if (decoded) {
                message.push("Error Name: " + decoded.name);
                if (decoded.args.length) {
                    message.push("Error Args: " + JSON.stringify(decoded.args));
                }
            } else if (raw.data) {
                message.push("Error Raw Data: " + raw.data);
            } else if (data) {
                const gasErr = checkGasIssue(data.receipt, data.rawtx, data.signerBalance);
                if (gasErr) {
                    message.push("Gas Error: " + gasErr);
                }
            } else {
                message.push("Comment: Found no additional info");
            }
            if (data?.frontrun) {
                message.push("Actual Cause: " + data.frontrun);
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
        const parsed = parseRevertError(err);
        return (
            // err instanceof TransactionRejectedRpcError ||
            // err instanceof InvalidInputRpcError ||
            !!parsed.decoded ||
            !!parsed.raw.data ||
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
        return (
            err instanceof TimeoutError ||
            err instanceof TransactionNotFoundError ||
            err instanceof TransactionReceiptNotFoundError ||
            err instanceof WaitForTransactionReceiptTimeoutError ||
            ("cause" in err && isTimeout(err.cause as any))
        );
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
    receipt: TransactionReceipt,
    rawtx: RawTx,
    signerBalance: BigNumber,
    orderbook: `0x${string}`,
): Promise<{
    err: any;
    nodeError: boolean;
    snapshot: string;
    rawRevertError?: TxRevertError;
}> {
    const header = "transaction reverted onchain";
    try {
        const gasErr = checkGasIssue(receipt, rawtx, signerBalance);
        if (gasErr) {
            return {
                err: header + ", " + gasErr,
                nodeError: false,
                snapshot: header + ", " + gasErr,
            };
        }
        const tx = await viemClient.getTransaction({ hash });
        await viemClient.call({
            account: tx.from,
            to: tx.to,
            data: tx.input,
            gas: tx.gas,
            gasPrice: tx.gasPrice,
            blockNumber: tx.blockNumber,
        });
        const msg =
            header +
            " and simulation failed to find the revert reason, please try to simulate the tx manualy for more details";
        return { err: msg, nodeError: false, snapshot: msg };
    } catch (err: any) {
        let frontrun: string | undefined = await hasFrontrun(viemClient, rawtx, receipt, orderbook);
        if (frontrun) {
            frontrun = `current transaction with hash ${
                receipt.transactionHash
            } has been actually frontrun by transaction with hash ${frontrun}`;
        }
        return {
            err,
            nodeError: containsNodeError(err),
            snapshot: errorSnapshot(header, err, { receipt, rawtx, signerBalance, frontrun }),
            rawRevertError: parseRevertError(err),
        };
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

/**
 * Check if a mined transaction contains gas issue or not
 */
export function checkGasIssue(receipt: TransactionReceipt, rawtx: RawTx, signerBalance: BigNumber) {
    const txGasCost = receipt.effectiveGasPrice * receipt.gasUsed;
    if (signerBalance.lt(txGasCost)) {
        return "account ran out of gas for transaction gas cost";
    }
    if (typeof rawtx.gas === "bigint") {
        const percentage = (receipt.gasUsed * 100n) / rawtx.gas;
        if (percentage >= 98n) return "transaction ran out of specified gas";
    }
    return undefined;
}

/**
 * Checks if the given transaction has been frontrun by another transaction.
 * This is done by checking previouse transaction on the same block that emitted
 * the target event with the same TakeOrderConfigV3 struct.
 */
export async function hasFrontrun(
    viemClient: ViemClient,
    rawtx: RawTx,
    receipt: TransactionReceipt,
    orderbook: `0x${string}`,
) {
    try {
        const orderConfig = (() => {
            try {
                const result = decodeFunctionData({
                    abi: arbRp4Abi,
                    data: rawtx.data,
                }) as any;
                return result?.args?.[1]?.orders?.[0];
            } catch {
                return undefined;
            }
        })();
        if (orderConfig) {
            const txHash = receipt.transactionHash.toLowerCase();
            const logs = (
                await viemClient.getLogs({
                    event: TakeOrderV2EventAbi[0],
                    address: orderbook,
                    blockHash: receipt.blockHash,
                })
            ).filter(
                (v) =>
                    receipt.transactionIndex > v.transactionIndex &&
                    v.transactionHash.toLowerCase() !== txHash,
            );
            if (logs.length) {
                for (const log of logs) {
                    if (isDeepStrictEqual(log.args.config, orderConfig)) return log.transactionHash;
                }
            }
        }
    } catch {}
    return undefined;
}
