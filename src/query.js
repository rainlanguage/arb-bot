/**
 * The default query used in the matchmaker bot to fetch the orders from subgraph
 */
const DefaultQuery = `{
    orders(where: {active: true}) {
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
                name
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
                name
                symbol
            }
        }
    }
}`;

/**
 * Method to get the subgraph query body with optional filters
 * @param {string} orderHash - The order hash to apply as filter
 * @param {string} owner - The order owner to apply as filter
 * @returns the query string
 */
const getQuery = (orderHash, owner) => {
    const ownerFilter = owner ? `, owner :"${owner.toLowerCase()}"` : "";
    const orderHashFilter = orderHash ? `, orderHash :"${orderHash.toLowerCase()}"` : "";
    return `{
    orders(where: {active: true${orderHashFilter}${ownerFilter}}) {
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