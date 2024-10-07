/**
 * Method to get the subgraph query body with optional filters
 * @param orderHash - The order hash to apply as filter
 * @param owner - The order owner to apply as filter
 * @param orderbook - The orderbook address
 * @returns the query string
 */
export function getQuery(orderHash?: string, owner?: string, orderbook?: string): string {
    const ownerFilter = owner ? `, owner: "${owner.toLowerCase()}"` : "";
    const orderHashFilter = orderHash ? `, orderHash: "${orderHash.toLowerCase()}"` : "";
    const orderbookFilter = orderbook ? `, orderbook: "${orderbook.toLowerCase()}"` : "";
    return `{
    orders(where: {active: true${orderbookFilter}${orderHashFilter}${ownerFilter}}) {
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
