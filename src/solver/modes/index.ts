import assert from "assert";
import { RainSolver } from "..";
import { Result } from "../../result";
import { Token } from "sushi/currency";
import { BundledOrders } from "../../order";
import { FindBestTradeResult } from "../types";
import { RainSolverSigner } from "../../signer";
import { Attributes } from "@opentelemetry/api";
import { findBestRouteProcessorTrade } from "./rp";
import { findBestIntraOrderbookTrade } from "./intra";
import { findBestInterOrderbookTrade } from "./inter";
import { extendObjectWithHeader } from "../../logger";

/** Arguments for finding the best trade */
export type FindBestTradeArgs = {
    /** The order details to fin the best trade for */
    orderDetails: BundledOrders;
    /** The signer that performs the trade simulation */
    signer: RainSolverSigner;
    /** The input token price to ETH */
    inputToEthPrice: string;
    /** The output token price to ETH */
    outputToEthPrice: string;
    /** The token to be received */
    toToken: Token;
    /** The token to be traded */
    fromToken: Token;
};

/**
 * Finds and returns the most profitable trade transaction and other relevant information for the given order
 * to be broadcasted onchain.
 *
 * This function concurrently evaluates multiple trade strategies, including route processor, intra-orderbook,
 * and inter-orderbook trades. It selects the trade with the highest estimated profit among all successful
 * results. If all strategies fail, it aggregates error information and returns a comprehensive error result.
 *
 * @param this - The instance of `RainSolver`
 * @param args - The arguments required to evaluate trade options.
 */
export async function findBestTrade(
    this: RainSolver,
    args: FindBestTradeArgs,
): Promise<FindBestTradeResult> {
    const { orderDetails, signer, inputToEthPrice, outputToEthPrice, toToken, fromToken } = args;
    const promises = [
        findBestRouteProcessorTrade.call(
            this,
            orderDetails,
            signer,
            inputToEthPrice,
            toToken,
            fromToken,
        ),
        ...(!this.appOptions.rpOnly
            ? [
                  findBestIntraOrderbookTrade.call(
                      this,
                      orderDetails,
                      signer,
                      inputToEthPrice,
                      outputToEthPrice,
                  ),
                  findBestInterOrderbookTrade.call(
                      this,
                      orderDetails,
                      signer,
                      inputToEthPrice,
                      outputToEthPrice,
                  ),
              ]
            : []),
    ];
    const results = await Promise.all(promises);

    // pick the result with highest estimated profit
    if (results.some((v) => v.isOk())) {
        const pick = results.sort((a, b) => {
            if (a.isErr() && b.isErr()) return 0;
            if (a.isErr()) return 1;
            if (b.isErr()) return -1;
            return a.value.estimatedProfit < b.value.estimatedProfit
                ? 1
                : a.value.estimatedProfit > b.value.estimatedProfit
                  ? -1
                  : 0;
        })[0];

        // set the picked trade type in attrs
        assert(pick.isOk()); // just for type check as we know at least one result is ok
        pick.value.spanAttributes["tradeType"] = pick.value.type;

        return pick;
    } else {
        const spanAttributes: Attributes = {};
        let noneNodeError: string | undefined = undefined;
        for (const result of results) {
            assert(result.isErr()); // just for type check as we know all results are errors
            extendObjectWithHeader(spanAttributes, result.error.spanAttributes, result.error.type);
            if (noneNodeError === undefined) {
                noneNodeError = result.error.noneNodeError;
            }
        }
        return Result.err({
            spanAttributes,
            noneNodeError,
        });
    }
}
