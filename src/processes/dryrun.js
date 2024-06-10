const ethers = require("ethers");
const { Router } = require("sushi/router");
const { visualizeRoute, getSpanException } = require("../utils");

/**
 * Specifies the reason that dryrun failed
 */
const DryrunHaltReason = {
    NoOpportunity: 1,
    NoWalletFund: 2,
    NoRoute: 3,
};

/**
 * Tries to find the maxInput for an arb tx by doing a binary search
 */
async function dryrun({
    mode,
    orderPairObject,
    dataFetcher,
    fromToken,
    toToken,
    signer,
    vaultBalance,
    gasPrice,
    arb,
    ethPrice,
    config,
}) {
    const spanAttributes = {};
    const result = {
        data: undefined,
        reason: undefined,
        spanAttributes,
    };
    let noRoute = true;

    const getRouteProcessorParamsVersion = {
        "3": Router.routeProcessor3Params,
        "3.1": Router.routeProcessor3_1Params,
        "3.2": Router.routeProcessor3_2Params,
        "4": Router.routeProcessor4Params,
    };
    let binarySearchLastHopSuccess = true;
    let maximumInput = vaultBalance;

    const allHopsAttributes = [];
    for (let i = 1; i < config.hops + 1; i++) {
        const hopAttrs = {};
        hopAttrs["maxInput"] = maximumInput.toString();

        const maximumInputFixed = maximumInput.mul(
            "1" + "0".repeat(18 - orderPairObject.sellTokenDecimals)
        );

        // get route details from sushi dataFetcher
        const pcMap = dataFetcher.getCurrentPoolCodeMap(
            fromToken,
            toToken
        );
        const route = Router.findBestRoute(
            pcMap,
            config.chain.id,
            fromToken,
            maximumInput.toBigInt(),
            toToken,
            gasPrice.toNumber(),
        );

        if (route.status == "NoWay") {
            hopAttrs["route"] = "no-way";
            binarySearchLastHopSuccess = false;
        }
        else {
            // if reached here, a route has been found at least once among all hops
            noRoute = false;

            const rateFixed = ethers.BigNumber.from(route.amountOutBI).mul(
                "1" + "0".repeat(18 - orderPairObject.buyTokenDecimals)
            );
            const price = rateFixed.mul("1" + "0".repeat(18)).div(maximumInputFixed);
            hopAttrs["marketPrice"] = ethers.utils.formatEther(price);

            const routeVisual = [];
            try {
                visualizeRoute(fromToken, toToken, route.legs).forEach(
                    v => {routeVisual.push(v);}
                );
            } catch {
                /**/
            }

            const rpParams = getRouteProcessorParamsVersion["3.2"](
                pcMap,
                route,
                fromToken,
                toToken,
                arb.address,
                config.routeProcessors["3.2"],
            );

            const orders = mode === 0
                ? orderPairObject.takeOrders.map(v => v.takeOrder)
                : mode === 1
                    ? [orderPairObject.takeOrders[0].takeOrder]
                    : mode === 2
                        ? [
                            orderPairObject.takeOrders[0].takeOrder,
                            orderPairObject.takeOrders[0].takeOrder
                        ]
                        : [
                            orderPairObject.takeOrders[0].takeOrder,
                            orderPairObject.takeOrders[0].takeOrder,
                            orderPairObject.takeOrders[0].takeOrder
                        ];

            const takeOrdersConfigStruct = {
                minimumInput: ethers.constants.One,
                maximumInput,
                maximumIORatio: config.maxRatio ? ethers.constants.MaxUint256 : price,
                orders,
                data: ethers.utils.defaultAbiCoder.encode(
                    ["bytes"],
                    [rpParams.routeCode]
                )
            };

            // trying to find opp with doing gas estimation, once to get gas and calculate
            // minimum sender output and second to check the arb() with headroom
            try {
                const rawtx = {
                    data: arb.interface.encodeFunctionData("arb", [takeOrdersConfigStruct, "0"]),
                    to: arb.address,
                    gasPrice
                };

                let blockNumber = await signer.provider.getBlockNumber();
                hopAttrs["blockNumber"] = blockNumber;

                let gasLimit;
                try {
                    gasLimit = await signer.estimateGas(rawtx);
                }
                catch(e) {
                    const spanError = getSpanException(e);
                    const errorString = JSON.stringify(spanError);
                    // reject early in case of no wallet fund
                    if (
                        (e.code && e.code === ethers.errors.INSUFFICIENT_FUNDS)
                        || errorString.includes("gas required exceeds allowance")
                        || errorString.includes("insufficient funds for gas")
                    ) {
                        hopAttrs["error"] = spanError;
                        result.reason = DryrunHaltReason.NoWalletFund;
                        return Promise.reject(result);
                    }
                    // only record the first error for traces
                    if (i === 1) {
                        hopAttrs["route"] = routeVisual;
                        hopAttrs["error"] = spanError;
                    }
                    throw "noopp";
                }
                gasLimit = gasLimit.mul("103").div("100");
                rawtx.gasLimit = gasLimit;
                const gasCost = gasLimit.mul(gasPrice);
                const gasCostInToken = ethers.utils.parseUnits(
                    ethPrice
                ).mul(
                    gasCost
                ).div(
                    "1" + "0".repeat(
                        36 - orderPairObject.buyTokenDecimals
                    )
                );

                // repeat the same process with heaedroom if gas
                // coverage is not 0, 0 gas coverage means 0 minimum
                // sender output which is already called above
                if (config.gasCoveragePercentage !== "0") {
                    const headroom = (
                        Number(config.gasCoveragePercentage) * 1.05
                    ).toFixed();
                    rawtx.data = arb.interface.encodeFunctionData(
                        "arb",
                        [
                            takeOrdersConfigStruct,
                            gasCostInToken.mul(headroom).div("100")
                        ]
                    );

                    blockNumber = await signer.provider.getBlockNumber();
                    hopAttrs["blockNumber"] = blockNumber;

                    try {
                        await signer.estimateGas(rawtx);
                    }
                    catch(e) {
                        const spanError = getSpanException(e);
                        const errorString = JSON.stringify(spanError);
                        // reject early in case of no wallet fund
                        if (
                            (e.code && e.code === ethers.errors.INSUFFICIENT_FUNDS)
                            || errorString.includes("gas required exceeds allowance")
                            || errorString.includes("insufficient funds for gas")
                        ) {
                            hopAttrs["error"] = spanError;
                            result.reason = DryrunHaltReason.NoWalletFund;
                            return Promise.reject(result);
                        }
                        // only record the first error for traces
                        if (i === 1) {
                            hopAttrs["route"] = routeVisual;
                            hopAttrs["gasCostInToken"] = ethers.utils.formatUnits(
                                gasCostInToken,
                                toToken.decimals
                            );
                            hopAttrs["error"] = spanError;
                        }
                        throw "noopp";
                    }
                }

                // if reached here means there was success on dryrun, so set binary
                // search last status to true, and return if there was success on
                // first attempt (ie full vault balance) or when the binary search
                // has completed
                binarySearchLastHopSuccess = true;
                if (i == 1 || i == config.hops) {
                    // allHopsAttributes is not needed in case an opp is found
                    // since all those data will be available in the submitting
                    // tx trace, as they are being returned as data for processTx()
                    spanAttributes["oppBlockNumber"] = blockNumber;
                    result.data = {
                        rawtx,
                        maximumInput,
                        gasCostInToken,
                        takeOrdersConfigStruct,
                        price,
                        routeVisual,
                        oppBlockNumber: blockNumber,
                    };
                    return result;
                }
            }
            catch (error) {
                binarySearchLastHopSuccess = false;
                // record the error in case it is an unexpected one
                if (error !== "noopp") {
                    hopAttrs["error"] = getSpanException(error);
                    // reason, code, method, transaction, error, stack, message
                }
            }
        }
        // record this hop attributes
        allHopsAttributes.push(JSON.stringify(hopAttrs));

        // set the maxInput for next hop
        maximumInput = binarySearchLastHopSuccess
            ? maximumInput.add(vaultBalance.div(2 ** i))
            : maximumInput.sub(vaultBalance.div(2 ** i));
    }
    // in case reached here, allHopsAttributes will be included
    spanAttributes["hops"] = allHopsAttributes;

    if (noRoute) result.reason = DryrunHaltReason.NoRoute;
    else result.reason = DryrunHaltReason.NoOpportunity;

    return Promise.reject(result);
}

/**
 * Tries to find opportunity for a signle order with retries and returns the best one if found any
 */
async function dryrunWithRetries({
    orderPairObject,
    dataFetcher,
    fromToken,
    toToken,
    signer,
    gasPrice,
    arb,
    ethPrice,
    config,
}) {
    const spanAttributes = {};
    const result = {
        data: undefined,
        reason: undefined,
        spanAttributes,
    };

    const promises = [];
    for (let i = 1; i < config.retries + 1; i++) {
        promises.push(
            dryrun({
                mode: i,
                orderPairObject,
                dataFetcher,
                fromToken,
                toToken,
                signer,
                vaultBalance: ethers.BigNumber.from(orderPairObject.takeOrders[0].vaultBalance),
                gasPrice,
                arb,
                ethPrice,
                config,
            })
        );
    }
    const allPromises = await Promise.allSettled(promises);
    if (allPromises.some(v => v.status === "fulfilled")) {
        let choice;
        for (let i = 0; i < allPromises.length; i++) {
            // from retries, choose the one that can clear the most
            // ie its maxInput is the greatest
            if (allPromises[i].status === "fulfilled") {
                if (
                    !choice ||
                    choice.maximumInput.lt(allPromises[i].value.data.maximumInput)
                ) {
                    // record the attributes of the choosing one
                    for (attrKey in allPromises[i].value.spanAttributes) {
                        spanAttributes[attrKey] = allPromises[i].value.spanAttributes[attrKey];
                    }
                    choice = allPromises[i].value.data;
                }
            }
        }
        result.data = choice;
        return result;
    } else {
        for (let i = 0; i < allPromises.length; i++) {
            if (allPromises[i].reason.reason === DryrunHaltReason.NoWalletFund) {
                result.reason = DryrunHaltReason.NoWalletFund;
                throw result;
            }
            if (allPromises[i].reason.reason === DryrunHaltReason.NoRoute) {
                result.reason = DryrunHaltReason.NoRoute;
                throw result;
            }
        }
        // record all retries span attributes in case neither of above errors were present
        for (attrKey in allPromises[0].reason.spanAttributes) {
            spanAttributes[attrKey] = allPromises[0].reason.spanAttributes[attrKey];
        }
        result.reason = DryrunHaltReason.NoOpportunity;
        throw result;
    }
}

module.exports = {
    dryrun,
    dryrunWithRetries,
    DryrunHaltReason,
};