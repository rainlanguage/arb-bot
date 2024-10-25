import axios from "axios";
import { ErrorSeverity } from "./error";
import { Span } from "@opentelemetry/api";
import { orderbooksQuery, SgOrder } from "./query";
import { getTokenSymbol } from "./utils";
import {
    Order,
    OrderbooksOwnersProfileMap,
    OrdersProfileMap,
    OwnersProfileMap,
    Pair,
    TokenDetails,
    ViemClient,
} from "./types";
import { OrderV3 } from "./abis";
import { decodeAbiParameters, parseAbiParameters } from "viem";
import { toOrder } from "./watcher";

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
        if (res.status === "fulfilled" && res?.value) {
            ordersDetails.push(...res.value);
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

export async function getPairs(
    orderStruct: Order,
    viemClient: ViemClient,
    tokens: TokenDetails[],
    orderDetails?: SgOrder,
): Promise<Pair[]> {
    const pairs: Pair[] = [];
    for (let j = 0; j < orderStruct.validOutputs.length; j++) {
        const _output = orderStruct.validOutputs[j];
        let _outputSymbol = orderDetails?.outputs?.find(
            (v) => v.token.address.toLowerCase() === _output.token.toLowerCase(),
        )?.token?.symbol;
        if (!_outputSymbol) {
            const symbol = tokens.find(
                (v) => v.address.toLowerCase() === _output.token.toLowerCase(),
            )?.symbol;
            if (!symbol) {
                _outputSymbol = await getTokenSymbol(_output.token, viemClient);
            } else {
                _outputSymbol = symbol;
            }
        } else {
            if (!tokens.find((v) => v.address.toLowerCase() === _output.token.toLowerCase())) {
                tokens.push({
                    address: _output.token.toLowerCase(),
                    symbol: _outputSymbol,
                    decimals: _output.decimals,
                });
            }
        }

        for (let k = 0; k < orderStruct.validInputs.length; k++) {
            const _input = orderStruct.validInputs[k];
            let _inputSymbol = orderDetails?.inputs?.find(
                (v) => v.token.address.toLowerCase() === _input.token.toLowerCase(),
            )?.token?.symbol;
            if (!_inputSymbol) {
                const symbol = tokens.find(
                    (v) => v.address.toLowerCase() === _input.token.toLowerCase(),
                )?.symbol;
                if (!symbol) {
                    _inputSymbol = await getTokenSymbol(_input.token, viemClient);
                } else {
                    _inputSymbol = symbol;
                }
            } else {
                if (!tokens.find((v) => v.address.toLowerCase() === _input.token.toLowerCase())) {
                    tokens.push({
                        address: _input.token.toLowerCase(),
                        symbol: _inputSymbol,
                        decimals: _input.decimals,
                    });
                }
            }

            if (_input.token.toLowerCase() !== _output.token.toLowerCase())
                pairs.push({
                    buyToken: _input.token.toLowerCase(),
                    buyTokenSymbol: _inputSymbol,
                    buyTokenDecimals: _input.decimals,
                    sellToken: _output.token.toLowerCase(),
                    sellTokenSymbol: _outputSymbol,
                    sellTokenDecimals: _output.decimals,
                    takeOrder: {
                        order: orderStruct,
                        inputIOIndex: k,
                        outputIOIndex: j,
                        signedContext: [],
                    },
                });
        }
    }
    return pairs;
}
/**
 * Get a map of per owner orders per orderbook
 * @param ordersDetails - Order details queried from subgraph
 */
export async function getOrderbookOwnersProfileMapFromSg(
    ordersDetails: SgOrder[],
    viemClient: ViemClient,
    tokens: TokenDetails[],
    ownerLimits?: Record<string, number>,
): Promise<OrderbooksOwnersProfileMap> {
    const orderbookOwnersProfileMap: OrderbooksOwnersProfileMap = new Map();
    for (let i = 0; i < ordersDetails.length; i++) {
        const orderDetails = ordersDetails[i];
        const orderbook = orderDetails.orderbook.id.toLowerCase();
        const orderStruct = toOrder(
            decodeAbiParameters(
                parseAbiParameters(OrderV3),
                orderDetails.orderBytes as `0x${string}`,
            )[0],
        );
        const orderbookOwnerProfileItem = orderbookOwnersProfileMap.get(orderbook);
        if (orderbookOwnerProfileItem) {
            const ownerProfile = orderbookOwnerProfileItem.get(orderStruct.owner.toLowerCase());
            if (ownerProfile) {
                if (!ownerProfile.orders.has(orderDetails.orderHash.toLowerCase())) {
                    ownerProfile.orders.set(orderDetails.orderHash.toLowerCase(), {
                        active: true,
                        order: orderStruct,
                        takeOrders: await getPairs(orderStruct, viemClient, tokens, orderDetails),
                        consumedTakeOrders: [],
                    });
                }
            } else {
                const ordersProfileMap: OrdersProfileMap = new Map();
                ordersProfileMap.set(orderDetails.orderHash.toLowerCase(), {
                    active: true,
                    order: orderStruct,
                    takeOrders: await getPairs(orderStruct, viemClient, tokens, orderDetails),
                    consumedTakeOrders: [],
                });
                orderbookOwnerProfileItem.set(orderStruct.owner.toLowerCase(), {
                    limit: ownerLimits?.[orderStruct.owner.toLowerCase()] ?? 25,
                    orders: ordersProfileMap,
                });
            }
        } else {
            const ordersProfileMap: OrdersProfileMap = new Map();
            ordersProfileMap.set(orderDetails.orderHash.toLowerCase(), {
                active: true,
                order: orderStruct,
                takeOrders: await getPairs(orderStruct, viemClient, tokens, orderDetails),
                consumedTakeOrders: [],
            });
            const ownerProfileMap: OwnersProfileMap = new Map();
            ownerProfileMap.set(orderStruct.owner.toLowerCase(), {
                limit: ownerLimits?.[orderStruct.owner.toLowerCase()] ?? 25,
                orders: ordersProfileMap,
            });
            orderbookOwnersProfileMap.set(orderbook, ownerProfileMap);
        }
    }
    return orderbookOwnersProfileMap;
}
