/**
 * The default query used in the matchmaker bot to fetch the orders from subgraph
 */
exports.DefaultQuery = `{
    orders(
      where: {orderActive: true}
    ) {
      id
      handleIO 
      orderJSONString
      owner {
        id
      }
      orderActive
      expression
      interpreter
      interpreterStore
      transaction {
        id
      }
      validInputs {
        index
        token {
          id
          symbol
          decimals
        }
        tokenVault {
          balance
        }
        vault {
          id
        }
      }
      validOutputs {
        index
        token {
          id
          symbol
          decimals
        }
        tokenVault {
          balance
        }
        vault {
          id
        }
      }
    }
  }`