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