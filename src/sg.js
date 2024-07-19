/**
 * Checks a subgraph health status and records the result in an object or throws
 * error if all given subgraphs are unhealthy
 */
function checkSgStatus(validSgs, statusResult, span, hasjson) {
    const availableSgs = [];
    const reasons = {};
    for (let i = 0; i < statusResult.length; i++) {
        if (statusResult[i].status === "fulfilled") {
            const sgStatus = statusResult[i]?.value?.data?.data?._meta;
            if (sgStatus) {
                if (sgStatus.hasIndexingErrors) {
                    reasons[validSgs[i]] = "subgraph has indexing error";
                } else availableSgs.push(validSgs[i]);
            } else {
                reasons[validSgs[i]] = "did not receive valid status response";
            }
        } else {
            reasons[validSgs[i]] = statusResult[i].reason;
        }
    }
    if (Object.keys(reasons).length) span?.setAttribute("details.sgsStatusCheck", JSON.stringify(reasons));
    if (!hasjson && Object.keys(reasons).length === statusResult.length) {
        const urls = Object.keys(reasons);
        const msg = ["subgraphs status check failed"];
        if (urls.length === 1) {
            // indexing error or invalid fulfilled response
            if (typeof reasons[urls[0]] === "string") {
                msg.push("Reason: " + reasons[urls[0]]);
            } else {
                // AxsioError
                if (reasons[urls[0]].message) {
                    msg.push("Reason: " + reasons[urls[0]].message);
                }
                if (reasons[urls[0]].code) {
                    msg.push("Code: " + reasons[urls[0]].code);
                }
            }
        } else {
            for (const url in reasons) {
                msg.push(url + ":");
                // indexing error or invalid fulfilled response
                if (typeof reasons[url] === "string") {
                    msg.push("Reason: " + reasons[url]);
                } else {
                    // AxsioError
                    if (reasons[url].message) {
                        msg.push("Reason: " + reasons[url].message);
                    }
                    if (reasons[url].code) {
                        msg.push("Code: " + reasons[url].code);
                    }
                }
            }
        }
        throw msg.join("\n");
    }

    return { availableSgs, reasons };
}

/**
 * Handles the result of querying multiple subgraphs, by recording the errors
 * and resolved order details, if all given subgraphs error, it will throw an
 * error else, it will record errors in span attributes and returns the resolved
 * order details.
 */
function handleSgResults(availableSgs, responses, span, hasjson) {
    const reasons = {};
    const ordersDetails = [];
    for (let i = 0; i < responses.length; i++) {
        if (responses[i].status === "fulfilled" && responses[i]?.value?.data?.data?.orders) {
            ordersDetails.push(
                ...responses[i].value.data.data.orders
            );
        }
        else if (responses[i].status === "rejected") {
            reasons[availableSgs[i]] = responses[i].reason;
        }
    }
    if (Object.keys(reasons).length) span?.setAttribute("details.sgSourcesErrors", JSON.stringify(reasons));
    if (!hasjson && Object.keys(reasons).length === responses.length) throw "could not get order details from given sgs";
    return ordersDetails;
}

module.exports = {
    checkSgStatus,
    handleSgResults,
};