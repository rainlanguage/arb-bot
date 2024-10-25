import axios from "axios";

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
    orders(first: 100, skip: ${skip}, where: {active: true${orderbookFilter}${orderHashFilter}${ownerFilter}}) {
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
export async function getQuery(
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
