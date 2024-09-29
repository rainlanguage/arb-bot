const { findOpp: findInterObOpp } = require("./interOrderbook");
const { findOpp: findIntraObOpp } = require("./intraOrderbook");
const { findOppWithRetries: findRpOpp } = require("./routeProcessor");

/**
 * @import { PublicClient } from "viem"
 * @import { DataFetcher } from "sushi"
 * @import { Token } from "sushi/currency"
 * @import { BotConfig, BundledOrders, ViemClient, DryrunValue } from "../types"
 */

/**
 * The main entrypoint for the main logic to find opps.
 * Find opps with different modes (RP, inter-ob) async, and returns the
 * span attributes and a built ready to send tx object if found any or the
 * the one that clears the most for the target order, or rejects if no opp
 * is found by returning the details in span attributes.
 * @param {{
 *  config: BotConfig,
 *  orderPairObject: BundledOrders,
 *  viemClient: PublicClient,
 *  dataFetcher: DataFetcher,
 *  signer: ViemClient,
 *  arb: ethers.Contract,
 *  genericArb: ethers.Contract,
 *  orderbooksOrders: BundledOrders[][],
 *  gasPrice: bigint,
 *  inputToEthPrice: string,
 *  outputToEthPrice: string,
 *  toToken: Token,
 *  fromToken: Token
 * }} args
 * @returns {Promise<DryrunValue>}
 */
async function findOpp({
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
}) {
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
            arb: genericArb,
            inputToEthPrice,
            outputToEthPrice,
            config,
            viemClient,
            orderbooksOrders,
        })
    ];
    const allResults = await Promise.allSettled(promises);

    if (allResults.some(v => v.status === "fulfilled")) {
        // pick and return the highest profit
        return allResults
            .filter(v => v.status === "fulfilled")
            .sort(
                (a, b) => b.value.value.estimatedProfit.lt(a.value.value.estimatedProfit)
                    ? -1
                    : b.value.value.estimatedProfit.gt(a.value.value.estimatedProfit)
                        ? 1
                        : 0
            )[0].value;
    } else {
        const spanAttributes = {};
        const result = { spanAttributes };
        if (allResults[0]?.reason?.spanAttributes) {
            console.log("find",JSON.stringify(allResults[0].reason.spanAttributes));
            spanAttributes["route-processor"] = JSON.stringify(allResults[0].reason.spanAttributes);
        }
        if (allResults[1]?.reason?.spanAttributes) {
            spanAttributes["intra-orderbook"] = JSON.stringify(
                allResults[1].reason.spanAttributes["intraOrderbook"]
            );
        }
        if (allResults[2]?.reason?.spanAttributes) {
            spanAttributes["inter-orderbook"] = JSON.stringify(allResults[2].reason.spanAttributes);
        }
        result.rawtx = undefined;
        result.oppBlockNumber = undefined;
        throw result;
    }
}

module.exports = {
    findOpp,
};