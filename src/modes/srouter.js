const ethers = require("ethers");
const { Router } = require("sushi/router");
const { Token } = require("sushi/currency");
const { arbAbis, orderbookAbi } = require("../abis");
const { trace, context, SpanStatusCode } = require("@opentelemetry/api");
const {
    getIncome,
    processLps,
    getEthPrice,
    getDataFetcher,
    getActualPrice,
    visualizeRoute,
    promiseTimeout,
    bundleTakeOrders,
    getActualClearAmount,
    getSpanException
} = require("../utils");


/**
 * Main function that gets order details from subgraph, bundles the ones that have balance and tries clearing them with specialized router contract
 *
 * @param {object} config - The configuration object
 * @param {any[]} ordersDetails - The order details queried from subgraph
 * @param {string} gasCoveragePercentage - (optional) The percentage of the gas cost to cover on each transaction for it to be considered profitable and get submitted
 * @param {import("@opentelemetry/sdk-trace-base").Tracer} tracer
 * @param {import("@opentelemetry/api").Context} ctx
 * @returns The report of details of cleared orders
 */
const srouterClear = async(
    config,
    ordersDetails,
    gasCoveragePercentage = "100",
    tracer,
    ctx,
) => {
    console.log("yo");
    if (
        gasCoveragePercentage < 0 ||
        !Number.isInteger(Number(gasCoveragePercentage))
    ) throw "invalid gas coverage percentage, must be an integer greater than equal 0";

    const lps               = processLps(config.lps);
    const dataFetcher       = getDataFetcher(config, lps, false);
    const signer            = config.signer;
    const arbAddress        = config.arbAddress;
    const orderbookAddress  = config.orderbookAddress;
    const maxProfit         = config.maxProfit;
    const maxRatio          = config.maxRatio;
    const hops              = config.hops;
    const retries           = config.retries;
    const flashbotSigner    = config.flashbotRpc
        ? new ethers.Wallet(
            signer.privateKey,
            new ethers.providers.JsonRpcProvider(config.flashbotRpc)
        )
        : undefined;

    // instantiating arb contract
    const arb = new ethers.Contract(arbAddress, arbAbis["srouter"], signer);

    // instantiating orderbook contract
    const orderbook = new ethers.Contract(orderbookAddress, orderbookAbi, signer);

    let bundledOrders = [];
    bundledOrders = await tracer.startActiveSpan("check-orders-vaults", {}, ctx, async (span) => {
        span.setAttributes({
            "details.doesEval": maxProfit ?? true,
            "details.doesBundle": config.bundle
        });
        try {
            const result = await bundleTakeOrders(
                ordersDetails,
                orderbook,
                arb,
                maxProfit,
                config.shuffle,
                config.bundle,
                span
            );
            const status = {code: SpanStatusCode.OK};
            if (!result.length) status.message = "found no clearable orders";
            span.setStatus(status);
            span.end();
            return result;
        } catch (e) {
            span.setStatus({code: SpanStatusCode.ERROR });
            span.recordException(getSpanException(e));
            span.end();
            return Promise.reject(e);
        }
    });

    if (!bundledOrders.length) return;

    const report = [];
    for (let i = 0; i < bundledOrders.length; i++) {
        const pair = `${
            bundledOrders[i].buyTokenSymbol
        }/${
            bundledOrders[i].sellTokenSymbol
        }`;
        const pairSpan = tracer.startSpan(
            (config.bundle ? "bundled-orders" : "single-order") + " " + pair,
            undefined,
            ctx
        );
        const pairCtx = trace.setSpan(context.active(), pairSpan);
        pairSpan.setAttributes({
            "details.orders": bundledOrders[i].takeOrders.map(v => v.id),
            "details.pair": pair,
        });

        try {
            if (!bundledOrders[i].takeOrders.length) {
                pairSpan.setStatus({code: SpanStatusCode.OK, message: "all orders have empty vault"});
                pairSpan.end();
                continue;
            }

            const fromToken = new Token({
                chainId: config.chain.id,
                decimals: bundledOrders[i].sellTokenDecimals,
                address: bundledOrders[i].sellToken,
                symbol: bundledOrders[i].sellTokenSymbol
            });
            const toToken = new Token({
                chainId: config.chain.id,
                decimals: bundledOrders[i].buyTokenDecimals,
                address: bundledOrders[i].buyToken,
                symbol: bundledOrders[i].buyTokenSymbol
            });

            const obSellTokenBalance = ethers.BigNumber.from(await signer.call({
                data: "0x70a08231000000000000000000000000" + orderbookAddress.slice(2),
                to: bundledOrders[i].sellToken
            }));

            if (obSellTokenBalance.isZero()) {
                pairSpan.setStatus({
                    code: SpanStatusCode.OK,
                    message: `Orderbook has no ${bundledOrders[i].sellTokenSymbol}`
                });
                pairSpan.end();
                continue;
            }

            const gasPrice = await signer.provider.getGasPrice();
            pairSpan.setAttribute("details.gasPrice", gasPrice.toString());

            let ethPrice;
            if (gasCoveragePercentage !== "0") {
                await tracer.startActiveSpan("getEthPrice", {}, pairCtx, async (span) => {
                    try {
                        ethPrice = await getEthPrice(
                            config,
                            bundledOrders[i].buyToken,
                            bundledOrders[i].buyTokenDecimals,
                            gasPrice,
                            dataFetcher,
                            {
                                fetchPoolsTimeout: 10000,
                                memoize: true,
                            }
                        );
                        if (!ethPrice) {
                            span.setStatus({code: SpanStatusCode.ERROR});
                            span.recordException("could not get ETH price");
                            span.end();
                            return Promise.reject("could not get ETH price");
                        } else {
                            span.setAttribute("details.price", ethPrice);
                            span.setStatus({code: SpanStatusCode.OK});
                            span.end();
                        }
                    } catch(e) {
                        span.setStatus({code: SpanStatusCode.ERROR});
                        span.recordException(getSpanException(e));
                        span.end();
                        return Promise.reject("could not get ETH price");
                    }
                });
            }
            else ethPrice = "0";


            try {
                await dataFetcher.fetchPoolsForToken(
                    fromToken,
                    toToken,
                    undefined,
                    {
                        fetchPoolsTimeout: 30000,
                        memoize: true,
                    }
                );
            } catch (error) {
                pairSpan.addEvent("could not get pool details");
                throw error;
            }

            let rawtx, gasCostInToken, takeOrdersConfigStruct, price, routeVisual, maximumInput;
            if (config.bundle) {
                try {
                    ({
                        rawtx,
                        gasCostInToken,
                        takeOrdersConfigStruct,
                        price,
                        routeVisual,
                        maximumInput,
                    } = await dryrun(
                        0,
                        hops,
                        bundledOrders[i],
                        dataFetcher,
                        fromToken,
                        toToken,
                        signer,
                        obSellTokenBalance,
                        gasPrice,
                        gasCoveragePercentage,
                        maxProfit,
                        maxRatio,
                        arb,
                        ethPrice,
                        config,
                        tracer,
                        pairCtx
                    ));
                } catch {
                    rawtx = undefined;
                }
            } else {
                const promises = [];
                for (let j = 1; j < retries + 1; j++) {
                    promises.push(
                        dryrun(
                            j,
                            hops,
                            bundledOrders[i],
                            dataFetcher,
                            fromToken,
                            toToken,
                            signer,
                            obSellTokenBalance,
                            gasPrice,
                            gasCoveragePercentage,
                            maxProfit,
                            maxRatio,
                            arb,
                            ethPrice,
                            config,
                            tracer,
                            pairCtx
                        )
                    );
                }
                const allPromises = await Promise.allSettled(promises);

                let choice;
                for (let j = 0; j < allPromises.length; j++) {
                    if (allPromises[j].status === "fulfilled") {
                        if (!choice || choice.maximumInput.lt(allPromises[j].value.maximumInput)) {
                            choice = allPromises[j].value;
                        }
                    }
                }
                if (choice) {
                    ({
                        rawtx,
                        gasCostInToken,
                        takeOrdersConfigStruct,
                        price,
                        routeVisual,
                        maximumInput,
                    } = choice);
                }
            }

            if (!rawtx) {
                pairSpan.setStatus({
                    code: SpanStatusCode.OK,
                    message: "no opportunity"
                });
                pairSpan.end();
                continue;
            }

            try {
                pairSpan.setAttributes({
                    "details.route": routeVisual,
                    "details.maxInput": maximumInput.toString(),
                    "details.marketPrice": ethers.utils.formatEther(price),
                    "details.gasCostInToken": ethers.utils.formatUnits(gasCostInToken, toToken.decimals),
                });

                rawtx.data = arb.interface.encodeFunctionData(
                    "arb",
                    [
                        takeOrdersConfigStruct,
                        gasCostInToken.mul(gasCoveragePercentage).div("100")
                    ]
                );

                const blockNumber = await signer.provider.getBlockNumber();
                pairSpan.setAttribute("details.blockNumber", blockNumber);

                const tx = config.timeout
                    ? await promiseTimeout(
                        (flashbotSigner !== undefined
                            ? flashbotSigner.sendTransaction(rawtx)
                            : signer.sendTransaction(rawtx)),
                        config.timeout,
                        `Transaction failed to get submitted after ${config.timeout}ms`
                    )
                    : flashbotSigner !== undefined
                        ? await flashbotSigner.sendTransaction(rawtx)
                        : await signer.sendTransaction(rawtx);

                const txUrl = config.chain.blockExplorers.default.url + "/tx/" + tx.hash;
                console.log("\x1b[33m%s\x1b[0m", txUrl, "\n");
                pairSpan.setAttributes({
                    "details.txUrl": txUrl,
                    "details.tx": JSON.stringify(tx)
                });

                try {
                    const receipt = config.timeout
                        ? await promiseTimeout(
                            tx.wait(),
                            config.timeout,
                            `Transaction failed to mine after ${config.timeout}ms`
                        )
                        : await tx.wait();

                    if (receipt.status === 1) {
                        const clearActualAmount = getActualClearAmount(
                            arbAddress,
                            orderbookAddress,
                            receipt
                        );
                        const income = getIncome(signer, receipt);
                        const clearActualPrice = getActualPrice(
                            receipt,
                            orderbookAddress,
                            arbAddress,
                            clearActualAmount.mul("1" + "0".repeat(
                                18 - bundledOrders[i].sellTokenDecimals
                            )),
                            bundledOrders[i].buyTokenDecimals
                        );
                        const actualGasCost = ethers.BigNumber.from(
                            receipt.effectiveGasPrice
                        ).mul(receipt.gasUsed);
                        const actualGasCostInToken = ethers.utils.parseUnits(
                            ethPrice
                        ).mul(
                            actualGasCost
                        ).div(
                            "1" + "0".repeat(
                                36 - bundledOrders[i].buyTokenDecimals
                            )
                        );
                        const netProfit = income
                            ? income.sub(actualGasCostInToken)
                            : undefined;

                        pairSpan.setStatus({ code: SpanStatusCode.OK, message: "successfuly cleared" });

                        report.push({
                            txUrl,
                            transactionHash: receipt.transactionHash,
                            tokenPair:
                                bundledOrders[i].buyTokenSymbol +
                                "/" +
                                bundledOrders[i].sellTokenSymbol,
                            buyToken: bundledOrders[i].buyToken,
                            buyTokenDecimals: bundledOrders[i].buyTokenDecimals,
                            sellToken: bundledOrders[i].sellToken,
                            sellTokenDecimals: bundledOrders[i].sellTokenDecimals,
                            clearedAmount: clearActualAmount.toString(),
                            clearPrice: ethers.utils.formatEther(price),
                            clearActualPrice,
                            gasUsed: receipt.gasUsed,
                            gasCost: actualGasCost,
                            income,
                            netProfit,
                            clearedOrders: takeOrdersConfigStruct.orders.map(
                                v => v.id
                            ),
                        });
                    }
                    else {
                        pairSpan.setAttribute("details.receipt", JSON.stringify(receipt));
                        pairSpan.setStatus({ code: SpanStatusCode.ERROR });
                    }
                } catch (error) {
                    pairSpan.recordException(getSpanException(error));
                    pairSpan.setStatus({ code: SpanStatusCode.ERROR });
                }
            }
            catch (error) {
                pairSpan.setAttributes({
                    "details.rawTx": JSON.stringify(rawtx),
                });
                pairSpan.recordException(getSpanException(error));
                pairSpan.setStatus({ code: SpanStatusCode.ERROR });
            }
        }
        catch (error) {
            pairSpan.recordException(getSpanException(error));
            pairSpan.setStatus({ code: SpanStatusCode.ERROR });
        }
        pairSpan.end();
    }
    return report;
};

/**
 * @param {import("@opentelemetry/sdk-trace-base").Tracer} tracer
 * @param {import("@opentelemetry/api").Context} ctx
 */
async function dryrun(
    mode,
    hops,
    bundledOrder,
    dataFetcher,
    fromToken,
    toToken,
    signer,
    obSellTokenBalance,
    gasPrice,
    gasCoveragePercentage,
    maxProfit,
    maxRatio,
    arb,
    ethPrice,
    config,
    tracer,
    ctx
) {
    const getRouteProcessorParamsVersion = {
        "3": Router.routeProcessor3Params,
        "3.1": Router.routeProcessor3_1Params,
        "3.2": Router.routeProcessor3_2Params,
        "4": Router.routeProcessor4Params,
    };
    let succesOrFailure = true;
    let maximumInput = obSellTokenBalance;
    const dryrunType = mode === 0
        ? "bundle"
        : mode === 1
            ? "single"
            : mode === 2
                ? "double"
                : "triple";

    const hopsSpan = tracer.startSpan("hops", undefined, ctx);
    hopsSpan.setAttribute("details.dryrunType", dryrunType);
    const hopsDetails = {};

    for (let j = 1; j < hops + 1; j++) {
        const hopAttrs = {};
        hopAttrs["maxInput"] = maximumInput.toString();

        const maximumInputFixed = maximumInput.mul(
            "1" + "0".repeat(18 - bundledOrder.sellTokenDecimals)
        );

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
            // 30e9,
            // providers,
            // poolFilter
        );
        if (route.status == "NoWay") {
            hopAttrs["route"] = "no-way";
            succesOrFailure = false;
        }
        else {
            const rateFixed = ethers.BigNumber.from(route.amountOutBI).mul(
                "1" + "0".repeat(18 - bundledOrder.buyTokenDecimals)
            );
            const price = rateFixed.mul("1" + "0".repeat(18)).div(maximumInputFixed);
            hopAttrs["marketPrice"] = ethers.utils.formatEther(price);

            // filter out orders that are not price match or failed eval when --max-profit is enabled
            // price check is at +2% as a headroom for current block vs tx block
            if (!mode && maxProfit) {
                bundledOrder.takeOrders = bundledOrder.takeOrders.filter(
                    v => v.ratio !== undefined ? price.mul("102").div("100").gte(v.ratio) : false
                );
                hopAttrs["didRatioFilter"] = true;
            }
            if (bundledOrder.takeOrders.length === 0) {
                hopAttrs["status"] = "all orders had lower ratio than market price";
                hopsDetails[`details.hop-${j}`] = JSON.stringify(hopAttrs);
                maximumInput = maximumInput.sub(obSellTokenBalance.div(2 ** j));
                continue;
            }

            const routeVisual = [];
            try {
                visualizeRoute(fromToken, toToken, route.legs).forEach(
                    v => {routeVisual.push(v);}
                );
            } catch {
                /**/
            }
            hopAttrs["route"] = routeVisual;

            const rpParams = getRouteProcessorParamsVersion["3.2"](
                pcMap,
                route,
                fromToken,
                toToken,
                arb.address,
                config.routeProcessors["3.2"],
                // permits
                // "0.005"
            );

            const orders = mode === 0
                ? bundledOrder.takeOrders.map(v => v.takeOrder)
                : mode === 1
                    ? [bundledOrder.takeOrders[0].takeOrder]
                    : mode === 2
                        ? [
                            bundledOrder.takeOrders[0].takeOrder,
                            bundledOrder.takeOrders[0].takeOrder
                        ]
                        : [
                            bundledOrder.takeOrders[0].takeOrder,
                            bundledOrder.takeOrders[0].takeOrder,
                            bundledOrder.takeOrders[0].takeOrder
                        ];

            const takeOrdersConfigStruct = {
                minimumInput: ethers.constants.One,
                maximumInput,
                maximumIORatio: maxRatio ? ethers.constants.MaxUint256 : price,
                orders,
                data: ethers.utils.defaultAbiCoder.encode(
                    ["bytes"],
                    [rpParams.routeCode]
                )
            };

            // building and submit the transaction
            try {
                const rawtx = {
                    data: arb.interface.encodeFunctionData("arb", [takeOrdersConfigStruct, "0"]),
                    to: arb.address,
                    gasPrice
                };

                const blockNumber = await signer.provider.getBlockNumber();
                hopAttrs["blockNumber"] = blockNumber;

                let gasLimit;
                try {
                    gasLimit = await signer.estimateGas(rawtx);
                    hopAttrs["estimateGas"] = gasLimit.toString();
                }
                catch(e) {
                    // only record the last error for traces
                    if (j === hops) {
                        hopAttrs["error"] = getSpanException(e);
                    }
                    throw "nomatch";
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
                        36 - bundledOrder.buyTokenDecimals
                    )
                );
                hopAttrs["gasCostInToken"] = ethers.utils.formatUnits(
                    gasCostInToken,
                    toToken.decimals
                );
                if (gasCoveragePercentage !== "0") {
                    const headroom = (
                        Number(gasCoveragePercentage) * 1.05
                    ).toFixed();
                    rawtx.data = arb.interface.encodeFunctionData(
                        "arb",
                        [
                            takeOrdersConfigStruct,
                            gasCostInToken.mul(headroom).div("100")
                        ]
                    );
                    try {
                        await signer.estimateGas(rawtx);
                    }
                    catch(e) {
                        if (j === hops) {
                            hopAttrs["error"] = getSpanException(e);
                        }
                        throw "dryrun";
                    }
                }
                succesOrFailure = true;
                if (j == 1 || j == hops) {
                    hopsSpan.setStatus({ code: SpanStatusCode.OK });
                    hopsSpan.end();
                    return {
                        rawtx,
                        maximumInput,
                        gasCostInToken,
                        takeOrdersConfigStruct,
                        price,
                        routeVisual
                    };
                }
            }
            catch (error) {
                succesOrFailure = false;
                if (error !== "nomatch" && error !== "dryrun") {
                    hopAttrs["error"] = getSpanException(e);
                    // reason, code, method, transaction, error, stack, message
                }
            }
        }
        hopsDetails[`details.hop-${j}`] = JSON.stringify(hopAttrs);
        maximumInput = succesOrFailure
            ? maximumInput.add(obSellTokenBalance.div(2 ** j))
            : maximumInput.sub(obSellTokenBalance.div(2 ** j));
    }
    hopsSpan.setAttributes(hopsDetails);
    hopsSpan.setStatus({ code: SpanStatusCode.ERROR });
    hopsSpan.end();
    return Promise.reject();
}

module.exports = {
    srouterClear
};
