import {
    BaseError,
    RpcRequestError,
    InvalidInputRpcError,
    ExecutionRevertedError,
    TransactionRejectedRpcError,
    TipAboveFeeCapError,
    TransactionTypeNotSupportedError,
    IntrinsicGasTooLowError,
    IntrinsicGasTooHighError,
    InsufficientFundsError,
    NonceMaxValueError,
    NonceTooLowError,
    NonceTooHighError,
    FeeCapTooLowError,
    FeeCapTooHighError,
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
 * Get error with snapshot
 */
export function errorSnapshot(header: string, err: any): string {
    const message = [header];
    if (err instanceof BaseError) {
        if (err.shortMessage) message.push("Reason: " + err.shortMessage);
        if (err.name) message.push("Error: " + err.name);
        if (err.details) message.push("Details: " + err.details);
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
    return (
        err instanceof TransactionRejectedRpcError ||
        err instanceof InvalidInputRpcError ||
        err instanceof ExecutionRevertedError ||
        err instanceof FeeCapTooHighError ||
        err instanceof FeeCapTooLowError ||
        err instanceof NonceTooHighError ||
        err instanceof NonceTooLowError ||
        err instanceof NonceMaxValueError ||
        err instanceof InsufficientFundsError ||
        err instanceof IntrinsicGasTooHighError ||
        err instanceof IntrinsicGasTooLowError ||
        err instanceof TransactionTypeNotSupportedError ||
        err instanceof TipAboveFeeCapError ||
        (err instanceof RpcRequestError && err.code === ExecutionRevertedError.code) ||
        ("cause" in err && containsNodeError(err.cause as any))
        // ("code" in err && err.code === ExecutionRevertedError.code)
    );
}
