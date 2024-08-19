const { findOpp: findInterObOpp } = require("./interOrderbook");
const { findOppWithRetries } = require("./routeProcessor");

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
    const promises = [findOppWithRetries({
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
    })];
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

    if (allResults.some(v => v.status === "fulfilled")) {
        if (allResults.length > 1 && allResults.every(v => v.status === "fulfilled")) {
            return allResults[0].value.value.maximumInput.gt(allResults[1].value.value.maximumInput)
                ? allResults[0].value
                : allResults[1].value;
        } else if (allResults[0].status === "fulfilled") {
            return allResults[0].value;
        } else if (allResults[1].status === "fulfilled") {
            return allResults[0].value;
        }
    } else {
        const spanAttributes = {};
        const result = { spanAttributes };
        if (allResults[0].reason?.reason === 2 || allResults[1]?.reason?.reason === 2) {
            if (allResults[0].reason?.spanAttributes?.["currentWalletBalance"]) {
                spanAttributes[
                    "currentWalletBalance"
                ] = allResults[0].reason.spanAttributes["currentWalletBalance"];
            }
            if (allResults[1].reason?.spanAttributes?.["currentWalletBalance"]) {
                spanAttributes[
                    "currentWalletBalance"
                ] = allResults[1].reason.spanAttributes["currentWalletBalance"];
            }
            throw result;
        }
        if (allResults[0].reason?.spanAttributes) {
            spanAttributes["route-processor"] = JSON.stringify(allResults[0].reason.spanAttributes);
        }
        if (allResults[1]?.reason?.spanAttributes) {
            spanAttributes["inter-orderbook"] = JSON.stringify(allResults[1].reason.spanAttributes);
        }
        result.rawtx = undefined;
        result.oppBlockNumber = undefined;
        throw result;
    }
}

module.exports = {
    findOpp,
};