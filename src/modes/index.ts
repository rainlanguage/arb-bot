import { Contract } from "ethers";
import { PublicClient } from "viem";
import { DataFetcher } from "sushi";
import { Token } from "sushi/currency";
import { findOpp as findInterObOpp } from "./interOrderbook";
import { findOpp as findIntraObOpp } from "./intraOrderbook";
import { findOppWithRetries as findRpOpp } from "./routeProcessor";
import { BotConfig, BundledOrders, ViemClient, DryrunResult, SpanAttrs } from "../types";

/**
 * The main entrypoint for the main logic to find opps.
 * Find opps with different modes (RP, inter-ob) async, and returns the
 * span attributes and a built ready to send tx object if found any or the
 * the one that clears the most for the target order, or rejects if no opp
 * is found by returning the details in span attributes.
 */
export async function findOpp({
    orderPairObject,
    dataFetcher,
    arb,
    genericArb,
    fromToken,
    toToken,
    signer,
    gasPrice,
    config,
    viemClient,
    inputToEthPrice,
    outputToEthPrice,
    orderbooksOrders,
}: {
    config: BotConfig;
    orderPairObject: BundledOrders;
    viemClient: PublicClient;
    dataFetcher: DataFetcher;
    signer: ViemClient;
    arb: Contract;
    genericArb: Contract | undefined;
    orderbooksOrders: BundledOrders[][];
    gasPrice: bigint;
    inputToEthPrice: string;
    outputToEthPrice: string;
    toToken: Token;
    fromToken: Token;
}): Promise<DryrunResult> {
    const promises = [
        findRpOpp({
            orderPairObject,
            dataFetcher,
            fromToken,
            toToken,
            signer,
            gasPrice,
            arb,
            ethPrice: inputToEthPrice,
            config,
            viemClient,
        }),
        findIntraObOpp({
            orderPairObject,
            signer,
            gasPrice,
            inputToEthPrice,
            outputToEthPrice,
            config,
            viemClient,
            orderbooksOrders,
        }),
        findInterObOpp({
            orderPairObject,
            signer,
            gasPrice,
            arb: genericArb!,
            inputToEthPrice,
            outputToEthPrice,
            config,
            viemClient,
            orderbooksOrders,
        }),
    ];
    const allResults = await Promise.allSettled(promises);

    if (allResults.some((v) => v.status === "fulfilled")) {
        // pick and return the highest profit
        const res = allResults.filter(
            (v) => v.status === "fulfilled",
        ) as PromiseFulfilledResult<DryrunResult>[];
        return res.sort((a, b) =>
            b.value.value!.estimatedProfit.lt(a.value.value!.estimatedProfit)
                ? -1
                : b.value.value!.estimatedProfit.gt(a.value.value!.estimatedProfit)
                  ? 1
                  : 0,
        )[0].value;
    } else {
        const spanAttributes: SpanAttrs = {};
        const result = {
            spanAttributes,
            rawtx: undefined,
            oppBlockNumber: undefined,
            noneNodeError: undefined,
        };
        if ((allResults[0] as any)?.reason?.spanAttributes) {
            spanAttributes["route-processor"] = JSON.stringify(
                (allResults[0] as any).reason.spanAttributes,
            );
        }
        if ((allResults[1] as any)?.reason?.spanAttributes) {
            spanAttributes["intra-orderbook"] = JSON.stringify(
                (allResults[1] as any).reason.spanAttributes["intraOrderbook"],
            );
        }
        if ((allResults[2] as any)?.reason?.spanAttributes) {
            spanAttributes["inter-orderbook"] = JSON.stringify(
                (allResults[2] as any).reason.spanAttributes,
            );
        }
        if (
            (allResults[0] as any)?.reason !== undefined &&
            "value" in (allResults[0] as any).reason &&
            (allResults[0] as any)?.reason?.value !== undefined &&
            "noneNodeError" in (allResults[0] as any).reason.value
        ) {
            result.noneNodeError = (allResults[0] as any).reason.value.noneNodeError;
        } else if (
            result.noneNodeError === undefined &&
            (allResults[1] as any)?.reason !== undefined &&
            "value" in (allResults[1] as any).reason &&
            (allResults[1] as any)?.reason?.value !== undefined &&
            "noneNodeError" in (allResults[1] as any).reason.value
        ) {
            result.noneNodeError = (allResults[1] as any).reason.value.noneNodeError;
        } else if (
            result.noneNodeError === undefined &&
            (allResults[2] as any)?.reason !== undefined &&
            "value" in (allResults[2] as any).reason &&
            (allResults[2] as any)?.reason?.value !== undefined &&
            "noneNodeError" in (allResults[2] as any).reason.value
        ) {
            result.noneNodeError = (allResults[2] as any).reason.value.noneNodeError;
        }
        throw result;
    }
}
