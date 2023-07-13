/**
 * The default query used in the matchmaker bot to fetch the orders from subgraph
 */
exports.DefaultQuery = `{
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

exports.getQuery = (hash) => {
    let defaultQuery = DefaultQuery;
    if(hash){
        defaultQuery = `{
            orders(
                where: {orderActive: true, id :"${hash}"}
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
    }
    return defaultQuery;

};