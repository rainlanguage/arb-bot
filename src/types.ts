import { BigNumber } from "ethers";
import { Token } from "sushi/currency";
import { AttributeValue } from "@opentelemetry/api";
import { DataFetcher, LiquidityProviders } from "sushi/router";
import { ProcessPairHaltReason, ProcessPairReportStatus } from "./processOrders";
import {
    Chain,
    FallbackTransport,
    HDAccount,
    PublicActions,
    PublicClient,
    TestClient,
    WalletActions,
    WalletClient,
} from "viem";

export type BotError = {
    snapshot: string;
    error: any;
};

export type CliOptions = {
    key?: string;
    mnemonic?: string;
    rpc: string[];
    watchRpc: string[];
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
    // active: boolean;
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
    takeOrder: TakeOrder;
};
export type OrderProfile = {
    active: boolean;
    order: Order;
    takeOrders: Pair[];
    consumedTakeOrders: Pair[];
};
export type OwnerProfile = {
    limit: number;
    orders: OrdersProfileMap;
};
export type OrdersProfileMap = Map<string, OrderProfile>;
export type OwnersProfileMap = Map<string, OwnerProfile>;
export type OrderbooksOwnersProfileMap = Map<string, OwnersProfileMap>;

export type ViemClient = WalletClient<FallbackTransport, Chain, HDAccount> &
    PublicActions & { BALANCE: BigNumber; BOUNTY: TokenDetails[] };

export type TestViemClient = TestClient<"hardhat"> &
    PublicActions &
    WalletActions & { BALANCE: BigNumber; BOUNTY: TokenDetails[] };

export type BotDataFetcher = DataFetcher & { fetchedPairPools: string[] };

export type ChainConfig = {
    chain: Chain;
    nativeWrappedToken: Token;
    routeProcessors: { [key: string]: `0x${string}` };
    stableTokens?: Token[];
};

export type BotConfig = {
    chain: Chain;
    nativeWrappedToken: Token;
    routeProcessors: { [key: string]: `0x${string}` };
    stableTokens?: Token[];
    key?: string;
    mnemonic?: string;
    rpc: string[];
    watchRpc: string[];
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
    watchClient: ViemClient;
    publicRpc: boolean;
    walletKey: string;
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
};

export type DryrunValue = {
    rawtx?: RawTx;
    maximumInput?: BigNumber;
    price?: BigNumber;
    routeVisual?: string[];
    oppBlockNumber?: number;
    estimatedProfit: BigNumber;
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
