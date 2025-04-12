import { BigNumber } from "ethers";
import { Token } from "sushi/currency";
import { AttributeValue } from "@opentelemetry/api";
import { DataFetcher, LiquidityProviders } from "sushi/router";
import {
    Chain,
    Account,
    HDAccount,
    TestClient,
    WalletClient,
    PublicClient,
    PublicActions,
    WalletActions,
    FallbackTransport,
    SendTransactionParameters,
} from "viem";

/**
 * Specifies reason that order process halted
 */
export enum ProcessPairHaltReason {
    FailedToQuote = 1,
    FailedToGetEthPrice = 2,
    FailedToGetPools = 3,
    TxFailed = 4,
    TxMineFailed = 5,
    TxReverted = 6,
    UnexpectedError = 7,
}

/**
 * Specifies status of an processed order report
 */
export enum ProcessPairReportStatus {
    ZeroOutput = 1,
    NoOpportunity = 2,
    FoundOpportunity = 3,
}

export type BotError = {
    snapshot: string;
    error: any;
};

export type CliOptions = {
    key?: string;
    mnemonic?: string;
    rpc: string[];
    writeRpc?: string[];
    arbAddress: string;
    genericArbAddress?: string;
    orderbookAddress?: string;
    subgraph: string[];
    lps?: string[];
    gasCoverage: string;
    orderHash?: string;
    orderOwner?: string;
    sleep: number;
    maxRatio: boolean;
    timeout?: number;
    hops: number;
    retries: number;
    poolUpdateInterval: number;
    walletCount?: number;
    topupAmount?: string;
    botMinBalance: string;
    selfFundOrders?: SelfFundOrder[];
    tokens?: TokenDetails[];
    ownerProfile?: Record<string, number>;
    publicRpc: boolean;
    route?: string;
    gasPriceMultiplier: number;
    gasLimitMultiplier: number;
    txGas?: string;
    quoteGas: bigint;
    rpOnly?: boolean;
    dispair: string;
};

export type TokenDetails = {
    address: string;
    decimals: number;
    symbol: string;
};

export type BundledOrders = {
    orderbook: string;
    buyToken: string;
    buyTokenDecimals: number;
    buyTokenSymbol: string;
    sellToken: string;
    sellTokenDecimals: number;
    sellTokenSymbol: string;
    takeOrders: TakeOrderDetails[];
};

export type TakeOrderDetails = {
    id: string;
    quote?: {
        maxOutput: BigNumber;
        ratio: BigNumber;
    };
    takeOrder: TakeOrder;
};

export type TakeOrder = {
    order: Order;
    inputIOIndex: number;
    outputIOIndex: number;
    signedContext: any[];
};

export type Evaluable = {
    interpreter: string;
    store: string;
    bytecode: string | Uint8Array;
};

export type IO = {
    token: string;
    decimals: number;
    vaultId: string;
};

export type Order = {
    owner: string;
    nonce: string;
    evaluable: Evaluable;
    validInputs: IO[];
    validOutputs: IO[];
};

export type Pair = {
    buyToken: string;
    buyTokenDecimals: number;
    buyTokenSymbol: string;
    sellToken: string;
    sellTokenDecimals: number;
    sellTokenSymbol: string;
    takeOrder: TakeOrderDetails;
};
export type OrderProfile = {
    active: boolean;
    order: Order;
    takeOrders: Pair[];
};
export type OwnerProfile = {
    limit: number;
    lastIndex: number;
    orders: OrdersProfileMap;
};
export type OrdersProfileMap = Map<string, OrderProfile>;
export type OwnersProfileMap = Map<string, OwnerProfile>;
export type OrderbooksOwnersProfileMap = Map<string, OwnersProfileMap>;

export type Vault = { vaultId: string; balance: bigint };
export type OwnersVaults = Map<string, Vault[]>;
export type TokensOwnersVaults = Map<string, OwnersVaults>;
export type OTOVMap = Map<string, TokensOwnersVaults>;

export type ViemClient = WalletClient<FallbackTransport, Chain, HDAccount> &
    PublicActions & {
        BALANCE: BigNumber;
        BOUNTY: TokenDetails[];
        BUSY: boolean;
        sendTx: <chain extends Chain, account extends Account>(
            tx: SendTransactionParameters<chain, account>,
        ) => Promise<`0x${string}`>;
    };

export type TestViemClient = TestClient<"hardhat"> &
    PublicActions &
    WalletActions & {
        BALANCE: BigNumber;
        BOUNTY: TokenDetails[];
        BUSY: boolean;
        sendTx: <chain extends Chain, account extends Account>(
            tx: SendTransactionParameters<chain, account>,
        ) => Promise<`0x${string}`>;
    };

export type BotDataFetcher = DataFetcher & { fetchedPairPools: string[] };

export type ChainConfig = {
    chain: Chain;
    nativeWrappedToken: Token;
    routeProcessors: { [key: string]: `0x${string}` };
    stableTokens?: Token[];
    isSpecialL2: boolean;
};

export type BotConfig = {
    chain: Chain;
    nativeWrappedToken: Token;
    routeProcessors: { [key: string]: `0x${string}` };
    stableTokens?: Token[];
    isSpecialL2: boolean;
    key?: string;
    mnemonic?: string;
    rpc: string[];
    writeRpc?: string[];
    arbAddress: string;
    genericArbAddress?: string;
    lps: LiquidityProviders[];
    maxRatio: boolean;
    timeout?: number;
    hops: number;
    retries: number;
    gasCoveragePercentage: string;
    watchedTokens?: TokenDetails[];
    viemClient: PublicClient;
    dataFetcher: BotDataFetcher;
    mainAccount: ViemClient;
    accounts: ViemClient[];
    selfFundOrders?: SelfFundOrder[];
    publicRpc: boolean;
    walletKey: string;
    route?: "multi" | "single";
    rpcRecords: Record<string, RpcRecord>;
    gasPriceMultiplier: number;
    gasLimitMultiplier: number;
    txGas?: string;
    quoteGas: bigint;
    rpOnly?: boolean;
    dispair: Dispair;
    onFetchRequest?: (request: Request) => void;
    onFetchResponse?: (request: Response) => void;
};

export type OperationState = {
    gasPrice: bigint;
    l1GasPrice: bigint;
};

export type Report = {
    status: ProcessPairReportStatus;
    tokenPair: string;
    buyToken: string;
    sellToken: string;
    txUrl?: string;
    clearedAmount?: string;
    actualGasCost?: string;
    inputTokenIncome?: string;
    outputTokenIncome?: string;
    clearedOrders?: string[];
    income?: BigNumber;
    netProfit?: BigNumber;
    reason?: ProcessPairHaltReason;
    error?: any;
};

export type RoundReport = {
    reports: Report[];
    avgGasCost?: BigNumber;
};

export type SpanAttrs = Record<string, AttributeValue>;

export type ProcessPairResult = {
    reason?: ProcessPairHaltReason;
    error?: any;
    report: Report;
    gasCost?: BigNumber;
    spanAttributes: SpanAttrs;
};

export type RawTx = {
    to: `0x${string}`;
    from?: `0x${string}`;
    data: `0x${string}`;
    gasPrice?: bigint;
    gas?: bigint;
    nonce?: number;
};

export type DryrunValue = {
    rawtx?: RawTx;
    maximumInput?: BigNumber;
    price?: BigNumber;
    routeVisual?: string[];
    oppBlockNumber?: number;
    estimatedProfit: BigNumber;
    noneNodeError?: string;
};

export type DryrunResult = {
    value?: DryrunValue;
    reason?: number;
    spanAttributes: SpanAttrs;
};

export type SelfFundOrder = {
    token: string;
    vaultId: string;
    threshold: string;
    topupAmount: string;
};

export type OwnedOrder = {
    id: string;
    orderbook: string;
    vaultId: string;
    token: string;
    symbol: string;
    decimals: number;
    vaultBalance: BigNumber;
};

export type SgFilter = {
    orderHash?: string;
    orderOwner?: string;
    orderbook?: string;
};

/**
 * Holds details about a RPC consumption
 */
export type RpcRecord = {
    /** Number of requests */
    req: number;
    /** Number of successful requests */
    success: number;
    /** Number of unsuccessful requests */
    failure: number;
    /** A utility cache, that can hold any data betwen separate requests */
    cache: Record<string, any>;
    /** Time between 2 consecutive requests in milliseconds */
    requestIntervals: number[];
    /** Last request timestamp in milliseconds unix format */
    lastRequestTimestamp: number;

    /** Number of timeout requests */
    get timeout(): number;
    /** Average request intervals */
    get avgRequestIntervals(): number;

    /**
     * Resets the records
     */
    reset(): void;
    /**
     * Handles a new incoming request
     */
    recordNewRequest(): void;
    /**
     * Handles a response
     * @param success - Whether or not the response is sucessful or not
     */
    recordReponse(success: boolean): void;
};
/**
 * Provides helper functions for RpcRecord type
 */
export namespace RpcRecord {
    /**
     * Creates a new instance
     */
    export function init(): RpcRecord {
        return {
            req: 0,
            success: 0,
            failure: 0,
            cache: {},
            lastRequestTimestamp: 0,
            requestIntervals: [],
            get timeout() {
                return this.req - (this.success + this.failure);
            },
            get avgRequestIntervals() {
                if (!this.requestIntervals.length) {
                    return 0;
                } else {
                    return Math.floor(
                        this.requestIntervals.reduce((a, b) => a + b, 0) /
                            this.requestIntervals.length,
                    );
                }
            },
            reset() {
                this.req = 0;
                this.success = 0;
                this.failure = 0;
                this.requestIntervals = [];
            },
            recordNewRequest() {
                this.req++;
                const now = Date.now();
                if (!this.lastRequestTimestamp) {
                    this.lastRequestTimestamp = now;
                } else {
                    const prevRequestTimestamp = this.lastRequestTimestamp;
                    this.lastRequestTimestamp = now;
                    this.requestIntervals.push(now - prevRequestTimestamp);
                }
            },
            recordReponse(success: boolean) {
                if (success) {
                    this.success++;
                } else {
                    this.failure++;
                }
            },
        };
    }
}

export type Dispair = {
    deployer: string;
    interpreter: string;
    store: string;
};

export type RpcRequest = {
    jsonrpc: `${number}`;
    method: string;
    params?: any | undefined;
    id: number;
};

export type RpcResponse<result = any, error = any> = {
    jsonrpc: `${number}`;
    id: number;
} & (RpcSuccessResult<result> | RpcErrorResult<error>);

export type RpcSuccessResult<result> = {
    method?: undefined;
    result: result;
    error?: undefined;
};

export type RpcErrorResult<error> = {
    method?: undefined;
    result?: undefined;
    error: error;
};

export const RpcErrorCode = [
    -32700, // Parse error
    -32600, // Invalid request
    -32601, // Method not found
    -32602, // Invalid params
    -32603, // Internal error
    -32000, // Invalid input
    -32001, // Resource not found
    -32002, // Resource unavailable
    -32003, // Transaction rejected
    -32004, // Method not supported
    -32005, // Limit exceeded
    -32006, // JSON-RPC version not supported
    -32042, // Method not found
] as const;

export const ProviderRpcErrorCode = [
    4001, // User Rejected Request
    4100, // Unauthorized
    4200, // Unsupported Method
    4900, // Disconnected
    4901, // Chain Disconnected
    4902, // Chain Not Recognized
] as const;

export function isOkRpcError(v: any): boolean {
    if ("error" in v && "code" in v.error) {
        const code = v.error.code;
        if (typeof code === "number") {
            return [...RpcErrorCode, ...ProviderRpcErrorCode].includes(code as any);
        } else if (typeof code === "string" && /^-?[0-9]+$/.test(code)) {
            return [...RpcErrorCode, ...ProviderRpcErrorCode].includes(Number(code) as any);
        } else return false;
    } else return false;
}

export function isRpcRequest(v: any): v is RpcRequest {
    if (
        typeof v === "object" &&
        v !== null &&
        "jsonrpc" in v &&
        "id" in v &&
        typeof v.id === "number"
    )
        return true;
    else return false;
}

export function isRpcResponse(v: any): v is RpcResponse {
    if (
        typeof v === "object" &&
        v !== null &&
        "jsonrpc" in v &&
        "id" in v &&
        typeof v.id === "number"
    )
        return true;
    else return false;
}
