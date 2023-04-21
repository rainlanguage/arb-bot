/**
 * The default query used in the matchmaker bot to fetch the orders from subgraph
 */
exports.DefaultQuery = `{
    orders(
      where: {orderActive: true, id: "0xa390823670160ee977b7f0e347facdf24475005bcc1c5ba5090bc986a6206f12"}
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