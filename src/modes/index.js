const { findOpp: findInterObOpp } = require("./interOrderbook");
const { findOppWithRetries } = require("./routeProcessor");

async function findOpp({
    orderPairObject,
    dataFetcher,
    fromToken,
    toToken,
    signer,
    gasPrice,
    arb,
    config,
    viemClient,
    ethPriceToInput,
    ethPriceToOutput,
    orderbooksOrders,
}) {
    const spanAttributes = {};
    const result = {
        value: undefined,
        spanAttributes,
    };

    const allResults = await Promise.allSettled([
        findOppWithRetries({
            orderPairObject,
            dataFetcher,
            fromToken,
            toToken,
            signer,
            gasPrice,
            arb,
            ethPrice: ethPriceToInput,
            config,
            viemClient,
        }),
        findInterObOpp({
            orderPairObject,
            signer,
            gasPrice,
            arb,
            ethPriceToInput,
            ethPriceToOutput,
            config,
            viemClient,
            orderbooksOrders,
        })
    ]);

    if (allResults.some(v => v.status === "fulfilled")) {
        if (allResults.every(v => v.status === "fulfilled")) {
            return allResults[0].value.value.maximumInput.gt(allResults[1].value.value.maximumInput)
                ? allResults[0].value
                : allResults[1].value;
        } else {
            return allResults.find(v => v.status === "fulfilled").value;
        }
    } else {
        if (allResults[0].value?.reason === 2 || allResults[1].value?.reason === 2) {
            if (allResults[0].value?.spanAttributes?.["currentWalletBalance"]) {
                spanAttributes[
                    "currentWalletBalance"
                ] = allResults[0].value.spanAttributes["currentWalletBalance"];
            }
            if (allResults[1].value?.spanAttributes?.["currentWalletBalance"]) {
                spanAttributes[
                    "currentWalletBalance"
                ] = allResults[1].value.spanAttributes["currentWalletBalance"];
            }
            throw result;
        }
        if (allResults[0].value?.spanAttributes) {
            spanAttributes["route-processor"] = JSON.stringify(allResults[0].value.spanAttributes);
        }
        if (allResults[1].value?.spanAttributes) {
            spanAttributes["inter-orderbook"] = JSON.stringify(allResults[1].value.spanAttributes);
        }
        result.rawtx = undefined;
        result.oppBlockNumber = undefined;
        return result;
    }
}

module.exports = {
    findOpp
};