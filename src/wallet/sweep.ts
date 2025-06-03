import { WalletManager } from ".";
import { TokenDetails } from "../state";
import { PreAssembledSpan } from "../logger";
import { RainSolverSigner } from "../signer";
import { encodeFunctionData, erc20Abi } from "viem";

/**
 * Transfers the given token from the given wallet to the main wallet
 * @param this - The wallet manager
 * @param from - The wallet to transfer the token from
 * @param token - The token to transfer
 * @returns An object containing transaction hash and transferred amount
 */
export async function transferTokenFrom(
    this: WalletManager,
    from: RainSolverSigner,
    token: TokenDetails,
) {
    // exit early if the wallet has no balance of the given token
    const balance = await from.readContract({
        address: token.address as `0x${string}`,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [from.account.address],
    });
    if (balance <= 0n) return { amount: 0n };

    // check if there is enough gas for transfer and fund the wallet if not
    const gasBalance = await from.getSelfBalance();
    const cost = await from.estimateGasCost({
        to: token.address as `0x${string}`,
        data: encodeFunctionData({
            abi: erc20Abi,
            functionName: "transfer",
            args: [this.mainWallet.address, balance],
        }),
    });
    // fund slightly more to ensure there is enough gas
    const totalCost = (cost.totalGasCost * 110n) / 100n;
    if (totalCost > gasBalance) {
        await this.fundWallet(from.account.address, totalCost).catch((err) => {
            if (err instanceof PreAssembledSpan) {
                throw new Error(err.status?.message);
            } else {
                // unreachable, but satisfied
                throw err;
            }
        });
    }

    // perform the transfer transaction
    const hash = await from.writeContract({
        address: token.address as `0x${string}`,
        abi: erc20Abi,
        functionName: "transfer",
        args: [this.mainWallet.address, balance],
    });
    const receipt = await from.waitForTransactionReceipt({
        hash,
        confirmations: 4,
        timeout: 100_000,
    });
    if (receipt.status === "success") {
        return { amount: balance, txHash: hash };
    } else {
        throw {
            txHash: hash,
            error: new Error("Failed to transfer tokens, reason: transaction reverted onchain"),
        };
    }
}

/**
 * Transfers the remaining gas from the given wallet to the main wallet
 * @param this - The wallet manager
 * @param from - The wallet to transfer the remaining gas from
 * @returns An object containing transaction hash and transferred amount
 */
export async function transferRemainingGasFrom(this: WalletManager, from: RainSolverSigner) {
    const balance = await from.getSelfBalance();
    if (balance <= 0n) return { amount: 0n };

    const cost = await from.estimateGasCost({
        to: this.mainWallet.address,
        value: 0n,
    });
    const totalCost = (cost.totalGasCost * 102n) / 100n;
    if (balance > totalCost) {
        const amount = balance - totalCost;
        const hash = await from.sendTx({
            to: this.mainWallet.address,
            value: amount,
        });
        const receipt = await from.waitForTransactionReceipt({
            hash,
            confirmations: 4,
            timeout: 100_000,
        });
        if (receipt.status === "success") {
            return { amount, txHash: hash };
        } else {
            throw {
                txHash: hash,
                error: new Error(
                    "Failed to transfer remaining gas, reason: transaction reverted onchain",
                ),
            };
        }
    } else {
        return { amount: 0n };
    }
}
