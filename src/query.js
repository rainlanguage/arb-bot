/**
 * The default query used in the matchmaker bot to fetch the orders from subgraph
 */
const DefaultQuery = `{
    orders(
        where: {orderActive: true}
    ) {
        id
        handleIO 
        expression
        interpreter
        interpreterStore
        owner {
            id
        }
        validInputs(orderBy: index, orderDirection: asc) {
            index
            token {
                id
                decimals
                symbol
            }
            tokenVault {
                balance
            }
            vault {
                id
            }
        }
        validOutputs(orderBy: index, orderDirection: asc) {
            index
            token {
                id
                decimals
                symbol
            }
            tokenVault {
                balance
            }
            vault {
                id
            }
        }
    }
}`;

/**
 * Method to get the subgraph query body with optional filters
 * @param {string} orderHash - The order hash to apply as filter
 * @param {string} owner - The order owner to apply as filter
 * @param {string} interpreter - The interpreter to apply as filter
 * @returns the query string
 */
const getQuery = (orderHash, owner, interpreter) => {
    const orderHashFilter = orderHash ? `, id :"${orderHash.toLowerCase()}"` : "";
    const ownerFilter = owner ? `, owner :"${owner.toLowerCase()}"` : "";
    const interpreterFilter = interpreter ? `, interpreter :"${interpreter.toLowerCase()}"` : "";
    // let orderingProp, orderingDir;
    // const _turn = shuffle % 4;
    // if (_turn === 0) {
    //     orderingProp = "id";
    //     orderingDir = "asc";
    // }
    // if (_turn === 1) {
    //     orderingProp = "id";
    //     orderingDir = "desc";
    // }
    // if (_turn === 2) {
    //     orderingProp = "timestamp";
    //     orderingDir = "asc";
    // }
    // if (_turn === 3) {
    //     orderingProp = "timestamp";
    //     orderingDir = "desc";
    // }
    // orderBy: ${orderingProp}, orderDirection: ${orderingDir},
    return `{
        orders(
            where: {orderActive: true${orderHashFilter}${ownerFilter}${interpreterFilter}}
        ) {
            id
            handleIO 
            expression
            interpreter
            interpreterStore
            owner {
                id
            }
            validInputs(orderBy: index, orderDirection: asc) {
                index
                token {
                    id
                    decimals
                    symbol
                }
                tokenVault {
                    balance
                }
                vault {
                    id
                }
            }
            validOutputs(orderBy: index, orderDirection: asc) {
                index
                token {
                    id
                    decimals
                    symbol
                }
                tokenVault {
                    balance
                }
                vault {
                    id
                }
            }
        }
    }`;
};

module.exports = {
    DefaultQuery,
    getQuery
};