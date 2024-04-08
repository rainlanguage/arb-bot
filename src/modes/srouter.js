const ethers = require("ethers");
const { arbAbis, orderbookAbi } = require("../abis");
const { Router, Token } = require("sushiswap-router");
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

    console.log(
        "------------------------- Starting The",
        "\x1b[32mS-ROUTER\x1b[0m",
        "Mode -------------------------",
        "\n"
    );
    console.log("\x1b[33m%s\x1b[0m", Date());
    console.log("Arb Contract Address: " , arbAddress);
    console.log("OrderBook Contract Address: " , orderbookAddress, "\n");

    let bundledOrders = [];
    console.log(
        "------------------------- Bundling Orders -------------------------", "\n"
    );
    bundledOrders = await tracer.startActiveSpan("preparing-orders", {}, ctx, async (span) => {
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
                config.interpreterv2,
                config.bundle,
                tracer,
                trace.setSpan(context.active(), span)
            );
            const status = {code: SpanStatusCode.OK};
            if (!result.length) status.message = "could not find any orders for current market price or with vault balance";
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

    if (!bundledOrders.length) {
        console.log("Could not find any order to clear for current market price, exiting...", "\n");
        return;
    }

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
            "details.orders": JSON.stringify(bundledOrders[i]),
            "details.pair": pair
        });

        try {
            console.log(
                `------------------------- Trying To Clear ${pair} -------------------------`,
                "\n"
            );
            console.log(`Buy Token Address: ${bundledOrders[i].buyToken}`);
            console.log(`Sell Token Address: ${bundledOrders[i].sellToken}`, "\n");

            if (!bundledOrders[i].takeOrders.length) {
                pairSpan.setStatus({code: SpanStatusCode.OK, message: "all orders have empty vault balance"});
                pairSpan.end();
                console.log("All orders of this token pair have empty vault balance, skipping...");
                continue;
            }
            console.log(">>> order ids", bundledOrders[i].takeOrders.map(v => v.id));

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

            const obSellTokenBalance = ethers.BigNumber.from(await signer.call({
                data: "0x70a08231000000000000000000000000" + orderbookAddress.slice(2),
                to: bundledOrders[i].sellToken
            }));

            if (obSellTokenBalance.isZero()) {
                pairSpan.setStatus({
                    code: SpanStatusCode.OK,
                    message: `Orderbook has no ${bundledOrders[i].sellTokenSymbol} balance`
                });
                pairSpan.end();
                console.log(
                    `Orderbook has no ${bundledOrders[i].sellTokenSymbol} balance, skipping...`
                );
                continue;
            }

            let ethPrice;
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
                    console.log("could not get gas price, skipping...");
                    return Promise.reject("could not get gas price");
                }
            });
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
                            span.recordException(new Error("could not get ETH price"));
                            span.end();
                            return Promise.reject("could not get ETH price");
                        } else {
                            span.setAttribute("details.price", ethPrice);
                            span.setStatus({code: SpanStatusCode.OK});
                            span.end();
                        }
                    } catch(e) {
                        span.setStatus({code: SpanStatusCode.ERROR });
                        span.recordException(getSpanException(e));
                        span.end();
                        console.log("could not get ETH price, skipping...");
                        return Promise.reject("could not get ETH price");
                    }
                });
            }
            else ethPrice = "0";

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
                        console.log("could not get pool details, skipping...");
                        return Promise.reject("could not get pool details");
                    }
                }
            );

            let rawtx, gasCostInToken, takeOrdersConfigStruct, price;
            if (config.bundle) {
                try {
                    ({ rawtx, gasCostInToken, takeOrdersConfigStruct, price } = await dryrun(
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
                for (let j = 1; j < 4; j++) {
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
                    ({ rawtx, gasCostInToken, takeOrdersConfigStruct, price } = choice);
                }
            }

            if (!rawtx) {
                pairSpan.setStatus({
                    code: SpanStatusCode.OK,
                    message: "could not find any opportunity to clear"
                });
                pairSpan.end();
                console.log("\x1b[31m%s\x1b[0m", "found no match for this pair...");
                continue;
            }

            try {
                pairSpan.setAttributes({
                    "details.marketPrice": ethers.utils.formatEther(price),
                    "details.takeOrdersConfigStruct": JSON.stringify(takeOrdersConfigStruct),
                    "details.gasCostInToken": ethers.utils.formatUnits(gasCostInToken, toToken.decimals),
                    "details.minBotReceivingAmount": ethers.utils.formatUnits(
                        gasCostInToken.mul(gasCoveragePercentage).div("100"),
                        toToken.decimals
                    ),
                });
                console.log(">>> Trying to submit the transaction...", "\n");
                rawtx.data = arb.interface.encodeFunctionData(
                    "arb",
                    [
                        takeOrdersConfigStruct,
                        gasCostInToken.mul(gasCoveragePercentage).div("100")
                    ]
                );

                const blockNumber = await signer.provider.getBlockNumber();
                console.log("Block Number: " + blockNumber, "\n");
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
                console.log(
                    ">>> Transaction submitted successfully to the network, waiting for transaction to mine...",
                    "\n"
                );
                console.log(tx);
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

                    console.log(
                        "\x1b[36m%s\x1b[0m",
                        `Clear Initial Price: ${ethers.utils.formatEther(price)}`
                    );
                    console.log("\x1b[36m%s\x1b[0m", `Clear Actual Price: ${clearActualPrice}`);
                    console.log("\x1b[36m%s\x1b[0m", `Clear Amount: ${
                        ethers.utils.formatUnits(
                            clearActualAmount,
                            bundledOrders[i].sellTokenDecimals
                        )
                    } ${bundledOrders[i].sellTokenSymbol}`);
                    console.log("\x1b[36m%s\x1b[0m", `Consumed Gas: ${
                        ethers.utils.formatEther(actualGasCost)
                    } ${
                        config.nativeToken.symbol
                    }`, "\n");
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
                        console.log("\x1b[35m%s\x1b[0m", `Gross Income: ${incomeFormated} ${bundledOrders[i].buyTokenSymbol}`);
                        console.log("\x1b[35m%s\x1b[0m", `Net Profit: ${netProfitFormated} ${bundledOrders[i].buyTokenSymbol}`, "\n");
                    }
                    pairSpan.setAttributes({
                        "details.clearAmount": clearActualAmount.toString(),
                        "details.clearPrice": ethers.utils.formatEther(price),
                        "details.clearActualPrice": clearActualPrice,
                    });
                    pairSpan.setStatus({ code: SpanStatusCode.OK, message: "successfuly cleared" });

                    report.push({
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
                    console.log("could not arb this pair, tx receipt: ");
                    console.log(receipt);
                }
            }
            catch (error) {
                pairSpan.recordException(getSpanException(error));
                pairSpan.setStatus({ code: SpanStatusCode.ERROR });
                console.log("\x1b[31m%s\x1b[0m", ">>> Transaction execution failed due to:");
                console.log(error, "\n");
            }
        }
        catch (error) {
            pairSpan.recordException(getSpanException(error));
            pairSpan.setStatus({ code: SpanStatusCode.ERROR });
            if (typeof error === "string") console.log("\x1b[31m%s\x1b[0m", error, "\n");
            else {
                console.log("\x1b[31m%s\x1b[0m", ">>> Something went wrong, reason:", "\n");
                console.log(error);
            }
        }
        pairSpan.end();
    }
    clearProcSpan.end();
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
    let succesOrFailure = true;
    let maximumInput = obSellTokenBalance;
    const modeText = mode === 0
        ? "bundled-orders"
        : mode === 1
            ? "single-order"
            : mode === 2
                ? "double-orders"
                : "triple-orders";

    const dryrunSpan = tracer.startSpan(`find-max-input-for-${modeText}`, undefined, ctx);
    const dryrunCtx = trace.setSpan(context.active(), dryrunSpan);

    for (let j = 1; j < hops + 1; j++) {
        const hopSpan = tracer.startSpan(`hop-${j}`, undefined, dryrunCtx);

        const maximumInputFixed = maximumInput.mul(
            "1" + "0".repeat(18 - bundledOrder.sellTokenDecimals)
        );

        hopSpan.setAttributes({
            "details.maximumInput": maximumInput.toString(),
            "details.maximumInputFixed": maximumInputFixed.toString()
        });

        console.log(`>>> Trying to arb ${modeText} with ${
            ethers.utils.formatEther(maximumInputFixed)
        } ${
            bundledOrder.sellTokenSymbol
        } as maximum input`);
        console.log(`>>> Getting best route ${modeText}`, "\n");

        const pcMap = dataFetcher.getCurrentPoolCodeMap(
            fromToken,
            toToken
        );
        const route = Router.findBestRoute(
            pcMap,
            config.chainId,
            fromToken,
            maximumInput,
            toToken,
            gasPrice.toNumber(),
            // 30e9,
            // providers,
            // poolFilter
        );
        if (route.status == "NoWay") {
            hopSpan.setAttribute("details.route", "no-way");
            hopSpan.setStatus({ code: SpanStatusCode.ERROR });
            hopSpan.end();
            succesOrFailure = false;
            console.log(
                "\x1b[31m%s\x1b[0m",
                `could not find any route for ${modeText} for this token pair for ${
                    ethers.utils.formatEther(maximumInputFixed)
                } ${
                    bundledOrder.sellTokenSymbol
                }, trying with a lower amount...`
            );
        }
        else {
            const rateFixed = route.amountOutBN.mul(
                "1" + "0".repeat(18 - bundledOrder.buyTokenDecimals)
            );
            const price = rateFixed.mul("1" + "0".repeat(18)).div(maximumInputFixed);
            hopSpan.setAttribute("details.marketPrice", ethers.utils.formatEther(price));

            // filter out orders that are not price match or failed eval when --max-profit is enabled
            // price check is at +2% as a headroom for current block vs tx block
            if (!mode && maxProfit) {
                bundledOrder.takeOrders = bundledOrder.takeOrders.filter(
                    v => v.ratio !== undefined ? price.mul("102").div("100").gte(v.ratio) : false
                );
                hopSpan.addEvent("filtered out orders with lower ratio than current market price");
            }

            if (bundledOrder.takeOrders.length === 0) {
                hopSpan.addEvent("all orders had lower ratio than current market price");
                hopSpan.end();
                maximumInput = maximumInput.sub(obSellTokenBalance.div(2 ** j));
                continue;
            }

            console.log(
                `Current best route price for ${modeText} for this token pair:`,
                `\x1b[33m${ethers.utils.formatEther(price)}\x1b[0m`,
                "\n"
            );
            console.log(`>>> Route portions for ${modeText}: `, "\n");
            const routeVisual = [];
            visualizeRoute(fromToken, toToken, route.legs).forEach(
                v => {
                    console.log("\x1b[36m%s\x1b[0m", v);
                    routeVisual.push(v);
                }
            );
            console.log("");
            hopSpan.setAttributes({
                "details.route.legs": JSON.stringify(route.legs),
                "details.route.visual": routeVisual,
            });

            const rpParams = Router.routeProcessor2Params(
                pcMap,
                route,
                fromToken,
                toToken,
                arb.address,
                config.rp32 ? config.routeProcessor3_2Address : config.routeProcessor3Address,
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
            hopSpan.setAttributes({
                "details.route.data": rpParams.routeCode,
                "details.takeOrdersConfigStruct": JSON.stringify(takeOrdersConfigStruct),
            });

            // building and submit the transaction
            try {
                const rawtx = {
                    data: arb.interface.encodeFunctionData("arb", [takeOrdersConfigStruct, "0"]),
                    to: arb.address,
                    gasPrice
                };

                const blockNumber = await signer.provider.getBlockNumber();
                hopSpan.setAttribute("details.blockNumber", blockNumber);
                console.log("Block Number: " + blockNumber, "\n");

                let gasLimit;
                try {
                    gasLimit = await signer.estimateGas(rawtx);
                    hopSpan.setAttribute("details.estimateGas.value", gasLimit.toString());
                }
                catch(e) {
                    hopSpan.recordException(getSpanException(e));
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
                hopSpan.setAttribute("details.gasCostInToken", gasCostInToken.toString());
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
                    hopSpan.setAttribute("details.headroom", gasCostInToken.mul(headroom).div("100").toString());
                    try {
                        await signer.estimateGas(rawtx);
                        hopSpan.setStatus({ code: SpanStatusCode.OK });
                    }
                    catch(e) {
                        hopSpan.recordException(getSpanException(e));
                        throw "dryrun";
                    }
                }
                succesOrFailure = true;
                if (j == 1 || j == hops) {
                    hopSpan.end();
                    dryrunSpan.setStatus({ code: SpanStatusCode.OK });
                    dryrunSpan.end();
                    return {rawtx, maximumInput, gasCostInToken, takeOrdersConfigStruct, price};
                }
            }
            catch (error) {
                succesOrFailure = false;
                hopSpan.setStatus({ code: SpanStatusCode.ERROR });
                if (error !== "nomatch" && error !== "dryrun") {
                    console.log("\x1b[31m%s\x1b[0m", `>>> Transaction for ${modeText} failed due to:`);
                    console.log(error, "\n");
                    hopSpan.recordException(getSpanException(error));
                    // reason, code, method, transaction, error, stack, message
                }
                if (j < hops) console.log(
                    "\x1b[34m%s\x1b[0m",
                    `could not clear ${modeText} with ${ethers.utils.formatEther(
                        maximumInputFixed
                    )} ${
                        bundledOrder.sellTokenSymbol
                    } as max input, trying with lower amount...`, "\n"
                );
                else {
                    console.log("\x1b[34m%s\x1b[0m", `could not arb this pair for ${modeText}`, "\n");
                }
            }
            hopSpan.end();
        }
        maximumInput = succesOrFailure
            ? maximumInput.add(obSellTokenBalance.div(2 ** j))
            : maximumInput.sub(obSellTokenBalance.div(2 ** j));
    }
    dryrunSpan.setStatus({ code: SpanStatusCode.ERROR });
    dryrunSpan.end();
    return Promise.reject();
}

module.exports = {
    srouterClear
};
