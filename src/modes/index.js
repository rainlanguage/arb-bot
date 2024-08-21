const { findOppWithRetries } = require("./routeProcessor");
const { findOpp: findInterObOpp } = require("./interOrderbook");
const { findOpp: findIntraObOpp } = require("./intraOrderbook");

/**
 * The main entrypoint for the main logic to find opps.
 * Find opps with different modes (RP, inter-ob) async, and returns the
 * span attributes and a built ready to send tx object if found any or the
 * the one that clears the most for the target order, or rejects if no opp
 * is found by returning the details in span attributes.
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
        // findOppWithRetries({
        //     orderPairObject,
        //     dataFetcher,
        //     fromToken,
        //     toToken,
        //     signer,
        //     gasPrice,
        //     arb,
        //     ethPrice: inputToEthPrice,
        //     config,
        //     viemClient,
        // }),
        findIntraObOpp({
            orderPairObject,
            signer,
            gasPrice,
            inputToEthPrice,
            outputToEthPrice,
            config,
            viemClient,
            orderbooksOrders,
        })
    ];
    if (genericArb) promises.push(findInterObOpp({
        orderPairObject,
        signer,
        gasPrice,
        arb: genericArb,
        inputToEthPrice,
        outputToEthPrice,
        config,
        viemClient,
        orderbooksOrders,
    }));
    const allResults = await Promise.allSettled(promises);
console.log(allResults.map(v => v?.value?.value?.estimatedProfit));
    if (allResults.some(v => v.status === "fulfilled")) {
        console.log("aazazazazazaz");
        const result = allResults
            .filter(v => v.status === "fulfilled")
            .sort(
                (a, b) => b.value.value.estimatedProfit.lt(a.value.value.estimatedProfit)
                    ? -1
                    : b.value.value.estimatedProfit.gt(a.value.value.estimatedProfit)
                        ? 1
                        : 0
            )[0].value;
        delete result.value.estimatedProfit;
        return result;
    } else {
        const spanAttributes = {};
        const result = { spanAttributes };
        if (
            allResults[0]?.reason?.reason === 2
            || allResults[1]?.reason?.reason === 2
            || allResults[2]?.reason?.reason === 2
        ) {
            console.log("mnmnbnmbm");
            if (allResults[0].reason?.spanAttributes?.["currentWalletBalance"]) {
                spanAttributes[
                    "currentWalletBalance"
                ] = allResults[0].reason.spanAttributes["currentWalletBalance"];
            }
            if (allResults[1]?.reason?.spanAttributes?.["currentWalletBalance"]) {
                spanAttributes[
                    "currentWalletBalance"
                ] = allResults[1]?.reason.spanAttributes["currentWalletBalance"];
            }
            if (allResults[2]?.reason?.spanAttributes?.["currentWalletBalance"]) {
                spanAttributes[
                    "currentWalletBalance"
                ] = allResults[2]?.reason.spanAttributes["currentWalletBalance"];
            }
            throw result;
        }
        console.log("oknkonokknnonon");
        if (allResults[0]?.reason?.spanAttributes) {
            spanAttributes["route-processor"] = JSON.stringify(allResults[0].reason.spanAttributes);
        }
        if (allResults[1]?.reason?.spanAttributes) {
            spanAttributes["intra-orderbook"] = JSON.stringify(allResults[1].reason.spanAttributes);
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