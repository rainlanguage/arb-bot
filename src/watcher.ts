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
        );
        handleRemoveOrders(
            ob,
            watchedOrderbookLogs.removeOrders.splice(0),
            orderbooksOwnersProfileMap,
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
) {
    orderbook = orderbook.toLowerCase();
    for (let i = 0; i < addOrders.length; i++) {
        const addOrderLog = addOrders[i];
        const orderStruct = addOrderLog.order as any as Order;
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
) {
    orderbook = orderbook.toLowerCase();
    for (let i = 0; i < removeOrders.length; i++) {
        const removeOrderLog = removeOrders[i];
        const orderStruct = removeOrderLog.order as any as Order;
        const orderbookOwnerProfileItem = orderbookOwnersProfileMap.get(orderbook);
        if (orderbookOwnerProfileItem) {
            const ownerProfile = orderbookOwnerProfileItem.get(orderStruct.owner.toLowerCase());
            if (ownerProfile) {
                const order = ownerProfile.orders.get(removeOrderLog.orderHash.toLowerCase());
                if (order) order.active = false;
            }
        }
    }
}

// /**
//  * Builds and bundles orders which their details are queried from a orderbook subgraph
//  * @param ordersDetails - Orders details queried from subgraph
//  * @param _shuffle - To shuffle the bundled order array at the end
//  * @param _bundle = If orders should be bundled based on token pair
//  * @returns Array of bundled take orders
//  */
// export const bundleOrders = async(
//     orderbook: string,
//     addOrders: WatchOrderArgs[],
//     viemClient: ViemClient,
//     orderbooksOwnersOrdersMap: OrderbookOwnerMap,
// ) => {
//     orderbook = orderbook.toLowerCase();
//     const orderbookOwnersOrdersMap = orderbooksOwnersOrdersMap.get(orderbook);
//     if (orderbookOwnersOrdersMap) {
//         for (const [k, v] of orderbookOwnersOrdersMap.entries()) {
//             const addOrder = addOrders.find(e => e.sender.toLowerCase() === k.toLowerCase());
//             if (addOrder) {
//                 const orderPair = v.processed.find(e => e.takeOrders[0].id.toLowerCase() === addOrder.orderHash.toLowerCase());
//                 if () {

//                 }
//             } else {

//             }
//         }
//     }
//     const tokenAddresses: string[] = [];
//     for (let i = 0; i < addOrders.length; i++) {
//         const addOrder = addOrders[i];
//         for (let j = 0; j < addOrder.order.validOutputs.length; j++) {
//             const token = addOrder.order.validOutputs[j].token.toLowerCase();
//             if (!tokenAddresses.includes(token)) tokenAddresses.push(token);
//         }
//         for (let j = 0; j < addOrder.order.validInputs.length; j++) {
//             const token = addOrder.order.validInputs[j].token.toLowerCase();
//             if (!tokenAddresses.includes(token)) tokenAddresses.push(token);
//         }
//     }
//     const symbols = await getBatchTokenSymbol(tokenAddresses, viemClient);
//     for (let j = 0; j < addOrder.order.validOutputs.length; j++) {
//         const _output = addOrder.order.validOutputs[j];
//         const _outputSymbolIndex = tokenAddresses.findIndex(
//             (v: any) => v === _output.token.toLowerCase(),
//         );
//         const _outputSymbol = _outputSymbolIndex > -1 ? _outputSymbolIndex : "UnknownSymbol"

//         for (let k = 0; k < addOrder.order.validInputs.length; k++) {
//             const _input = addOrder.order.validInputs[k];
//             const _inputSymbolIndex = tokenAddresses.findIndex(
//                 (v: any) => v === _output.token.toLowerCase(),
//             );
//             const _inputSymbol = _inputSymbolIndex > -1 ? _inputSymbolIndex : "UnknownSymbol"

//             if (_output.token.toLowerCase() !== _input.token.toLowerCase()) {
//                 if (!bundledOrders[orderbook]) {
//                     bundledOrders[orderbook] = [];
//                 }
//                 const pair = bundledOrders[orderbook].find(
//                     (v) =>
//                         v.sellToken === _output.token.toLowerCase() &&
//                         v.buyToken === _input.token.toLowerCase(),
//                 );
//                 if (pair && _bundle)
//                     pair.takeOrders.push({
//                         id: orderDetails.orderHash,
//                         active: true,
//                         takeOrder: {
//                             order: addOrder.order,
//                             inputIOIndex: k,
//                             outputIOIndex: j,
//                             signedContext: [],
//                         },
//                     });
//                 else
//                     bundledOrders[orderbook].push({
//                         orderbook,
//                         buyToken: _input.token.toLowerCase(),
//                         buyTokenSymbol: _inputSymbol,
//                         buyTokenDecimals: _input.decimals,
//                         sellToken: _output.token.toLowerCase(),
//                         sellTokenSymbol: _outputSymbol,
//                         sellTokenDecimals: _output.decimals,
//                         takeOrders: [
//                             {
//                                 id: orderDetails.orderHash,
//                                 active: true,
//                                 takeOrder: {
//                                     order: addOrder.order,
//                                     inputIOIndex: k,
//                                     outputIOIndex: j,
//                                     signedContext: [],
//                                 },
//                             },
//                         ],
//                     });
//             }
//         }
//     }}
// };
