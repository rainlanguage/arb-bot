/**
 * Method to get the subgraph query body with optional filters
 * @param {string} orderHash - The order hash to apply as filter
 * @param {string} owner - The order owner to apply as filter
 * @param {string} orderbook - The orderbook address
 * @returns the query string
 */
const getQuery = (orderHash, owner, orderbook) => {
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
    getQuery,
    statusCheckQuery
};
