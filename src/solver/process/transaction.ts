import { BaseError } from "viem";
import { Result } from "../../result";
import { Token } from "sushi/currency";
import { containsNodeError } from "../../error";
import { sleep, withBigintSerializer } from "../../utils";
import { processReceipt, tryGetReceipt } from "./receipt";
import { RainSolverSigner, RawTransaction } from "../../signer";
import {
    ProcessOrderSuccess,
    ProcessOrderFailure,
    ProcessOrderHaltReason,
    ProcessOrderResultBase,
} from "../types";

/** Arguments for processing a transaction */
export type ProcessTransactionArgs = {
    signer: RainSolverSigner;
    rawtx: RawTransaction;
    orderbook: `0x${string}`;
    inputToEthPrice: string;
    outputToEthPrice: string;
    baseResult: ProcessOrderResultBase;
    toToken: Token;
    fromToken: Token;
};

/**
 * Handles the given transaction, starts by sending the transaction and
 * then tries to get the receipt and process that in async manner, returns
 * a function that resolves with the ProcessOrderResult type when called
 * @param args - The arguments for processing the transaction
 * @returns A function that returns a promise resolving to the ProcessOrderResult
 */
export async function processTransaction({
    rawtx,
    signer,
    toToken,
    fromToken,
    orderbook,
    baseResult,
    inputToEthPrice,
    outputToEthPrice,
}: ProcessTransactionArgs): Promise<
    () => Promise<Result<ProcessOrderSuccess, ProcessOrderFailure>>
> {
    // submit the tx
    let txhash: `0x${string}`, txUrl: string;
    let txSendTime = 0;
    const sendTx = async () => {
        txhash = await signer.asWriteSigner().sendTx({
            ...rawtx,
            type: "legacy",
        });
        txUrl = signer.state.chainConfig.blockExplorers?.default.url + "/tx/" + txhash;
        txSendTime = Date.now();
        // eslint-disable-next-line no-console
        console.log("\x1b[33m%s\x1b[0m", txUrl, "\n");
        baseResult.spanAttributes["details.txUrl"] = txUrl;
    };
    try {
        await sendTx();
    } catch (e) {
        try {
            // retry again after 5 seconds if first attempt failed
            await sleep(5000);
            await sendTx();
        } catch {
            // record rawtx in logs
            baseResult.spanAttributes["details.rawTx"] = JSON.stringify(
                {
                    ...rawtx,
                    from: signer.account.address,
                },
                withBigintSerializer,
            );
            baseResult.spanAttributes["txNoneNodeError"] = !containsNodeError(e as BaseError);
            return async () =>
                Result.err({
                    ...baseResult,
                    error: e,
                    reason: ProcessOrderHaltReason.TxFailed,
                });
        }
    }

    // start getting tx receipt in background and return the settler fn
    const receiptPromise = tryGetReceipt(signer, txhash!, txSendTime);

    return async () => {
        try {
            const receipt = await receiptPromise;
            return await processReceipt({
                receipt,
                signer,
                rawtx,
                orderbook,
                inputToEthPrice,
                outputToEthPrice,
                baseResult,
                txUrl,
                toToken,
                fromToken,
                txSendTime,
            });
        } catch (e: any) {
            baseResult.spanAttributes["details.rawTx"] = JSON.stringify(
                {
                    ...rawtx,
                    from: signer.account.address,
                },
                withBigintSerializer,
            );
            baseResult.spanAttributes["txNoneNodeError"] = !containsNodeError(e);
            return Result.err({
                ...baseResult,
                txUrl,
                reason: ProcessOrderHaltReason.TxMineFailed,
                error: e,
            });
        }
    };
}
