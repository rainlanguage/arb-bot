import { OrderV3 } from "./abis";
import { SgOrder } from "./query";
import { Span } from "@opentelemetry/api";
import { hexlify } from "ethers/lib/utils";
import { addWatchedToken } from "./account";
import { getTokenSymbol, shuffleArray } from "./utils";
import { decodeAbiParameters, parseAbiParameters } from "viem";
import {
    Pair,
    Order,
    ViemClient,
    TokenDetails,
    BundledOrders,
    OrdersProfileMap,
    OwnersProfileMap,
    OrderbooksOwnersProfileMap,
} from "./types";

/**
 * The default owner limit
 */
export const DEFAULT_OWNER_LIMIT = 25 as const;

export function toOrder(orderLog: any): Order {
    return {
        owner: orderLog.owner.toLowerCase(),
        nonce: orderLog.nonce.toLowerCase(),
        evaluable: {
            interpreter: orderLog.evaluable.interpreter.toLowerCase(),
            store: orderLog.evaluable.store.toLowerCase(),
            bytecode: orderLog.evaluable.bytecode.toLowerCase(),
        },
        validInputs: orderLog.validInputs.map((v: any) => ({
            token: v.token.toLowerCase(),
            decimals: v.decimals,
            vaultId: hexlify(v.vaultId),
        })),
        validOutputs: orderLog.validOutputs.map((v: any) => ({
            token: v.token.toLowerCase(),
            decimals: v.decimals,
            vaultId: hexlify(v.vaultId),
        })),
    };
}

/**
 * Get all pairs of an order
 */
export async function getOrderPairs(
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
            addWatchedToken(
                {
                    address: _output.token.toLowerCase(),
                    symbol: _outputSymbol,
                    decimals: _output.decimals,
                },
                tokens,
            );
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
                addWatchedToken(
                    {
                        address: _input.token.toLowerCase(),
                        symbol: _inputSymbol,
                        decimals: _input.decimals,
                    },
                    tokens,
                );
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
 * Handles new orders fetched from sg to the owner profile map
 */
export async function handleAddOrderbookOwnersProfileMap(
    orderbooksOwnersProfileMap: OrderbooksOwnersProfileMap,
    ordersDetails: SgOrder[],
    viemClient: ViemClient,
    tokens: TokenDetails[],
    ownerLimits?: Record<string, number>,
    span?: Span,
) {
    const changes: Record<string, string[]> = {};
    for (let i = 0; i < ordersDetails.length; i++) {
        const orderDetails = ordersDetails[i];
        const orderbook = orderDetails.orderbook.id.toLowerCase();
        const orderStruct = toOrder(
            decodeAbiParameters(
                parseAbiParameters(OrderV3),
                orderDetails.orderBytes as `0x${string}`,
            )[0],
        );
        if (span) {
            if (!changes[orderbook]) changes[orderbook] = [];
            if (!changes[orderbook].includes(orderDetails.orderHash.toLowerCase())) {
                changes[orderbook].push(orderDetails.orderHash.toLowerCase());
            }
        }
        const orderbookOwnerProfileItem = orderbooksOwnersProfileMap.get(orderbook);
        if (orderbookOwnerProfileItem) {
            const ownerProfile = orderbookOwnerProfileItem.get(orderStruct.owner.toLowerCase());
            if (ownerProfile) {
                const order = ownerProfile.orders.get(orderDetails.orderHash.toLowerCase());
                if (!order) {
                    ownerProfile.orders.set(orderDetails.orderHash.toLowerCase(), {
                        active: true,
                        order: orderStruct,
                        takeOrders: await getOrderPairs(
                            orderStruct,
                            viemClient,
                            tokens,
                            orderDetails,
                        ),
                        consumedTakeOrders: [],
                    });
                } else {
                    if (!order.active) order.active = true;
                }
            } else {
                const ordersProfileMap: OrdersProfileMap = new Map();
                ordersProfileMap.set(orderDetails.orderHash.toLowerCase(), {
                    active: true,
                    order: orderStruct,
                    takeOrders: await getOrderPairs(orderStruct, viemClient, tokens, orderDetails),
                    consumedTakeOrders: [],
                });
                orderbookOwnerProfileItem.set(orderStruct.owner.toLowerCase(), {
                    limit: ownerLimits?.[orderStruct.owner.toLowerCase()] ?? DEFAULT_OWNER_LIMIT,
                    orders: ordersProfileMap,
                });
            }
        } else {
            const ordersProfileMap: OrdersProfileMap = new Map();
            ordersProfileMap.set(orderDetails.orderHash.toLowerCase(), {
                active: true,
                order: orderStruct,
                takeOrders: await getOrderPairs(orderStruct, viemClient, tokens, orderDetails),
                consumedTakeOrders: [],
            });
            const ownerProfileMap: OwnersProfileMap = new Map();
            ownerProfileMap.set(orderStruct.owner.toLowerCase(), {
                limit: ownerLimits?.[orderStruct.owner.toLowerCase()] ?? DEFAULT_OWNER_LIMIT,
                orders: ordersProfileMap,
            });
            orderbooksOwnersProfileMap.set(orderbook, ownerProfileMap);
        }
    }
    if (span) {
        for (const orderbook in changes) {
            span.setAttribute(`orderbooksChanges.${orderbook}.addedOrders`, changes[orderbook]);
        }
    }
}

/**
 * Handles new removed orders fetched from sg to the owner profile map
 */
export async function handleRemoveOrderbookOwnersProfileMap(
    orderbooksOwnersProfileMap: OrderbooksOwnersProfileMap,
    ordersDetails: SgOrder[],
    span?: Span,
) {
    const changes: Record<string, string[]> = {};
    for (let i = 0; i < ordersDetails.length; i++) {
        const orderDetails = ordersDetails[i];
        const orderbook = orderDetails.orderbook.id.toLowerCase();
        const orderStruct = toOrder(
            decodeAbiParameters(
                parseAbiParameters(OrderV3),
                orderDetails.orderBytes as `0x${string}`,
            )[0],
        );
        if (span) {
            if (!changes[orderbook]) changes[orderbook] = [];
            if (!changes[orderbook].includes(orderDetails.orderHash.toLowerCase())) {
                changes[orderbook].push(orderDetails.orderHash.toLowerCase());
            }
        }
        const orderbookOwnerProfileItem = orderbooksOwnersProfileMap.get(orderbook);
        if (orderbookOwnerProfileItem) {
            const ownerProfile = orderbookOwnerProfileItem.get(orderStruct.owner.toLowerCase());
            if (ownerProfile) {
                ownerProfile.orders.delete(orderDetails.orderHash.toLowerCase());
            }
        }
    }
    if (span) {
        for (const orderbook in changes) {
            span.setAttribute(`orderbooksChanges.${orderbook}.removedOrders`, changes[orderbook]);
        }
    }
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
    const orderbooksOwnersProfileMap: OrderbooksOwnersProfileMap = new Map();
    await handleAddOrderbookOwnersProfileMap(
        orderbooksOwnersProfileMap,
        ordersDetails,
        viemClient,
        tokens,
        ownerLimits,
    );
    return orderbooksOwnersProfileMap;
}

/**
 * Prepares an array of orders for a arb round by following owners limits
 * @param orderbooksOwnersProfileMap - The orderbooks owners orders map
 * @param shuffle - (optional) Shuffle the order of items
 */
export function prepareOrdersForRound(
    orderbooksOwnersProfileMap: OrderbooksOwnersProfileMap,
    shuffle = true,
): BundledOrders[][] {
    const result: BundledOrders[][] = [];
    for (const [orderbook, ownersProfileMap] of orderbooksOwnersProfileMap) {
        const orderbookBundledOrders: BundledOrders[] = [];
        for (const [, ownerProfile] of ownersProfileMap) {
            let remainingLimit = ownerProfile.limit;
            const activeOrdersProfiles = Array.from(ownerProfile.orders).filter((v) => v[1].active);
            let remainingOrdersPairs = activeOrdersProfiles.filter(
                (v) => v[1].takeOrders.length > 0,
            );
            // reset if all orders are already consumed
            if (remainingOrdersPairs.length === 0) {
                for (const [, orderProfile] of activeOrdersProfiles) {
                    orderProfile.takeOrders.push(...orderProfile.consumedTakeOrders.splice(0));
                }
                remainingOrdersPairs = activeOrdersProfiles;
            }
            // consume orders limits
            for (const [orderHash, orderProfile] of remainingOrdersPairs) {
                if (remainingLimit > 0) {
                    const consumingOrderPairs = orderProfile.takeOrders.splice(0, remainingLimit);
                    remainingLimit -= consumingOrderPairs.length;
                    orderProfile.consumedTakeOrders.push(...consumingOrderPairs);
                    gatherPairs(orderbook, orderHash, consumingOrderPairs, orderbookBundledOrders);
                }
            }
            // if all orders are consumed and still there is limit remaining,
            // reset and start consuming again from top until limit is reached
            if (remainingLimit > 0) {
                for (const [orderHash, orderProfile] of activeOrdersProfiles) {
                    orderProfile.takeOrders.push(...orderProfile.consumedTakeOrders.splice(0));
                    if (remainingLimit > 0) {
                        const consumingOrderPairs = orderProfile.takeOrders.splice(
                            0,
                            remainingLimit,
                        );
                        remainingLimit -= consumingOrderPairs.length;
                        orderProfile.consumedTakeOrders.push(...consumingOrderPairs);
                        gatherPairs(
                            orderbook,
                            orderHash,
                            consumingOrderPairs,
                            orderbookBundledOrders,
                        );
                    }
                }
            }
        }
        if (shuffle) {
            // shuffle orders
            for (const bundledOrders of orderbookBundledOrders) {
                shuffleArray(bundledOrders.takeOrders);
            }
            // shuffle pairs
            shuffleArray(orderbookBundledOrders);
        }
        result.push(orderbookBundledOrders);
    }
    if (shuffle) {
        // shuffle orderbooks
        shuffleArray(result);
    }
    return result;
}

/**
 * Gathers owners orders by token pair
 */
function gatherPairs(
    orderbook: string,
    orderHash: string,
    pairs: Pair[],
    bundledOrders: BundledOrders[],
) {
    for (const pair of pairs) {
        const bundleOrder = bundledOrders.find(
            (v) =>
                v.buyToken.toLowerCase() === pair.buyToken.toLowerCase() &&
                v.sellToken.toLowerCase() === pair.sellToken.toLowerCase(),
        );
        if (bundleOrder) {
            // make sure to not duplicate
            if (
                !bundleOrder.takeOrders.find((v) => v.id.toLowerCase() === orderHash.toLowerCase())
            ) {
                bundleOrder.takeOrders.push({
                    id: orderHash,
                    takeOrder: pair.takeOrder,
                });
            }
        } else {
            bundledOrders.push({
                orderbook,
                buyToken: pair.buyToken,
                buyTokenDecimals: pair.buyTokenDecimals,
                buyTokenSymbol: pair.buyTokenSymbol,
                sellToken: pair.sellToken,
                sellTokenDecimals: pair.sellTokenDecimals,
                sellTokenSymbol: pair.sellTokenSymbol,
                takeOrders: [
                    {
                        id: orderHash,
                        takeOrder: pair.takeOrder,
                    },
                ],
            });
        }
    }
}
