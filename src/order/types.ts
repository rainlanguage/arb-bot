import { OrderV3 } from "../abis";
import { decodeAbiParameters, parseAbiParameters } from "viem";

const OrderV3Abi = parseAbiParameters(OrderV3);

export type TakeOrderDetails = {
    id: string;
    quote?: {
        maxOutput: bigint;
        ratio: bigint;
    };
    takeOrder: TakeOrder;
};

export type TakeOrder = {
    order: Order;
    inputIOIndex: number;
    outputIOIndex: number;
    signedContext: any[];
};
export namespace TakeOrder {
    /** Get a QuoteConfig type from TakeOrder */
    export function getQuoteConfig(takeOrder: TakeOrder) {
        return {
            ...takeOrder,
            inputIOIndex: BigInt(takeOrder.inputIOIndex),
            outputIOIndex: BigInt(takeOrder.outputIOIndex),
        };
    }
}

export type Evaluable = {
    interpreter: `0x${string}`;
    store: `0x${string}`;
    bytecode: `0x${string}`;
};

export type IO = {
    token: `0x${string}`;
    decimals: number;
    vaultId: bigint;
};

export type Order = {
    owner: `0x${string}`;
    nonce: `0x${string}`;
    evaluable: Evaluable;
    validInputs: IO[];
    validOutputs: IO[];
};
export namespace Order {
    /** Decodes order bytes into OrderV3 struct */
    export function fromBytes(orderBytes: string): Order {
        const decoded = decodeAbiParameters(OrderV3Abi, orderBytes as `0x${string}`)[0];
        return {
            owner: decoded.owner.toLowerCase() as `0x${string}`,
            nonce: decoded.nonce.toLowerCase() as `0x${string}`,
            evaluable: {
                interpreter: decoded.evaluable.interpreter.toLowerCase() as `0x${string}`,
                store: decoded.evaluable.store.toLowerCase() as `0x${string}`,
                bytecode: decoded.evaluable.bytecode.toLowerCase() as `0x${string}`,
            },
            validInputs: decoded.validInputs.map((v: any) => ({
                token: v.token.toLowerCase() as `0x${string}`,
                decimals: v.decimals,
                vaultId: v.vaultId,
            })),
            validOutputs: decoded.validOutputs.map((v: any) => ({
                token: v.token.toLowerCase() as `0x${string}`,
                decimals: v.decimals,
                vaultId: v.vaultId,
            })),
        };
    }
}

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

export type Pair = {
    orderbook: string;
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

export type OrderbooksPairMap = Map<string, PairMap>;

export type PairMap = Map<string, Pair[]>;
