import axios from "axios";
import { ErrorSeverity } from "./error";
import { Span } from "@opentelemetry/api";
import { orderbooksQuery } from "./query";

/**
 * Checks a subgraph health status and records the result in an object or throws
 * error if all given subgraphs are unhealthy
 */
export function checkSgStatus(
    validSgs: string[],
    statusResult: PromiseSettledResult<any>[],
    span?: Span,
    hasjson = false,
): { availableSgs: string[]; reasons: Record<string, string> } {
    const availableSgs: string[] = [];
    const reasons: Record<string, any> = {};
    let highSeverity = false;
    for (let i = 0; i < statusResult.length; i++) {
        const res = statusResult[i];
        if (res.status === "fulfilled") {
            const sgStatus = res?.value?.data?.data?._meta;
            if (sgStatus) {
                if (sgStatus.hasIndexingErrors) {
                    highSeverity = true;
                    reasons[validSgs[i]] = "subgraph has indexing error";
                } else availableSgs.push(validSgs[i]);
            } else {
                reasons[validSgs[i]] = "did not receive valid status response";
            }
        } else {
            reasons[validSgs[i]] = res.reason;
        }
    }
    if (Object.keys(reasons).length) {
        if (highSeverity) span?.setAttribute("severity", ErrorSeverity.HIGH);
        else span?.setAttribute("severity", ErrorSeverity.LOW);
        span?.setAttribute("details.sgsStatusCheck", JSON.stringify(reasons));
    }
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
export function handleSgResults(
    availableSgs: string[],
    responses: PromiseSettledResult<any>[],
    span?: Span,
    hasjson = false,
): any[] {
    const reasons: Record<string, any> = {};
    const ordersDetails: any[] = [];
    for (let i = 0; i < responses.length; i++) {
        const res = responses[i];
        if (res.status === "fulfilled" && res?.value?.data?.data?.orders) {
            ordersDetails.push(...res.value.data.data.orders);
        } else if (res.status === "rejected") {
            reasons[availableSgs[i]] = res.reason;
        }
    }
    if (Object.keys(reasons).length) {
        span?.setAttribute("severity", ErrorSeverity.LOW);
        span?.setAttribute("details.sgSourcesErrors", JSON.stringify(reasons));
    }
    if (!hasjson && Object.keys(reasons).length === responses.length)
        throw "could not get order details from given sgs";
    return ordersDetails;
}

/**
 * Returns the orderbook addresses the given subgraph indexes
 */
export async function getSgOrderbooks(url: string): Promise<string[]> {
    try {
        const result = await axios.post(
            url,
            { query: orderbooksQuery },
            { headers: { "Content-Type": "application/json" } },
        );
        if (result?.data?.data?.orderbooks) {
            return result.data.data.orderbooks.map((v: any) => v.id);
        } else {
            return Promise.reject("Failed to get orderbook addresses");
        }
    } catch (error) {
        const msg = ["Failed to get orderbook addresses"];
        if (typeof error === "string") {
            msg.push("Reason: " + error);
        } else {
            // AxsioError
            if ((error as any).message) {
                msg.push("Reason: " + (error as any).message);
            }
            if ((error as any).code) {
                msg.push("Code: " + (error as any).code);
            }
        }
        throw msg.join("\n");
    }
}
