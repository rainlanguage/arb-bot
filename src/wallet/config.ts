import { parseUnits } from "viem";
import { AppOptions } from "../config";

/** Standard base path for eth accounts */
export const BasePath = "m/44'/60'/0'/0/" as const;

/** Main account derivation index */
export const MainAccountDerivationIndex = 0 as const;

/** Represents type of a wallet, private key or mnemonic */
export enum WalletType {
    Mnemonic,
    PrivateKey,
}

/** Represents a single wallet configurations */
export type SingleWalletConfig = {
    /** Wallet key type */
    type: WalletType.PrivateKey;
    /** Wallet private key */
    key: `0x${string}`;
};

/** Represents a multi wallet configurations */
export type MultiWalletConfig = {
    /** Wallet key type */
    type: WalletType.Mnemonic;
    /** Wallet mnemonic key */
    key: string;
    /** Number of active multi wallets (except main wallet) in circulation at any given time */
    count: number;
    /** The amount that multi wallets will be topped up with when brought into circulation */
    topupAmount: bigint;
};

/** Configuration for instantiating WalletManager */
export type WalletConfig = (SingleWalletConfig | MultiWalletConfig) & {
    /** Minimum balance that main wallet needs to have before alerting */
    minBalance: bigint;
};

export namespace WalletConfig {
    export function tryFromAppOptions(options: AppOptions): WalletConfig {
        if (options.key) {
            return {
                key: (options.key.startsWith("0x")
                    ? options.key
                    : `0x${options.key}`) as `0x${string}`,
                type: WalletType.PrivateKey,
                minBalance: parseUnits(options.botMinBalance, 18),
            };
        } else {
            return {
                key: options.mnemonic!,
                type: WalletType.Mnemonic,
                count: options.walletCount!,
                minBalance: parseUnits(options.botMinBalance, 18),
                topupAmount: parseUnits(options.topupAmount!, 18),
            };
        }
    }
}
