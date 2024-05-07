const ethers = require("ethers");
const { Router } = require("sushi/router");
const { Token } = require("sushi/currency");
const { trace, context, SpanStatusCode } = require("@opentelemetry/api");
const { arbAbis, orderbookAbi, routeProcessor3Abi } = require("../abis");
const {
    getIncome,
    processLps,
    getEthPrice,
    getDataFetcher,
    getActualPrice,
    visualizeRoute,
    promiseTimeout,
    bundleTakeOrders,
    getSpanException
} = require("../utils");


/**
 * Main function that gets order details from subgraph, bundles the ones that have balance and tries clearing them with router contract
 *
 * @param {object} config - The configuration object
 * @param {any[]} ordersDetails - The order details queried from subgraph
 * @param {string} gasCoveragePercentage - (optional) The percentage of the gas cost to cover on each transaction
 * for it to be considered profitable and get submitted
 * @param {import("@opentelemetry/sdk-trace-base").Tracer} tracer
 * @param {import("@opentelemetry/api").Context} ctx
 * @returns The report of details of cleared orders
 */
const routerClear = async(
    config,
    ordersDetails,
    gasCoveragePercentage = "100",
    tracer,
    ctx
) => {
    if (
        gasCoveragePercentage < 0 ||
        !Number.isInteger(Number(gasCoveragePercentage))
    ) throw "invalid gas coverage percentage, must be an integer greater than equal 0";

    const lps               = processLps(config.lps);
    const dataFetcher       = getDataFetcher(config, lps, false);
    const signer            = config.signer;
    const arbAddress        = config.arbAddress;
    const orderbookAddress  = config.orderbookAddress;
    const arbType           = config.arbType;
    const flashbotSigner    = config.flashbotRpc
        ? new ethers.Wallet(
            signer.privateKey,
            new ethers.providers.JsonRpcProvider(config.flashbotRpc)
        )
        : undefined;

    // instantiating arb contract
    const arb = new ethers.Contract(arbAddress, arbAbis[arbType], signer);

    // instantiating orderbook contract
    const orderbook = new ethers.Contract(orderbookAddress, orderbookAbi, signer);

    let bundledOrders = [];
    bundledOrders = await tracer.startActiveSpan("preparing-orders", {}, ctx, async (span) => {
        span.setAttributes({
            "details.doesEval": true,
            "details.doesBundle": config.bundle
        });
        try {
            const result = await bundleTakeOrders(
                ordersDetails,
                orderbook,
                arb,
                undefined,
                config.shuffle,
                config.interpreterv2,
                config.bundle,
                tracer,
                trace.setSpan(context.active(), span)
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

    const clearProcSpan = tracer.startSpan("clear-process", undefined, ctx);
    const clearProcCtx = trace.setSpan(context.active(), clearProcSpan);

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
            clearProcCtx
        );
        const pairCtx = trace.setSpan(context.active(), pairSpan);
        pairSpan.setAttributes({
            "details.orders": bundledOrders[i].takeOrders.map(v => v.id),
            "details.pair": pair
        });

        try {
            const newBalances = await Promise.allSettled(
                bundledOrders[i].takeOrders.map(async(v) => {
                    return ethers.utils.parseUnits(
                        ethers.utils.formatUnits(
                            await orderbook.vaultBalance(
                                v.takeOrder.order.owner,
                                bundledOrders[i].sellToken,
                                v.takeOrder.order.validOutputs[
                                    v.takeOrder.outputIOIndex
                                ].vaultId
                            ),
                            bundledOrders[i].sellTokenDecimals
                        )
                    );
                })
            );
            newBalances.forEach((v, j) => {
                if (v.status === "fulfilled") {
                    if (v.value.isZero()) {
                        bundledOrders[i].takeOrders[j].quoteAmount = ethers.BigNumber.from("0");
                    }
                    else {
                        if (v.value.lt(bundledOrders[i].takeOrders[j].quoteAmount)) {
                            bundledOrders[i].takeOrders[j].quoteAmount = v.value;
                        }
                    }
                }
                else {
                    bundledOrders[i].takeOrders[j].quoteAmount = ethers.BigNumber.from("0");
                }
            });
            bundledOrders[i].takeOrders = bundledOrders[i].takeOrders.filter(
                v => !v.quoteAmount.isZero()
            );

            if (!bundledOrders[i].takeOrders.length) {
                pairSpan.setStatus({code: SpanStatusCode.OK, message: "all orders have empty vault"});
            }
            else {
                let cumulativeAmountFixed = ethers.constants.Zero;
                bundledOrders[i].takeOrders.forEach(v => {
                    cumulativeAmountFixed = cumulativeAmountFixed.add(v.quoteAmount);
                });

                const cumulativeAmount = cumulativeAmountFixed.div(
                    "1" + "0".repeat(18 - bundledOrders[i].sellTokenDecimals)
                );

                const fromToken = new Token({
                    chainId: config.chainId,
                    decimals: bundledOrders[i].sellTokenDecimals,
                    address: bundledOrders[i].sellToken,
                    symbol: bundledOrders[i].sellTokenSymbol
                });
                const toToken = new Token({
                    chainId: config.chainId,
                    decimals: bundledOrders[i].buyTokenDecimals,
                    address: bundledOrders[i].buyToken,
                    symbol: bundledOrders[i].buyTokenSymbol
                });

                const gasPrice = await tracer.startActiveSpan("getGasPrice", {}, pairCtx, async (span) => {
                    try {
                        const result = await signer.provider.getGasPrice();
                        span.setAttribute("details.price", result.toString());
                        span.setStatus({code: SpanStatusCode.OK});
                        span.end();
                        return result;
                    } catch(e) {
                        span.setStatus({code: SpanStatusCode.ERROR });
                        span.recordException(getSpanException(e));
                        span.end();
                        return Promise.reject("could not get gas price");
                    }
                });

                await tracer.startActiveSpan(
                    "fecthPools",
                    { message: "getting pool details from sushi lib for token pair"},
                    pairCtx,
                    async (span) => {
                        try {
                            await dataFetcher.fetchPoolsForToken(fromToken, toToken);
                            span.setStatus({code: SpanStatusCode.OK});
                            span.end();
                            return;
                        } catch(e) {
                            span.setStatus({code: SpanStatusCode.ERROR });
                            span.recordException(getSpanException(e));
                            span.end();
                            return Promise.reject("could not get pool details");
                        }
                    }
                );
                const pcMap = dataFetcher.getCurrentPoolCodeMap(fromToken,toToken);
                const route = Router.findBestRoute(
                    pcMap,
                    config.chainId,
                    fromToken,
                    cumulativeAmount.toBigInt(),
                    toToken,
                    gasPrice.toNumber(),
                    // 30e9,
                    // providers,
                    // poolFilter
                );
                if (route.status == "NoWay") {
                    pairSpan.setAttribute("details.route", "no-way");
                    pairSpan.setStatus({ code: SpanStatusCode.ERROR });
                    pairSpan.end();
                    continue;
                }

                const rateFixed = ethers.BigNumber.from(route.amountOutBI).mul(
                    "1" + "0".repeat(18 - bundledOrders[i].buyTokenDecimals)
                );
                const price = rateFixed.mul("1" + "0".repeat(18)).div(cumulativeAmountFixed);
                pairSpan.setAttribute("details.marketPrice", ethers.utils.formatEther(price));

                // filter take orders based on curent price and calculate final bundle quote amount
                bundledOrders[i].takeOrders = bundledOrders[i].takeOrders.filter(
                    v => price.gte(v.ratio)
                );
                pairSpan.addEvent("filtered out orders with lower ratio than current market price");

                if (!bundledOrders[i].takeOrders.length) {
                    pairSpan.addEvent("all orders had lower ratio than current market price");
                }
                else {
                    cumulativeAmountFixed = ethers.constants.Zero;
                    bundledOrders[i].takeOrders.forEach(v => {
                        cumulativeAmountFixed = cumulativeAmountFixed.add(v.quoteAmount);
                    });
                    const bundledQuoteAmount = cumulativeAmountFixed.div(
                        "1" + "0".repeat(18 - bundledOrders[i].sellTokenDecimals)
                    );

                    pairSpan.setAttributes({
                        "details.bundledQuoteAmountFixed": cumulativeAmountFixed.toString()
                    });

                    // find best route with final qoute amount and get routeProcessor params
                    // route = Router.findBestRoute(
                    //     pcMap,
                    //     config.chainId,
                    //     fromToken,
                    //     bundledQuoteAmount,
                    //     toToken,
                    //     gasPrice.toNumber(),
                    //     // 30e9
                    //     // providers,
                    //     // poolFilter
                    // );
                    // if (route.status == "NoWay") throw "could not find any route for this token pair";
                    const routeVisual = [];
                    visualizeRoute(fromToken, toToken, route.legs).forEach(
                        v => {routeVisual.push(v);}
                    );
                    pairSpan.setAttributes({
                        "details.route.visual": routeVisual,
                    });


                    const rpParams = Router.routeProcessor2Params(
                        pcMap,
                        route,
                        fromToken,
                        toToken,
                        arb.address,
                        config.rp32
                            ? config.routeProcessor3_2Address
                            : config.routeProcessor3Address,
                        // permits
                        // "0.005"
                    );
                    const takeOrdersConfigStruct = {
                        output: bundledOrders[i].buyToken,
                        input: bundledOrders[i].sellToken,
                        // for flash loan mode max and min input should be exactly the same as quoted sell
                        // amount this makes sure the cleared order amount will exactly match the 0x quote
                        minimumInput: bundledQuoteAmount,
                        maximumInput: bundledQuoteAmount,
                        maximumIORatio: ethers.constants.MaxUint256,
                        orders: bundledOrders[i].takeOrders.map(v => v.takeOrder),
                    };
                    pairSpan.setAttribute("details.route.data", rpParams.routeCode);
                    if (/^flash-loan-v3$|^order-taker$/.test(arbType)) {
                        takeOrdersConfigStruct.data = "0x00";
                        delete takeOrdersConfigStruct.output;
                        delete takeOrdersConfigStruct.input;
                        if (arbType === "flash-loan-v3") takeOrdersConfigStruct.data = "0x";
                    }

                    const dryrunSpan = tracer.startSpan("dryrun", undefined, pairCtx);
                    // building and submit the transaction
                    try {
                        const iface = new ethers.utils.Interface(routeProcessor3Abi);
                        const fnData = iface.encodeFunctionData(
                            "processRoute",
                            [
                                rpParams.tokenIn,
                                // rpParams.amountIn,
                                bundledQuoteAmount,
                                rpParams.tokenOut,
                                // rpParams.amountOutMin,
                                // guaranteedAmount,
                                ethers.BigNumber.from("0"),
                                rpParams.to,
                                rpParams.routeCode
                            ]
                        );
                        const exchangeData = ethers.utils.defaultAbiCoder.encode(
                            ["address", "address", "bytes"],
                            [
                                config.rp32
                                    ? config.routeProcessor3_2Address
                                    : config.routeProcessor3Address,
                                config.rp32
                                    ? config.routeProcessor3_2Address
                                    : config.routeProcessor3Address,
                                fnData
                            ]
                        );
                        if (arbType === "order-taker") takeOrdersConfigStruct.data = exchangeData;

                        let ethPrice;
                        if (gasCoveragePercentage !== "0") {
                            await tracer.startActiveSpan("getEthPrice", {}, pairCtx, async (span) => {
                                try {
                                    ethPrice = await getEthPrice(
                                        config,
                                        bundledOrders[i].buyToken,
                                        bundledOrders[i].buyTokenDecimals,
                                        gasPrice,
                                        dataFetcher
                                    );
                                    if (!ethPrice) {
                                        span.setStatus({code: SpanStatusCode.ERROR });
                                        span.recordException("could not get ETH price");
                                        span.end();
                                    } else {
                                        span.setAttribute("details.price", ethPrice);
                                        span.setStatus({code: SpanStatusCode.OK});
                                        span.end();
                                    }
                                } catch(e) {
                                    span.setStatus({code: SpanStatusCode.ERROR });
                                    span.recordException(getSpanException(e));
                                    span.end();
                                }
                            });
                        }
                        else ethPrice = "0";

                        if (ethPrice === undefined) {
                            pairSpan.recordException("could not get ETH price");
                        }
                        else {
                            dryrunSpan.setAttribute("details.takeOrdersConfigStruct", JSON.stringify(takeOrdersConfigStruct));
                            const rawtx = {
                                data: arb.interface.encodeFunctionData(
                                    "arb",
                                    arbType === "order-taker"
                                        ? [
                                            takeOrdersConfigStruct,
                                            "0"
                                        ]
                                        : [
                                            takeOrdersConfigStruct,
                                            "0",
                                            exchangeData
                                        ]
                                ),
                                to: arb.address,
                                gasPrice
                            };

                            const blockNumber = await signer.provider.getBlockNumber();
                            dryrunSpan.setAttribute("details.blockNumber", blockNumber);

                            let gasLimit;
                            try {
                                gasLimit = await signer.estimateGas(rawtx);
                                dryrunSpan.setAttribute("details.estimateGas.value", gasLimit.toString());
                            }
                            catch(e) {
                                dryrunSpan.recordException(getSpanException(e));
                                throw "nomatch";
                            }

                            gasLimit = gasLimit.mul("105").div("100");
                            rawtx.gasLimit = gasLimit;
                            const gasCost = gasLimit.mul(gasPrice);
                            const gasCostInToken = ethers.utils.parseUnits(
                                ethPrice
                            ).mul(
                                gasCost
                            ).div(
                                "1" + "0".repeat(
                                    36 - bundledOrders[i].buyTokenDecimals
                                )
                            );
                            dryrunSpan.setAttribute("details.gasCostInToken", gasCostInToken.toString());

                            if (gasCoveragePercentage !== "0") {
                                const headroom = (
                                    Number(gasCoveragePercentage) * 1.05
                                ).toFixed();
                                rawtx.data = arb.interface.encodeFunctionData(
                                    "arb",
                                    arbType === "order-taker"
                                        ? [
                                            takeOrdersConfigStruct,
                                            gasCostInToken.mul(headroom).div("100")
                                        ]
                                        : [
                                            takeOrdersConfigStruct,
                                            gasCostInToken.mul(headroom).div("100"),
                                            exchangeData
                                        ]
                                );
                                try {
                                    await signer.estimateGas(rawtx);
                                    dryrunSpan.setStatus({ code: SpanStatusCode.OK });
                                }
                                catch(e) {
                                    dryrunSpan.recordException(getSpanException(e));
                                    throw "dryrun";
                                }
                            }

                            try {
                                rawtx.data = arb.interface.encodeFunctionData(
                                    "arb",
                                    arbType === "order-taker"
                                        ? [
                                            takeOrdersConfigStruct,
                                            gasCostInToken.mul(gasCoveragePercentage).div("100")
                                        ]
                                        : [
                                            takeOrdersConfigStruct,
                                            gasCostInToken.mul(gasCoveragePercentage).div("100"),
                                            exchangeData
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

                                const txUrl = config.explorer + "tx/" + tx.hash;
                                console.log("\x1b[33m%s\x1b[0m", txUrl, "\n");
                                pairSpan.setAttributes({
                                    "details.txUrl": txUrl,
                                    "details.tx": JSON.stringify(tx)
                                });

                                const receipt = config.timeout
                                    ? await promiseTimeout(
                                        tx.wait(),
                                        config.timeout,
                                        `Transaction failed to mine after ${config.timeout}ms`
                                    )
                                    : await tx.wait();

                                const income = getIncome(signer, receipt);
                                const clearActualPrice = getActualPrice(
                                    receipt,
                                    orderbookAddress,
                                    arbAddress,
                                    cumulativeAmountFixed,
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
                                if (income) {
                                    const incomeFormated = ethers.utils.formatUnits(
                                        income,
                                        bundledOrders[i].buyTokenDecimals
                                    );
                                    const netProfitFormated = ethers.utils.formatUnits(
                                        netProfit,
                                        bundledOrders[i].buyTokenDecimals
                                    );
                                    pairSpan.setAttributes({
                                        "details.income": incomeFormated,
                                        "details.netProfit": netProfitFormated
                                    });
                                }
                                pairSpan.setAttributes({
                                    "details.clearAmount": bundledQuoteAmount.toString(),
                                    "details.clearPrice": ethers.utils.formatEther(price),
                                    "details.clearActualPrice": clearActualPrice,
                                });
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
                                    clearedAmount: bundledQuoteAmount.toString(),
                                    clearPrice: ethers.utils.formatEther(
                                        price
                                    ),
                                    clearActualPrice,
                                    gasUsed: receipt.gasUsed,
                                    gasCost: actualGasCost,
                                    income,
                                    netProfit,
                                    clearedOrders: bundledOrders[i].takeOrders.map(v => v.id),
                                });
                            }
                            catch (error) {
                                pairSpan.recordException(getSpanException(error));
                                pairSpan.setStatus({ code: SpanStatusCode.ERROR });
                            }
                        }
                    }
                    catch (error) {
                        if (error !== "dryrun" && error !== "nomatch") {
                            dryrunSpan.recordException(getSpanException(error));
                            // reason, code, method, transaction, error, stack, message
                        }
                    }
                    dryrunSpan.end();
                }
            }
        }
        catch (error) {
            pairSpan.recordException(getSpanException(error));
            pairSpan.setStatus({ code: SpanStatusCode.ERROR });
        }
        pairSpan.end();
    }
    clearProcSpan.end();
    return report;
};

module.exports = {
    routerClear
};