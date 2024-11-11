import axios from "axios";
import { errorSnapshot } from "./error";
import { Span } from "@opentelemetry/api";

export type SgOrder = {
    id: string;
    owner: string;
    orderHash: string;
    orderBytes: string;
    active: boolean;
    nonce: string;
    orderbook: {
        id: string;
    };
    inputs: {
        balance: string;
        vaultId: string;
        token: {
            address: string;
            decimals: string | number;
            symbol: string;
        };
    }[];
    outputs: {
        balance: string;
        vaultId: string;
        token: {
            address: string;
            decimals: string | number;
            symbol: string;
        };
    }[];
};

export type NewSgOrder = {
    order: SgOrder;
    timestamp: number;
};

/**
 * Method to get the subgraph query body with optional filters
 * @param orderHash - The order hash to apply as filter
 * @param owner - The order owner to apply as filter
 * @param orderbook - The orderbook address
 * @returns the query string
 */
export function getQueryPaginated(
    skip: number,
    orderHash?: string,
    owner?: string,
    orderbook?: string,
): string {
    const ownerFilter = owner ? `, owner: "${owner.toLowerCase()}"` : "";
    const orderHashFilter = orderHash ? `, orderHash: "${orderHash.toLowerCase()}"` : "";
    const orderbookFilter = orderbook ? `, orderbook: "${orderbook.toLowerCase()}"` : "";
    return `{
    orders(first: 100, skip: ${skip}, orderBy: timestampAdded, orderDirection: desc, where: {active: true${orderbookFilter}${orderHashFilter}${ownerFilter}}) {
        id
        owner
        orderHash
        orderBytes
        active
        nonce
        orderbook {
            id
        }
        inputs {
            balance
            vaultId
            token {
                address
                decimals
                symbol
            }
        }
        outputs {
            balance
            vaultId
            token {
                address
                decimals
                symbol
            }
        }
    }
}`;
}

/**
 * Get all active orders from a subgraph, with optional filters
 * @param subgraph - Subgraph url
 * @param orderHash - orderHash filter
 * @param owner - owner filter
 * @param orderbook - orderbook filter
 * @param timeout - timeout
 */
export async function querySgOrders(
    subgraph: string,
    orderHash?: string,
    owner?: string,
    orderbook?: string,
    timeout?: number,
): Promise<SgOrder[]> {
    const result: any[] = [];
    let skip = 0;
    for (;;) {
        const res = await axios.post(
            subgraph,
            {
                query: getQueryPaginated(skip, orderHash, owner, orderbook),
            },
            { headers: { "Content-Type": "application/json" }, timeout },
        );
        if (res?.data?.data?.orders?.length) {
            const orders = res.data.data.orders;
            result.push(...orders);
            if (orders.length < 100) {
                break;
            } else {
                skip += 100;
            }
        } else {
            break;
        }
    }
    return result;
}

export const orderbooksQuery = `{
    orderbooks {
        id
    }
}`;

export const statusCheckQuery = `{
    _meta {
        hasIndexingErrors
        block {
            number
        }
    }
}`;

export const getRemoveOrdersQuery = (start: number, end: number) => {
    return `{removeOrders(where: { transaction_: { timestamp_gt: "${start.toString()}", timestamp_lte: "${end.toString()}" } }) {
    order {
        id
        owner
        orderHash
        orderBytes
        active
        nonce
        orderbook {
            id
        }
        inputs {
            balance
            vaultId
            token {
                address
                decimals
                symbol
            }
        }
        outputs {
            balance
            vaultId
            token {
                address
                decimals
                symbol
            }
        }
    }
    transaction {
      timestamp
    }
}}`;
};

export const getAddOrdersQuery = (start: number, end: number) => {
    return `{addOrders(where: { transaction_: { timestamp_gt: "${start.toString()}", timestamp_lte: "${end.toString()}" } }) {
    order {
        id
        owner
        orderHash
        orderBytes
        active
        nonce
        orderbook {
            id
        }
        inputs {
            balance
            vaultId
            token {
                address
                decimals
                symbol
            }
        }
        outputs {
            balance
            vaultId
            token {
                address
                decimals
                symbol
            }
        }
    }
    transaction {
      timestamp
    }
}}`;
};

/**
 * Fecthes the remove orders from the given subgraph in the given timeframe
 * @param subgraph - The subgraph url
 * @param startTimestamp - start timestamp range
 * @param endTimestamp - end timestamp range
 * @param timeout - promise timeout
 */
export async function getRemoveOrders(
    subgraph: string,
    startTimestamp: number,
    endTimestamp: number,
    timeout?: number,
    span?: Span,
) {
    const removeOrders: NewSgOrder[] = [];
    try {
        const res = await axios.post(
            subgraph,
            { query: getRemoveOrdersQuery(startTimestamp, endTimestamp) },
            { headers: { "Content-Type": "application/json" }, timeout },
        );
        if (typeof res?.data?.data?.removeOrders !== "undefined") {
            res.data.data.removeOrders.forEach((v: any) => {
                if (typeof v?.order?.active === "boolean" && !v.order.active) {
                    if (!removeOrders.find((e) => e.order.id === v.order.id)) {
                        removeOrders.push({
                            order: v.order as SgOrder,
                            timestamp: Number(v.transaction.timestamp),
                        });
                    }
                }
            });
        } else {
            span?.addEvent(`Failed to get new removed orders ${subgraph}: invalid response`);
            throw "invalid response";
        }
    } catch (error) {
        span?.addEvent(errorSnapshot(`Failed to get new removed orders ${subgraph}`, error));
    }

    removeOrders.sort((a, b) => b.timestamp - a.timestamp);
    return removeOrders;
}

/**
 * Fecthes the add orders from the given subgraph in the given timeframe
 * @param subgraph - The subgraph url
 * @param startTimestamp - start timestamp range
 * @param endTimestamp - end timestamp range
 * @param timeout - promise timeout
 */
export async function getAddOrders(
    subgraph: string,
    startTimestamp: number,
    endTimestamp: number,
    timeout?: number,
    span?: Span,
) {
    const addOrders: NewSgOrder[] = [];
    try {
        const res = await axios.post(
            subgraph,
            { query: getAddOrdersQuery(startTimestamp, endTimestamp) },
            { headers: { "Content-Type": "application/json" }, timeout },
        );
        if (typeof res?.data?.data?.addOrders !== "undefined") {
            res.data.data.addOrders.forEach((v: any) => {
                if (typeof v?.order?.active === "boolean" && v.order.active) {
                    if (!addOrders.find((e) => e.order.id === v.order.id)) {
                        addOrders.push({
                            order: v.order as SgOrder,
                            timestamp: Number(v.transaction.timestamp),
                        });
                    }
                }
            });
        } else {
            span?.addEvent(`Failed to get new orders ${subgraph}: invalid response`);
            throw "invalid response";
        }
    } catch (error) {
        span?.addEvent(errorSnapshot(`Failed to get new orders from subgraph ${subgraph}`, error));
        throw error;
    }

    addOrders.sort((a, b) => b.timestamp - a.timestamp);
    return addOrders;
}
