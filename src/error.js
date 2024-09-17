const { BaseError } = require("viem");

/**
 * Specifies error severity
 * @readonly
 * @enum {string}
 */
const ErrorSeverity = {
    LOW: "LOW",
    MEDIUM: "MEDIUM",
    HIGH: "HIGH",
};

/**
 * Get error with snapshot
 * @param {string} header
 * @param {any} err
 * @returns {string}
 */
function errorSnapshot(header, err) {
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

module.exports = {
    ErrorSeverity,
    errorSnapshot,
};