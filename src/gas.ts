import { BotConfig, RawTx, ViemClient } from "./types";
import { publicActionsL2, walletActionsL2 } from "viem/op-stack";

/**
 * Estimates gas cost of the given tx, also takes into account L1 gas cost if operating chain is L2.
 * Not all L2 chains need to calculate L1 gas separately, some chains like Arbitrum and Polygon zkEvm,
 * dont actually need anything extra other than usual gas estimation and they actually contain L1 gas in
 * their usual gas estimation opertaion, but some other L2 chains such as Base and Optimism, do need to
 * estimate L1 gas separately, so we will use a try/catch block
 */
export async function estimateGasCost(
    tx: RawTx,
    signer: ViemClient,
    config: BotConfig,
    l1GasPrice?: bigint,
    l1Signer?: any,
) {
    const gasPrice = tx.gasPrice ?? (await signer.getGasPrice());
    const gas = await signer.estimateGas(tx);
    if (config.isL2) {
        try {
            const l1Signer_ = l1Signer
                ? l1Signer
                : signer.extend(walletActionsL2()).extend(publicActionsL2());
            if (typeof l1GasPrice !== "bigint") {
                l1GasPrice = (await l1Signer_.getL1BaseFee()) as bigint;
            }
            const l1Gas = await l1Signer_.estimateL1Gas({
                to: tx.to,
                data: tx.data,
            });
            return {
                gas,
                gasPrice,
                l1Gas,
                l1GasPrice,
                l1Cost: l1Gas * l1GasPrice,
                totalGasCost: gasPrice * gas + l1Gas * l1GasPrice,
            };
        } catch {
            return {
                gas,
                gasPrice,
                l1Gas: 0n,
                l1GasPrice: 0n,
                l1Cost: 0n,
                totalGasCost: gasPrice * gas,
            };
        }
    } else {
        return {
            gas,
            gasPrice,
            l1Gas: 0n,
            l1GasPrice: 0n,
            l1Cost: 0n,
            totalGasCost: gasPrice * gas,
        };
    }
}

/**
 * Retruns the L1 gas cost of a transaction if operating chain is L2 else returns 0.
 * Not all L2 chains need report the L1 gas separately to the usual transaction receipt, chains
 * like Arbitrum and Polygon zkEvm report the tx used gas normally like any other L1 chain, but
 * some other L2 chains like Base and Optimism report the L1 gas separately to L2 using the properties
 * below, so we need to explicitly check for the, if they are not present in the receipt, then simply
 * return 0
 */
export function getL1Fee(receipt: any, config: BotConfig): bigint {
    if (!config.isL2) return 0n;

    if (typeof receipt.l1Fee === "bigint") {
        return receipt.l1Fee;
    } else if (typeof receipt.l1GasPrice === "bigint" && typeof receipt.l1GasUsed === "bigint") {
        return (receipt.l1GasPrice as bigint) * (receipt.l1GasUsed as bigint);
    } else {
        return 0n;
    }
}
