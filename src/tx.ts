import { Token } from "sushi/currency";
import { BigNumber, Contract, ethers } from "ethers";
import { BaseError, TransactionReceipt } from "viem";
import { addWatchedToken, getNonce } from "./account";
import { containsNodeError, handleRevert } from "./error";
import { ProcessPairHaltReason, ProcessPairReportStatus } from "./processOrders";
import { BotConfig, BundledOrders, ProcessPairResult, RawTx, ViemClient } from "./types";
import {
    toNumber,
    getIncome,
    getTotalIncome,
    withBigintSerializer,
    getActualClearAmount,
    sleep,
} from "./utils";

/**
 * Handles the given transaction, starts by sending the transaction and
 * then tries to get the receipt and process that in async manner, returns
 * a function that resolves with the ProcessOrderResult type when called
 */
export async function handleTransaction(
    signer: ViemClient,
    viemClient: ViemClient,
    spanAttributes: any,
    rawtx: RawTx,
    orderbook: Contract,
    orderPairObject: BundledOrders,
    inputToEthPrice: string,
    outputToEthPrice: string,
    result: ProcessPairResult,
    pair: string,
    toToken: Token,
    fromToken: Token,
    config: BotConfig,
    writeSigner?: ViemClient,
): Promise<() => Promise<ProcessPairResult>> {
    // submit the tx
    let txhash, txUrl;
    try {
        rawtx.nonce = await getNonce(writeSigner !== undefined ? writeSigner : signer);
        if (writeSigner !== undefined) {
            rawtx.gas = undefined;
        }
        writeSigner !== undefined ? (writeSigner.BUSY = true) : (signer.BUSY = true);
        txhash =
            writeSigner !== undefined
                ? await writeSigner.sendTransaction({
                      ...rawtx,
                      type: "legacy",
                  })
                : await signer.sendTransaction({
                      ...rawtx,
                      type: "legacy",
                  });

        writeSigner !== undefined ? (writeSigner.BUSY = false) : (signer.BUSY = false);
        txUrl = config.chain.blockExplorers?.default.url + "/tx/" + txhash;
        // eslint-disable-next-line no-console
        console.log("\x1b[33m%s\x1b[0m", txUrl, "\n");
        spanAttributes["details.txUrl"] = txUrl;
    } catch (e) {
        try {
            // retry again after 5 seconds if first attempt failed
            await sleep(5000);
            rawtx.nonce = await getNonce(writeSigner !== undefined ? writeSigner : signer);
            if (writeSigner !== undefined) {
                rawtx.gas = undefined;
            }
            writeSigner !== undefined ? (writeSigner.BUSY = true) : (signer.BUSY = true);
            txhash =
                writeSigner !== undefined
                    ? await writeSigner.sendTransaction({
                          ...rawtx,
                          type: "legacy",
                      })
                    : await signer.sendTransaction({
                          ...rawtx,
                          type: "legacy",
                      });

            writeSigner !== undefined ? (writeSigner.BUSY = false) : (signer.BUSY = false);
            txUrl = config.chain.blockExplorers?.default.url + "/tx/" + txhash;
            // eslint-disable-next-line no-console
            console.log("\x1b[33m%s\x1b[0m", txUrl, "\n");
            spanAttributes["details.txUrl"] = txUrl;
        } catch {
            writeSigner !== undefined ? (writeSigner.BUSY = false) : (signer.BUSY = false);
            // record rawtx in case it is not already present in the error
            spanAttributes["details.rawTx"] = JSON.stringify(
                {
                    ...rawtx,
                    from: signer.account.address,
                },
                withBigintSerializer,
            );
            spanAttributes["txNoneNodeError"] = !containsNodeError(e as BaseError);
            result.error = e;
            result.reason = ProcessPairHaltReason.TxFailed;
            return async () => {
                throw result;
            };
        }
    }

    // start getting tx receipt in background and return the resolver fn
    const receipt = viemClient.waitForTransactionReceipt({
        hash: txhash,
        confirmations: 1,
        timeout: 120_000,
    });
    return async () => {
        // wait for tx receipt
        try {
            return handleReceipt(
                txhash,
                await receipt,
                signer,
                viemClient as any as ViemClient,
                spanAttributes,
                rawtx,
                orderbook,
                orderPairObject,
                inputToEthPrice,
                outputToEthPrice,
                result,
                txUrl,
                pair,
                toToken,
                fromToken,
                config,
            );
        } catch (e: any) {
            try {
                const newReceipt = await viemClient.getTransactionReceipt({ hash: txhash });
                if (newReceipt) {
                    return handleReceipt(
                        txhash,
                        newReceipt,
                        signer,
                        viemClient as any as ViemClient,
                        spanAttributes,
                        rawtx,
                        orderbook,
                        orderPairObject,
                        inputToEthPrice,
                        outputToEthPrice,
                        result,
                        txUrl,
                        pair,
                        toToken,
                        fromToken,
                        config,
                    );
                }
            } catch {}
            // keep track of gas consumption of the account
            let actualGasCost;
            try {
                actualGasCost = BigNumber.from(e.receipt.effectiveGasPrice).mul(e.receipt.gasUsed);
                signer.BALANCE = signer.BALANCE.sub(actualGasCost);
            } catch {
                /**/
            }
            result.report = {
                status: ProcessPairReportStatus.FoundOpportunity,
                txUrl,
                tokenPair: pair,
                buyToken: orderPairObject.buyToken,
                sellToken: orderPairObject.sellToken,
            };
            if (actualGasCost) {
                result.report.actualGasCost = ethers.utils.formatUnits(actualGasCost);
            }
            result.error = e;
            spanAttributes["details.rawTx"] = JSON.stringify(
                {
                    ...rawtx,
                    from: signer.account.address,
                },
                withBigintSerializer,
            );
            spanAttributes["txNoneNodeError"] = !containsNodeError(e);
            result.reason = ProcessPairHaltReason.TxMineFailed;
            throw result;
        }
    };
}

/**
 * Handles the tx receipt
 */
export async function handleReceipt(
    txhash: string,
    receipt: TransactionReceipt,
    signer: ViemClient,
    viemClient: ViemClient,
    spanAttributes: any,
    rawtx: RawTx,
    orderbook: Contract,
    orderPairObject: BundledOrders,
    inputToEthPrice: string,
    outputToEthPrice: string,
    result: ProcessPairResult,
    txUrl: string,
    pair: string,
    toToken: Token,
    fromToken: Token,
    config: BotConfig,
) {
    const actualGasCost = ethers.BigNumber.from(receipt.effectiveGasPrice).mul(receipt.gasUsed);
    const signerBalance = signer.BALANCE;
    signer.BALANCE = signer.BALANCE.sub(actualGasCost);
    if (receipt.status === "success") {
        spanAttributes["didClear"] = true;

        const clearActualAmount = getActualClearAmount(rawtx.to, orderbook.address, receipt);

        const inputTokenIncome = getIncome(
            signer.account.address,
            receipt,
            orderPairObject.buyToken,
        );
        const outputTokenIncome = getIncome(
            signer.account.address,
            receipt,
            orderPairObject.sellToken,
        );
        const income = getTotalIncome(
            inputTokenIncome,
            outputTokenIncome,
            inputToEthPrice,
            outputToEthPrice,
            orderPairObject.buyTokenDecimals,
            orderPairObject.sellTokenDecimals,
        );
        const netProfit = income ? income.sub(actualGasCost) : undefined;

        if (income) {
            spanAttributes["details.income"] = toNumber(income);
            spanAttributes["details.netProfit"] = toNumber(netProfit!);
            spanAttributes["details.actualGasCost"] = toNumber(actualGasCost);
        }
        if (inputTokenIncome) {
            spanAttributes["details.inputTokenIncome"] = ethers.utils.formatUnits(
                inputTokenIncome,
                orderPairObject.buyTokenDecimals,
            );
        }
        if (outputTokenIncome) {
            spanAttributes["details.outputTokenIncome"] = ethers.utils.formatUnits(
                outputTokenIncome,
                orderPairObject.sellTokenDecimals,
            );
        }

        result.report = {
            status: ProcessPairReportStatus.FoundOpportunity,
            txUrl,
            tokenPair: pair,
            buyToken: orderPairObject.buyToken,
            sellToken: orderPairObject.sellToken,
            clearedAmount: clearActualAmount?.toString(),
            actualGasCost: ethers.utils.formatUnits(actualGasCost),
            income,
            inputTokenIncome: inputTokenIncome
                ? ethers.utils.formatUnits(inputTokenIncome, toToken.decimals)
                : undefined,
            outputTokenIncome: outputTokenIncome
                ? ethers.utils.formatUnits(outputTokenIncome, fromToken.decimals)
                : undefined,
            netProfit,
            clearedOrders: orderPairObject.takeOrders.map((v) => v.id),
        };

        // keep track of gas consumption of the account and bounty token
        result.gasCost = actualGasCost;
        if (inputTokenIncome && inputTokenIncome.gt(0)) {
            const tkn = {
                address: orderPairObject.buyToken.toLowerCase(),
                decimals: orderPairObject.buyTokenDecimals,
                symbol: orderPairObject.buyTokenSymbol,
            };
            addWatchedToken(tkn, config.watchedTokens ?? [], signer);
        }
        if (outputTokenIncome && outputTokenIncome.gt(0)) {
            const tkn = {
                address: orderPairObject.sellToken.toLowerCase(),
                decimals: orderPairObject.sellTokenDecimals,
                symbol: orderPairObject.sellTokenSymbol,
            };
            addWatchedToken(tkn, config.watchedTokens ?? [], signer);
        }
        return result;
    } else {
        const simulation = await handleRevert(
            viemClient as any,
            txhash as `0x${string}`,
            receipt,
            rawtx,
            signerBalance,
        );
        if (simulation) {
            result.error = simulation;
            spanAttributes["txNoneNodeError"] = !simulation.nodeError;
        }
        result.report = {
            status: ProcessPairReportStatus.FoundOpportunity,
            txUrl,
            tokenPair: pair,
            buyToken: orderPairObject.buyToken,
            sellToken: orderPairObject.sellToken,
            actualGasCost: ethers.utils.formatUnits(actualGasCost),
        };
        result.reason = ProcessPairHaltReason.TxReverted;
        return Promise.reject(result);
    }
}
