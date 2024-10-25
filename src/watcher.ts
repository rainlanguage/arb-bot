import { getPairs } from "./sg";
import { orderbookAbi as abi } from "./abis";
import { parseAbi, WatchContractEventReturnType } from "viem";
import {
    Order,
    ViemClient,
    TokenDetails,
    OrdersProfileMap,
    OwnersProfileMap,
    OrderbooksOwnersProfileMap,
} from "./types";
import { hexlify } from "ethers/lib/utils";
import { Span } from "@opentelemetry/api";

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
export type WatchedOrderbookOrders = { addOrders: OrderArgsLog[]; removeOrders: OrderArgsLog[] };

function toOrderArgsLog(orderLog: OrderEventLog): OrderArgsLog {
    return {
        sender: orderLog.sender,
        orderHash: orderLog.orderHash,
        order: toOrder(orderLog.order),
    };
}

export function toOrder(orderLog: any): Order {
    return {
        owner: orderLog.owner,
        nonce: orderLog.nonce,
        evaluable: {
            interpreter: orderLog.evaluable.interpreter,
            store: orderLog.evaluable.store,
            bytecode: orderLog.evaluable.bytecode,
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

export function watchOrderbook(
    orderbook: string,
    viemClient: ViemClient,
    watchedOrderbookOrders: WatchedOrderbookOrders,
): UnwatchOrderbook {
    const unwatchAddOrder = viemClient.watchContractEvent({
        address: orderbook as `0x${string}`,
        abi: orderbookAbi,
        eventName: "AddOrderV2",
        onLogs: (logs) => {
            logs.forEach((log) => {
                if (log) {
                    watchedOrderbookOrders.addOrders.push(
                        toOrderArgsLog(log.args as any as OrderEventLog),
                    );
                }
            });
        },
    });

    const unwatchRemoveOrder = viemClient.watchContractEvent({
        address: orderbook as `0x${string}`,
        abi: orderbookAbi,
        eventName: "RemoveOrderV2",
        onLogs: (logs) => {
            logs.forEach((log) => {
                if (log) {
                    watchedOrderbookOrders.removeOrders.push(
                        toOrderArgsLog(log.args as any as OrderEventLog),
                    );
                }
            });
        },
    });

    return {
        unwatchAddOrder,
        unwatchRemoveOrder,
    };
}

export function watchAllOrderbooks(
    orderbooks: string[],
    viemClient: ViemClient,
    watchedOrderbooksOrders: Record<string, WatchedOrderbookOrders>,
): Record<string, UnwatchOrderbook> {
    const result: Record<string, UnwatchOrderbook> = {};
    for (const ob of orderbooks) {
        if (!watchedOrderbooksOrders[ob])
            watchedOrderbooksOrders[ob] = { addOrders: [], removeOrders: [] };
        const res = watchOrderbook(ob, viemClient, watchedOrderbooksOrders[ob]);
        result[ob] = res;
    }
    return result;
}

export function unwatchAll(watchers: Record<string, UnwatchOrderbook>) {
    for (const ob in watchers) {
        watchers[ob].unwatchAddOrder();
        watchers[ob].unwatchRemoveOrder();
    }
}

export async function handleNewLogs(
    orderbooksOwnersProfileMap: OrderbooksOwnersProfileMap,
    watchedOrderbooksOrders: Record<string, WatchedOrderbookOrders>,
    viemClient: ViemClient,
    tokens: TokenDetails[],
    ownerLimits?: Record<string, number>,
    span?: Span,
) {
    for (const ob in watchedOrderbooksOrders) {
        const watchedOrderbookLogs = watchedOrderbooksOrders[ob];
        await handleAddOrders(
            ob,
            watchedOrderbookLogs.addOrders.splice(0),
            orderbooksOwnersProfileMap,
            viemClient,
            tokens,
            ownerLimits,
            span,
        );
        handleRemoveOrders(
            ob,
            watchedOrderbookLogs.removeOrders.splice(0),
            orderbooksOwnersProfileMap,
            span,
        );
    }
}

/**
 * Get a map of per owner orders per orderbook
 * @param ordersDetails - Order details queried from subgraph
 */
export async function handleAddOrders(
    orderbook: string,
    addOrders: OrderArgsLog[],
    orderbookOwnersProfileMap: OrderbooksOwnersProfileMap,
    viemClient: ViemClient,
    tokens: TokenDetails[],
    ownerLimits?: Record<string, number>,
    span?: Span,
) {
    orderbook = orderbook.toLowerCase();
    span?.setAttribute(
        "details.newOrders",
        addOrders.map((v) => v.orderHash),
    );
    for (let i = 0; i < addOrders.length; i++) {
        const addOrderLog = addOrders[i];
        const orderStruct = addOrderLog.order;
        const orderbookOwnerProfileItem = orderbookOwnersProfileMap.get(orderbook);
        if (orderbookOwnerProfileItem) {
            const ownerProfile = orderbookOwnerProfileItem.get(orderStruct.owner.toLowerCase());
            if (ownerProfile) {
                const order = ownerProfile.orders.get(addOrderLog.orderHash.toLowerCase());
                if (!order) {
                    ownerProfile.orders.set(addOrderLog.orderHash.toLowerCase(), {
                        active: true,
                        order: orderStruct,
                        takeOrders: await getPairs(orderStruct, viemClient, tokens),
                        consumedTakeOrders: [],
                    });
                } else {
                    order.active = true;
                }
            } else {
                const ordersProfileMap: OrdersProfileMap = new Map();
                ordersProfileMap.set(addOrderLog.orderHash.toLowerCase(), {
                    active: true,
                    order: orderStruct,
                    takeOrders: await getPairs(orderStruct, viemClient, tokens),
                    consumedTakeOrders: [],
                });
                orderbookOwnerProfileItem.set(orderStruct.owner.toLowerCase(), {
                    limit: ownerLimits?.[orderStruct.owner.toLowerCase()] ?? 25,
                    orders: ordersProfileMap,
                });
            }
        } else {
            const ordersProfileMap: OrdersProfileMap = new Map();
            ordersProfileMap.set(addOrderLog.orderHash.toLowerCase(), {
                active: true,
                order: orderStruct,
                takeOrders: await getPairs(orderStruct, viemClient, tokens),
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
}

/**
 * Get a map of per owner orders per orderbook
 * @param ordersDetails - Order details queried from subgraph
 */
export function handleRemoveOrders(
    orderbook: string,
    removeOrders: OrderArgsLog[],
    orderbookOwnersProfileMap: OrderbooksOwnersProfileMap,
    span?: Span,
) {
    orderbook = orderbook.toLowerCase();
    span?.setAttribute(
        "details.removedOrders",
        removeOrders.map((v) => v.orderHash),
    );
    for (let i = 0; i < removeOrders.length; i++) {
        const removeOrderLog = removeOrders[i];
        const orderStruct = removeOrderLog.order;
        const orderbookOwnerProfileItem = orderbookOwnersProfileMap.get(orderbook);
        if (orderbookOwnerProfileItem) {
            const ownerProfile = orderbookOwnerProfileItem.get(orderStruct.owner.toLowerCase());
            if (ownerProfile) {
                const order = ownerProfile.orders.get(removeOrderLog.orderHash.toLowerCase());
                if (order) {
                    order.active = false;
                    order.takeOrders.push(...order.consumedTakeOrders.splice(0));
                }
            }
        }
    }
}
