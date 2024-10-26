import { Span } from "@opentelemetry/api";
import { hexlify } from "ethers/lib/utils";
import { orderbookAbi as abi } from "./abis";
import { DEFAULT_OWNER_LIMIT, getOrderPairs } from "./order";
import { parseAbi, WatchContractEventReturnType } from "viem";
import {
    Order,
    ViemClient,
    TokenDetails,
    OrdersProfileMap,
    OwnersProfileMap,
    OrderbooksOwnersProfileMap,
} from "./types";

type OrderEventLog = {
    sender: `0x${string}`;
    orderHash: `0x${string}`;
    order: {
        owner: `0x${string}`;
        evaluable: {
            interpreter: `0x${string}`;
            store: `0x${string}`;
            bytecode: `0x${string}`;
        };
        validInputs: readonly {
            token: `0x${string}`;
            decimals: number;
            vaultId: bigint;
        }[];
        validOutputs: readonly {
            token: `0x${string}`;
            decimals: number;
            vaultId: bigint;
        }[];
        nonce: `0x${string}`;
    };
};
export type OrderArgsLog = {
    sender: `0x${string}`;
    orderHash: `0x${string}`;
    order: Order;
};
export type OrderLog = {
    type: "add" | "remove";
    order: OrderArgsLog;
    block: number;
    logIndex: number;
};
export type WatchedOrderbookOrders = { orderLogs: OrderLog[] };

function logToOrder(orderLog: OrderEventLog): OrderArgsLog {
    return {
        sender: orderLog.sender,
        orderHash: orderLog.orderHash,
        order: toOrder(orderLog.order),
    };
}

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

export const orderbookAbi = parseAbi(abi);
export type UnwatchOrderbook = {
    unwatchAddOrder: WatchContractEventReturnType;
    unwatchRemoveOrder: WatchContractEventReturnType;
};

/**
 * Applies an event watcher for a specified orderbook
 */
export function watchOrderbook(
    orderbook: string,
    viemClient: ViemClient,
    watchedOrderbookOrders: WatchedOrderbookOrders,
): UnwatchOrderbook {
    const unwatchAddOrder = viemClient.watchContractEvent({
        address: orderbook as `0x${string}`,
        abi: orderbookAbi,
        eventName: "AddOrderV2",
        pollingInterval: 30_000,
        onLogs: (logs) => {
            logs.forEach((log) => {
                if (log) {
                    watchedOrderbookOrders.orderLogs.push({
                        type: "add",
                        logIndex: log.logIndex,
                        block: Number(log.blockNumber),
                        order: logToOrder(log.args as any as OrderEventLog),
                    });
                }
            });
        },
    });

    const unwatchRemoveOrder = viemClient.watchContractEvent({
        address: orderbook as `0x${string}`,
        abi: orderbookAbi,
        eventName: "RemoveOrderV2",
        pollingInterval: 30_000,
        onLogs: (logs) => {
            logs.forEach((log) => {
                if (log) {
                    watchedOrderbookOrders.orderLogs.push({
                        type: "remove",
                        logIndex: log.logIndex,
                        block: Number(log.blockNumber),
                        order: logToOrder(log.args as any as OrderEventLog),
                    });
                }
            });
        },
    });

    return {
        unwatchAddOrder,
        unwatchRemoveOrder,
    };
}

/**
 * Applies event watcher all known orderbooks
 * @returns Unwatchers for all orderbooks
 */
export function watchAllOrderbooks(
    orderbooks: string[],
    viemClient: ViemClient,
    watchedOrderbooksOrders: Record<string, WatchedOrderbookOrders>,
): Record<string, UnwatchOrderbook> {
    const allUnwatchers: Record<string, UnwatchOrderbook> = {};
    for (const v of orderbooks) {
        const ob = v.toLowerCase();
        if (!watchedOrderbooksOrders[ob]) {
            watchedOrderbooksOrders[ob] = { orderLogs: [] };
        }
        const unwatcher = watchOrderbook(ob, viemClient, watchedOrderbooksOrders[ob]);
        allUnwatchers[ob] = unwatcher;
    }
    return allUnwatchers;
}

/**
 * Unwatches all orderbooks event watchers
 */
export function unwatchAllOrderbooks(unwatchers: Record<string, UnwatchOrderbook>) {
    for (const ob in unwatchers) {
        unwatchers[ob].unwatchAddOrder();
        unwatchers[ob].unwatchRemoveOrder();
    }
}

/**
 * Hanldes all new order logs of all watched orderbooks
 */
export async function handleOrderbooksNewLogs(
    orderbooksOwnersProfileMap: OrderbooksOwnersProfileMap,
    watchedOrderbooksOrders: Record<string, WatchedOrderbookOrders>,
    viemClient: ViemClient,
    tokens: TokenDetails[],
    ownerLimits?: Record<string, number>,
    span?: Span,
) {
    for (const ob in watchedOrderbooksOrders) {
        const watchedOrderbookLogs = watchedOrderbooksOrders[ob];
        const logs = watchedOrderbookLogs.orderLogs.splice(0);
        // make sure logs are sorted before applying them to the map
        logs.sort((a, b) => {
            const block = a.block - b.block;
            return block !== 0 ? block : a.logIndex - b.logIndex;
        });
        await handleNewOrderLogs(
            ob,
            logs,
            orderbooksOwnersProfileMap,
            viemClient,
            tokens,
            ownerLimits,
            span,
        );
    }
}

/**
 * Handles new order logs for an orderbook
 */
export async function handleNewOrderLogs(
    orderbook: string,
    orderLogs: OrderLog[],
    orderbookOwnersProfileMap: OrderbooksOwnersProfileMap,
    viemClient: ViemClient,
    tokens: TokenDetails[],
    ownerLimits?: Record<string, number>,
    span?: Span,
) {
    orderbook = orderbook.toLowerCase();
    if (orderLogs.length) {
        span?.setAttribute(
            `orderbooksChanges.${orderbook}.addedOrders`,
            orderLogs.filter((v) => v.type === "add").map((v) => v.order.orderHash),
        );
        span?.setAttribute(
            `orderbooksChanges.${orderbook}.removedOrders`,
            orderLogs.filter((v) => v.type === "add").map((v) => v.order.orderHash),
        );
    }
    for (let i = 0; i < orderLogs.length; i++) {
        const orderLog = orderLogs[i].order;
        const orderStruct = orderLog.order;
        const orderbookOwnerProfileItem = orderbookOwnersProfileMap.get(orderbook);
        if (orderLogs[i].type === "add") {
            if (orderbookOwnerProfileItem) {
                const ownerProfile = orderbookOwnerProfileItem.get(orderStruct.owner.toLowerCase());
                if (ownerProfile) {
                    const order = ownerProfile.orders.get(orderLog.orderHash.toLowerCase());
                    if (!order) {
                        ownerProfile.orders.set(orderLog.orderHash.toLowerCase(), {
                            active: true,
                            order: orderStruct,
                            takeOrders: await getOrderPairs(orderStruct, viemClient, tokens),
                            consumedTakeOrders: [],
                        });
                    } else {
                        order.active = true;
                    }
                } else {
                    const ordersProfileMap: OrdersProfileMap = new Map();
                    ordersProfileMap.set(orderLog.orderHash.toLowerCase(), {
                        active: true,
                        order: orderStruct,
                        takeOrders: await getOrderPairs(orderStruct, viemClient, tokens),
                        consumedTakeOrders: [],
                    });
                    orderbookOwnerProfileItem.set(orderStruct.owner.toLowerCase(), {
                        limit:
                            ownerLimits?.[orderStruct.owner.toLowerCase()] ?? DEFAULT_OWNER_LIMIT,
                        orders: ordersProfileMap,
                    });
                }
            } else {
                const ordersProfileMap: OrdersProfileMap = new Map();
                ordersProfileMap.set(orderLog.orderHash.toLowerCase(), {
                    active: true,
                    order: orderStruct,
                    takeOrders: await getOrderPairs(orderStruct, viemClient, tokens),
                    consumedTakeOrders: [],
                });
                const ownerProfileMap: OwnersProfileMap = new Map();
                ownerProfileMap.set(orderStruct.owner.toLowerCase(), {
                    limit: ownerLimits?.[orderStruct.owner.toLowerCase()] ?? DEFAULT_OWNER_LIMIT,
                    orders: ordersProfileMap,
                });
                orderbookOwnersProfileMap.set(orderbook, ownerProfileMap);
            }
        } else {
            if (orderbookOwnerProfileItem) {
                const ownerProfile = orderbookOwnerProfileItem.get(orderStruct.owner.toLowerCase());
                if (ownerProfile) {
                    const order = ownerProfile.orders.get(orderLog.orderHash.toLowerCase());
                    if (order) {
                        order.active = false;
                        order.takeOrders.push(...order.consumedTakeOrders.splice(0));
                    }
                }
            }
        }
    }
}
