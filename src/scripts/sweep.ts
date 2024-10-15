/* eslint-disable no-console */
import { errorSnapshot } from "../error";
import { ChainId } from "sushi";
import { ethers } from "ethers";
import { sleep } from "../utils";
import { createViemClient } from "../config";
import { mnemonicToAccount } from "viem/accounts";
import { erc20Abi } from "../abis";
import { TokenDetails } from "../types";
import { setWatchedTokens } from "../account";

/**
 * Sweep wallet's tokens
 * @param mnemonic - The wallet mnemonic
 */
export async function sweepWalletTokens(
    mnemonic: string,
    tokens: TokenDetails[],
    chainId: ChainId,
    rpc: string,
    length: number,
) {
    let walletIndex = 1;
    const toWallet = await createViemClient(
        chainId as ChainId,
        [rpc],
        undefined,
        mnemonicToAccount(mnemonic, { addressIndex: 0 }),
        60_000,
    );
    console.log("main wallet ", toWallet.account.address);
    const gasPrice = ethers.BigNumber.from(await toWallet.getGasPrice())
        .mul(107)
        .div(100)
        .toBigInt();
    for (let j = 0; j < length; j++) {
        const fromWallet = await createViemClient(
            chainId as ChainId,
            [rpc],
            undefined,
            mnemonicToAccount(mnemonic, { addressIndex: walletIndex++ }),
            60_000,
        );
        await setWatchedTokens(fromWallet, tokens);
        console.log("wallet index", walletIndex - 1, fromWallet.account.address);

        // from wallet gas balance
        for (let i = 0; i < 5; i++) {
            try {
                fromWallet.BALANCE = ethers.BigNumber.from(
                    await fromWallet.getBalance({ address: fromWallet.account.address }),
                );
                break;
            } catch (error) {
                if (i === 4) throw "Failed to get gas balance";
                else await sleep(i * 10000);
            }
        }

        const erc20 = new ethers.utils.Interface(erc20Abi);
        const txs: {
            bounty: TokenDetails;
            balance: string;
            tx: {
                to: `0x${string}`;
                data: `0x${string}`;
            };
        }[] = [];
        const failedBounties: TokenDetails[] = [];
        let cumulativeGasLimit = ethers.constants.Zero;
        for (let i = 0; i < fromWallet.BOUNTY.length; i++) {
            const bounty = fromWallet.BOUNTY[i];
            try {
                const balance = ethers.BigNumber.from(
                    (
                        await fromWallet.call({
                            to: bounty.address as `0x${string}`,
                            data: erc20.encodeFunctionData("balanceOf", [
                                fromWallet.account.address,
                            ]) as `0x${string}`,
                        })
                    ).data,
                );
                if (balance.isZero()) {
                    continue;
                }
                const tx = {
                    to: bounty.address as `0x${string}`,
                    data: erc20.encodeFunctionData("transfer", [
                        toWallet.account.address,
                        balance,
                    ]) as `0x${string}`,
                };
                txs.push({
                    tx,
                    bounty,
                    balance: ethers.utils.formatUnits(balance, bounty.decimals),
                });
                const gas = await fromWallet.estimateGas(tx);
                cumulativeGasLimit = cumulativeGasLimit.add(gas);
            } catch (e) {
                failedBounties.push(bounty);
                console.log("Failed to get balance " + errorSnapshot("", e));
            }
        }

        if (cumulativeGasLimit.mul(gasPrice).gt(fromWallet.BALANCE)) {
            try {
                const transferAmount = cumulativeGasLimit.mul(gasPrice).sub(fromWallet.BALANCE);
                console.log("gas amount ", ethers.utils.formatUnits(transferAmount));
                const hash = await toWallet.sendTransaction({
                    to: fromWallet.account.address,
                    value: transferAmount.toBigInt(),
                });
                const receipt = await toWallet.waitForTransactionReceipt({
                    hash,
                    confirmations: 2,
                    timeout: 100_000,
                });
                if (receipt.status === "success") {
                    console.log("Successfully topped up");
                } else {
                    console.log(
                        "Failed topping up wallet for sweeping tokens back to main wallet: reverted",
                    );
                }
            } catch (error) {
                console.log(
                    "Failed topping up wallet for sweeping tokens back to main wallet: " +
                        errorSnapshot("", error),
                );
            }
        }

        for (let i = 0; i < txs.length; i++) {
            console.log("token ", txs[i].bounty.symbol);
            console.log("tokenAddress ", txs[i].bounty.address);
            console.log("balance ", txs[i].balance);
            try {
                const hash = await fromWallet.sendTransaction(txs[i].tx);
                const receipt = await fromWallet.waitForTransactionReceipt({
                    hash,
                    confirmations: 2,
                    timeout: 100_000,
                });
                if (receipt.status === "success") {
                    console.log("Successfully swept back to main wallet");
                } else {
                    failedBounties.push(txs[i].bounty);
                    console.log("Failed to sweep back to main wallet: reverted");
                }
            } catch (error) {
                failedBounties.push(txs[i].bounty);
                console.log("Failed to sweep back to main wallet: " + errorSnapshot("", error));
            }
        }

        // empty gas if all tokens are swept
        if (!failedBounties.length) {
            try {
                const gasLimit = ethers.BigNumber.from(
                    await fromWallet.estimateGas({
                        to: toWallet.account.address,
                        value: 0n,
                    }),
                );
                const remainingGas = ethers.BigNumber.from(
                    await fromWallet.getBalance({ address: fromWallet.account.address }),
                );
                const transferAmount = remainingGas.sub(gasLimit.mul(gasPrice));
                if (transferAmount.gt(0)) {
                    console.log("remaining gas amount ", ethers.utils.formatUnits(transferAmount));
                    const hash = await fromWallet.sendTransaction({
                        to: toWallet.account.address,
                        value: transferAmount.toBigInt(),
                        gas: gasLimit.toBigInt(),
                    });
                    const receipt = await fromWallet.waitForTransactionReceipt({
                        hash,
                        confirmations: 2,
                        timeout: 100_000,
                    });
                    if (receipt.status === "success") {
                        console.log("Successfully swept gas tokens back to main wallet");
                    } else {
                        console.log("Failed to sweep gas tokens back to main wallet: reverted");
                    }
                } else {
                    console.log("Transfer amount lower than gas cost");
                }
            } catch (error) {
                console.log(
                    "Failed to sweep gas tokens back to main wallet: " + errorSnapshot("", error),
                );
            }
        } else {
            console.log("not all tokens were swept, so did not sweep the remaining gas");
        }
        console.log("\n---\n");
    }
}
