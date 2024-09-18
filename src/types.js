/**
 * @import ethers from "ethers"
 * @import { Token } from "sushi/currency"
 * @import { Chain, PublicClient, WalletClient, PublicActions, HDAccount, FallbackTransport } from "viem"
 * @import { LiquidityProviders, DataFetcher } from "sushi/router"
 * @import { ProcessPairHaltReason, ProcessPairReportStatus } from "./processOrders"
 */

/**
 * @typedef BotError
 * @type {object}
 * @property {string} snapshot
 * @property {any} error
 */

/**
 * @typedef CliOptions
 * @type {object}
 * @property {string=} key
 * @property {string=} mnemonic
 * @property {string[]} rpc
 * @property {string} arbAddress
 * @property {string=} genericArbAddress
 * @property {string=} orderbookAddress
 * @property {string[]=} orders
 * @property {string[]} subgraph
 * @property {LiquidityProviders[]} lps
 * @property {string} gasCoverage
 * @property {string=} orderHash
 * @property {string=} orderOwner
 * @property {number} sleep
 * @property {boolean} maxRatio
 * @property {string=} flashbotRpc
 * @property {number=} timeout
 * @property {number} hops
 * @property {number} retries
 * @property {number} poolUpdateInterval
 * @property {number=} walletCount
 * @property {string=} topupAmount
 * @property {string} botMinBalance
 * @property {boolean} bundle
 */

/**
 * @typedef ConfigOptions
 * @type {object}
 * @property {number|string=} timeout
 * @property {string[]=} liquidityProviders
 * @property {string=} flashbotRpc
 * @property {boolean=} maxRatio
 * @property {boolean=} bundle
 * @property {number|string=} hops
 * @property {number|string=} retries
 * @property {number|string=} gasCoveragePercentage
 * @property {string=} genericArbAddress
 * @property {number|string=} poolUpdateInterval
 * @property {string} topupAmount
 * @property {number} walletCount
 * @property {TokenDetails[]=} watchedTokens
 */

/**
 * @typedef TokenDetails
 * @type {object}
 * @property {string} address
 * @property {number} decimals
 * @property {string} symbol
 */

/**
 * @typedef BundledOrders
 * @type {object}
 * @property {string} orderbook
 * @property {string} buyToken
 * @property {number} buyTokenDecimals
 * @property {string} buyTokenSymbol
 * @property {string} sellToken
 * @property {number} sellTokenDecimals
 * @property {string} sellTokenSymbol
 * @property {TakeOrderDetails[]} takeOrders
 */

/**
 * @typedef TakeOrderDetails
 * @type {object}
 * @property {string} id
 * @property {ethers.BigNumber=} maxOutput
 * @property {ethers.BigNumber=} ratio
 * @property {TakeOrder} takeOrder
 */

/**
 * @typedef TakeOrder
 * @type {object}
 * @property {Order} order
 * @property {number} inputIOIndex
 * @property {number} outputIOIndex
 * @property {any[]} signedContext
 */

/**
 * @typedef Evaluable
 * @type {object}
 * @property {string} interpreter
 * @property {string} store
 * @property {string} bytecode
 */

/**
 * @typedef IO
 * @type {object}
 * @property {string} token
 * @property {number} decimals
 * @property {string} vaultId
 */

/**
 * @typedef Order
 * @type {object}
 * @property {string} owner
 * @property {string} nonce
 * @property {Evaluable} evaluable
 * @property {IO[]} validInputs
 * @property {IO[]} validOutputs
 */

/**
 * @typedef ViemClient
 * @type {WalletClient<FallbackTransport, Chain, HDAccount> & PublicActions}
 */

/**
 * @typedef ChainConfig
 * @type {object}
 * @property {Chain} chain
 * @property {Token} nativeWrappedToken
 * @property {{[key: string]: string}} routeProcessors
 * @property {Token[]=} stableTokens
 */

/**
 * @typedef BotConfig
 * @type {object}
 * @property {Chain} chain
 * @property {Token} nativeWrappedToken
 * @property {{[key: string]: string}} routeProcessors
 * @property {Token[]=} stableTokens
 * @property {string=} key
 * @property {string=} mnemonic
 * @property {string[]} rpc
 * @property {string} arbAddress
 * @property {string=} genericArbAddress
 * @property {LiquidityProviders[]} lps
 * @property {boolean} maxRatio
 * @property {string=} flashbotRpc
 * @property {number=} timeout
 * @property {number} hops
 * @property {number} retries
 * @property {boolean} bundle
 * @property {string} gasCoveragePercentage
 * @property {TokenDetails[]=} watchedTokens
 * @property {PublicClient} viemClient
 * @property {DataFetcher} dataFetcher
 * @property {ViemClient} mainAccount
 * @property {(ViemClient)[]} accounts
 */

/**
 * @typedef Report
 * @type {object}
 * @property {ProcessPairReportStatus} status
 * @property {string} tokenPair
 * @property {string} buyToken
 * @property {string} sellToken
 * @property {string=} txUrl
 * @property {string=} clearedAmount
 * @property {string=} actualGasCost
 * @property {string=} inputTokenIncome
 * @property {string=} outputTokenIncome
 * @property {string[]=} clearedOrders
 * @property {ethers.BigNumber=} income
 * @property {ethers.BigNumber=} netProfit
 */

/**
 * @typedef RoundReport
 * @type {object}
 * @property {Report[]} reports
 * @property {ethers.Bignumber=} avgGasCost
 */

/**
 * @typedef ProcessPairResult
 * @type {object}
 * @property {ProcessPairHaltReason} reason
 * @property {any} error
 * @property {Report} report
 * @property {ethers.BigNumber=} gasCost
 * @property {{[key: string]: string}} spanAttributes
 */

/**
 * @typedef RawTx
 * @type {object}
 * @property {string} to
 * @property {string=} from
 * @property {string} data
 * @property {bigint=} gasPrice
 * @property {bigint=} gas
 */

/**
 * @typedef DryrunValue
 * @type {object}
 * @property {RawTx=} rawtx
 * @property {ethers.BigNumber=} maximumInput
 * @property {ethers.BigNumber=} price
 * @property {string=} routeVisual
 * @property {number=} oppBlockNumber
 * @property {ethers.BigNumber} estimatedProfit
 */

/**
 * @typedef DryrunResult
 * @type {object}
 * @property {DryrunValue} value
 * @property {number=} reason
 * @property {{[key: string]: any}} spanAttributes
 */

module.exports = {};
