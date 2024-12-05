import { BotConfig, RawTx, ViemClient } from "./types";
import { publicActionsL2, walletActionsL2 } from "viem/op-stack";

/**
 * Estimates gas cost of the given tx, also takes into account L1 gas cost if the chain is a special L2.
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
    const result = {
        gas,
        gasPrice,
        l1Gas: 0n,
        l1GasPrice: 0n,
        l1Cost: 0n,
        totalGasCost: gasPrice * gas,
    };
    if (config.isSpecialL2) {
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
            result.l1Gas = l1Gas;
            result.l1GasPrice = l1GasPrice;
            result.l1Cost = l1Gas * l1GasPrice;
            result.totalGasCost += result.l1Cost;
        } catch {}
    }
    return result;
}

/**
 * Retruns the L1 gas cost of a transaction if operating chain is special L2 else returns 0.
 */
export function getL1Fee(receipt: any, config: BotConfig): bigint {
    if (!config.isSpecialL2) return 0n;

    if (typeof receipt.l1Fee === "bigint") {
        return receipt.l1Fee;
    } else if (typeof receipt.l1GasPrice === "bigint" && typeof receipt.l1GasUsed === "bigint") {
        return (receipt.l1GasPrice as bigint) * (receipt.l1GasUsed as bigint);
    } else {
        return 0n;
    }
}
