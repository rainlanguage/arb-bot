import { AppOptions } from "./yaml";
import { ChainId } from "sushi/chain";
import { DeployerAbi } from "../abis";
import { processLiquidityProviders } from "./lps";
import { TokenDetails, ViemClient } from "../types";
import { ChainConfig, getChainConfig } from "./chain";
import { LiquidityProviders, RainDataFetcher } from "sushi";
import { createPublicClient, fallback, http, PublicClient } from "viem";

/**
 * Rain dispair contracts, deployer, store and interpreter
 */
export type Dispair = {
    deployer: string;
    interpreter: string;
    store: string;
};

/**
 * RainSolver configuration type, used during runtime
 */
export type RainSolverConfig = ChainConfig &
    Omit<AppOptions, "key" | "mnemonic" | "dispair" | "liquidityProviders"> & {
        /** List of supported liquidity providers */
        lps: LiquidityProviders[];
        /** Dispair, deployer, store and interpreter addresses */
        dispair: Dispair;
        /** Wallet private key or mnemonic key */
        walletKey: string;
        /** List of watched tokens at runtime */
        watchedTokens: TokenDetails[];
        /** A public viem client (without wallet functionalities) */
        viemClient: PublicClient;
        /** Sushi router DataFetcher */
        dataFetcher: RainDataFetcher;
        /** Main wallet as a viem client */
        mainAccount: ViemClient;
        /** List of worker wallets */
        accounts: ViemClient[];
    };

export namespace RainSolverConfig {
    /**
     * Tries to create a RainSolverConfig instance from the given yaml app options
     * @param options - The yaml app options
     */
    export async function tryFromAppOptions(options: AppOptions): Promise<RainSolverConfig> {
        const tempClient = createPublicClient({
            transport: fallback(options.rpc.map((v) => http(v.url))),
        });

        // get chain id and config
        const chainId = await tempClient.getChainId();
        const config = getChainConfig(chainId as ChainId) as RainSolverConfig;
        if (!config) throw `Cannot find configuration for the network with chain id: ${chainId}`;

        const interpreter = await (async () => {
            try {
                return await tempClient.readContract({
                    address: options.dispair as `0x${string}`,
                    abi: DeployerAbi,
                    functionName: "iInterpreter",
                });
            } catch {
                throw "failed to get dispair interpreter address";
            }
        })();
        const store = await (async () => {
            try {
                return await tempClient.readContract({
                    address: options.dispair as `0x${string}`,
                    abi: DeployerAbi,
                    functionName: "iStore",
                });
            } catch {
                throw "failed to get dispair store address";
            }
        })();

        config.rpc = options.rpc;
        config.arbAddress = options.arbAddress;
        config.genericArbAddress = options.genericArbAddress;
        config.timeout = options.timeout;
        config.writeRpc = options.writeRpc;
        config.maxRatio = !!options.maxRatio;
        config.hops = options.hops;
        config.retries = options.retries;
        config.gasCoveragePercentage = options.gasCoveragePercentage;
        config.lps = processLiquidityProviders(options.liquidityProviders);
        config.watchedTokens = [];
        config.selfFundOrders = options.selfFundOrders;
        config.walletKey = (options.key ?? options.mnemonic)!;
        config.route = options.route;
        config.gasPriceMultiplier = options.gasPriceMultiplier;
        config.gasLimitMultiplier = options.gasLimitMultiplier;
        config.txGas = options.txGas;
        config.quoteGas = options.quoteGas;
        config.rpOnly = options.rpOnly;
        config.dispair = {
            interpreter,
            store,
            deployer: options.dispair,
        };

        return config;
    }
}
