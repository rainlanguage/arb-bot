/**
 * The default query used in the matchmaker bot to fetch the orders from subgraph
 */
exports.DefaultQuery = `{
    orders( where : { orderLive: true } ) {
        id 
        owner
        orderLive 
        expression 
        interpreter
        transactionHash
        validInputs { 
            tokenVault { 
                vaultId
                token {
                    id
                    symbol
                }
                balance
            }
        } 
        validOutputs {
            tokenVault { 
                vaultId
                token{
                    id
                    symbol
                }
                balance
            }
        }
    }
} `