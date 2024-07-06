/**
 * The default query used in the matchmaker bot to fetch the orders from subgraph
 */
const DefaultQuery = `{
    orders(where: {active: true}) {
        orderbook {
            id
        }
        id
        owner
        orderHash
        orderBytes
        active
        nonce
        inputs {
            id
            balance
            vaultId
            token {
                address
                decimals
                symbol
            }
        }
        outputs {
            id
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

/**
 * Method to get the subgraph query body with optional filters
 * @param {string} orderbook - The orderbook address to apply as filter
 * @param {string} orderHash - The order hash to apply as filter
 * @param {string} owner - The order owner to apply as filter
 * @returns the query string
 */
const getQuery = (orderbook, orderHash, owner) => {
    const orderbookFilter = orderbook ? `, orderbook: "${orderbook.toLowerCase()}"` : "";
    const ownerFilter = owner ? `, owner :"${owner.toLowerCase()}"` : "";
    const orderHashFilter = orderHash ? `, orderHash :"${orderHash.toLowerCase()}"` : "";
    return `{
    orders(where: {active: true${orderHashFilter}${ownerFilter}${orderbookFilter}}) {
        orderbook {
            id
        }
        id
        owner
        orderHash
        orderBytes
        active
        nonce
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
}`;};

const statusCheckQuery = `{
    _meta {
        hasIndexingErrors
        block {
            number
        }
    }
}`;

module.exports = {
    DefaultQuery,
    getQuery,
    statusCheckQuery
};