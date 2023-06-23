const ethers = require("ethers");
const { Router } = require("@sushiswap/router");
const { Token } = require("@sushiswap/currency");
const { arbAbi, orderbookAbi, routeProcessor3Abi } = require("./abis");
const {
    getIncome,
    processLps,
    getEthPrice,
    getDataFetcher,
    getActualPrice,
    estimateProfit,
    bundleTakeOrders,
    fetchPoolsForTokenWrapper
} = require("./utils");


/**
 * Prepares the bundled orders by getting the best deals from Router and sorting the
 * bundled orders based on the best deals
 *
 * @param {any[]} bundledOrders - The bundled orders array
 * @param {any} dataFetcher - The DataFetcher instance
 * @param {any} config - The network config data
 * @param {ethers.BigNumber} gasPrice - The network gas price
 * @param {boolean} sort - (optional) Sort based on best deals or not
 */
const prepare = async(bundledOrders, dataFetcher, config, gasPrice, sort = true) => {
    for (let i = 0; i < bundledOrders.length; i++) {
        const bOrder = bundledOrders[i];
        const pair = bOrder.buyTokenSymbol + "/" + bOrder.sellTokenSymbol;
        try {
            let cumulativeAmountFixed = ethers.constants.Zero;
            bOrder.takeOrders.forEach(v => {
                cumulativeAmountFixed = cumulativeAmountFixed.add(v.quoteAmount);
            });
            const cumulativeAmount = cumulativeAmountFixed.div(
                "1" + "0".repeat(18 - bOrder.sellTokenDecimals)
            );
            const fromToken = new Token({
                chainId: config.chainId,
                decimals: bOrder.sellTokenDecimals,
                address: bOrder.sellToken,
                symbol: bOrder.sellTokenSymbol
            });
            const toToken = new Token({
                chainId: config.chainId,
                decimals: bOrder.buyTokenDecimals,
                address: bOrder.buyToken,
                symbol: bOrder.buyTokenSymbol
            });
            await fetchPoolsForTokenWrapper(dataFetcher, fromToken, toToken);
            const pcMap = dataFetcher.getCurrentPoolCodeMap(fromToken, toToken);
            const route = Router.findBestRoute(
                pcMap,
                config.chainId,
                fromToken,
                cumulativeAmount,
                toToken,
                gasPrice.toNumber(),
                // providers,
                // poolFilter
            );
            if (route.status == "NoWay") throw "could not find any route for this token pair";

            const rateFixed = route.amountOutBN.mul("1" + "0".repeat(18 - bOrder.buyTokenDecimals));
            const price = rateFixed.mul("1" + "0".repeat(18)).div(cumulativeAmountFixed);
            bOrder.initPrice = price;

            console.log(`Current market price for ${pair}: ${ethers.utils.formatEther(price)}`);
            console.log("Current ratio of the orders in this token pair:");
            bOrder.takeOrders.forEach(v => {
                console.log(ethers.utils.formatEther(v.ratio));
            });
            bOrder.takeOrders = bOrder.takeOrders.filter(
                v => price.gte(v.ratio)
            );
            console.log("\n");
        }
        catch(error) {
            console.log(`>>> could not get price for this ${pair} due to:`);
            console.log(error);
        }
    }
    console.log(
        ">>> Filtering bundled orders with lower ratio than current market price...",
        "\n"
    );
    bundledOrders = bundledOrders.filter(v => v.initPrice && v.takeOrders.length > 0);
    if (sort) {
        console.log("\n", ">>> Sorting the bundled orders based on initial prices...");
        bundledOrders.sort(
            (a, b) => a.initPrice.gt(b.initPrice) ? -1 : a.initPrice.lt(b.initPrice) ? 1 : 0
        );
    }
};

/**
 * Main function that gets order details from subgraph, bundles the ones that have balance and tries clearing them with router contract
 *
 * @param {object} config - The configuration object
 * @param {any[]} ordersDetails - The order details queried from subgraph
 * @param {string} gasCoveragePercentage - (optional) The percentage of the gas cost to cover on each transaction
 * for it to be considered profitable and get submitted
 * @param {boolean} prioritization - (optional) Prioritize better deals to get cleared first, default is true
 * @returns The report of details of cleared orders
 */
exports.routerClear = async(
    config,
    ordersDetails,
    gasCoveragePercentage = "100",
    prioritization = true
) => {
    if (
        gasCoveragePercentage < 0 ||
        !Number.isInteger(Number(gasCoveragePercentage))
    ) throw "invalid gas coverage percentage, must be an integer greater than equal 0";
    if (typeof prioritization !== "boolean") throw "invalid value for 'prioritization'";

    const dataFetcher = getDataFetcher(config, processLps(config.lps));
    const signer = config.signer;
    const arbAddress = config.arbAddress;
    const orderbookAddress = config.orderbookAddress;

    // instantiating arb contract
    const arb = new ethers.Contract(arbAddress, arbAbi, signer);

    // instantiating orderbook contract
    const orderbook = new ethers.Contract(orderbookAddress, orderbookAbi, signer);

    const gasPrice = await signer.provider.getGasPrice();

    console.log(
        "------------------------- Starting Clearing Process -------------------------",
        "\n"
    );
    console.log(Date());
    console.log("Arb Contract Address: " , arbAddress);
    console.log("OrderBook Contract Address: " , orderbookAddress, "\n");

    let bundledOrders = [];
    if (ordersDetails.length) {
        console.log(
            "------------------------- Bundling Orders -------------------------", "\n"
        );
        bundledOrders = await bundleTakeOrders(ordersDetails, orderbook, arb);
        console.log(
            "------------------------- Getting Best Deals From RouteProcessor3 -------------------------",
            "\n"
        );
        await prepare(bundledOrders, dataFetcher, config, gasPrice, prioritization);
    }
    else {
        console.log("No orders found, exiting...", "\n");
        return;
    }

    if (!bundledOrders.length) {
        console.log("Could not find any order to clear for current market price, exiting...", "\n");
        return;
    }

    console.log(
        "------------------------- Trying To Clear Bundled Orders -------------------------",
        "\n"
    );

    const report = [];
    for (let i = 0; i < bundledOrders.length; i++) {
        try {
            console.log(
                `------------------------- Trying To Clear ${
                    bundledOrders[i].buyTokenSymbol
                }/${
                    bundledOrders[i].sellTokenSymbol
                } -------------------------`,
                "\n"
            );
            console.log(`Buy Token Address: ${bundledOrders[i].buyToken}`);
            console.log(`Sell Token Address: ${bundledOrders[i].sellToken}`, "\n");

            console.log(">>> Updating vault balances...", "\n");
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
                    console.log(`Could not get vault balance for order ${
                        bundledOrders[i].takeOrders[j].id
                    } due to:`);
                    console.log(v.reason);
                    bundledOrders[i].takeOrders[j].quoteAmount = ethers.BigNumber.from("0");
                }
            });
            bundledOrders[i].takeOrders = bundledOrders[i].takeOrders.filter(
                v => !v.quoteAmount.isZero()
            );


            if (!bundledOrders[i].takeOrders.length) console.log(
                "All orders of this token pair have empty vault balance, skipping...",
                "\n"
            );
            else {
                console.log(">>> Getting best route for this token pair", "\n");

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

                await fetchPoolsForTokenWrapper(dataFetcher, fromToken, toToken);
                const pcMap = dataFetcher.getCurrentPoolCodeMap(fromToken, toToken);
                let route = Router.findBestRoute(
                    pcMap,
                    config.chainId,
                    fromToken,
                    cumulativeAmount,
                    toToken,
                    gasPrice.toNumber(),
                    // 30e9,
                    // providers,
                    // poolFilter
                );
                if (route.status == "NoWay") throw "could not find any route for this token pair";

                const rateFixed = route.amountOutBN.mul(
                    "1" + "0".repeat(18 - bundledOrders[i].buyTokenDecimals)
                );
                const price = rateFixed.mul("1" + "0".repeat(18)).div(cumulativeAmountFixed);
                console.log(`Current best route price for this token pair: ${ethers.utils.formatEther(price)}`, "\n");

                // filter take orders based on curent price and calculate final bundle quote amount
                bundledOrders[i].takeOrders = bundledOrders[i].takeOrders.filter(
                    v => price.gte(v.ratio)
                );
                if (!bundledOrders[i].takeOrders.length) console.log(
                    "All orders of this token pair have higher ratio than current market price, skipping...",
                    "\n"
                );
                else {
                    cumulativeAmountFixed = ethers.constants.Zero;
                    bundledOrders[i].takeOrders.forEach(v => {
                        cumulativeAmountFixed = cumulativeAmountFixed.add(v.quoteAmount);
                    });
                    const bundledQuoteAmount = cumulativeAmountFixed.div(
                        "1" + "0".repeat(18 - bundledOrders[i].sellTokenDecimals)
                    );

                    // find best route with final qoute amount and get routeProcessor params
                    route = Router.findBestRoute(
                        pcMap,
                        config.chainId,
                        fromToken,
                        bundledQuoteAmount,
                        toToken,
                        gasPrice.toNumber(),
                        // 30e9
                        // providers,
                        // poolFilter
                    );
                    if (route.status == "NoWay") throw "could not find any route for this token pair";
                    let routeText = "";
                    route.legs.forEach((v, i) => {
                        if (i === 0) routeText =
                            routeText +
                            v.tokenTo.symbol +
                            "/" +
                            v.tokenFrom.symbol +
                            "(" +
                            v.poolName +
                            ")";
                        else routeText =
                            routeText +
                            " + " +
                            v.tokenTo.symbol +
                            "/" +
                            v.tokenFrom.symbol +
                            "(" +
                            v.poolName +
                            ")";
                    });
                    console.log(">>> Route portions: ", routeText);
                    const rpParams = Router.routeProcessor2Params(
                        pcMap,
                        route,
                        fromToken,
                        toToken,
                        arb.address,
                        config.routeProcessor3Address,
                        // permits
                        // "0.005"
                    );

                    const takeOrdersConfigStruct = {
                        output: bundledOrders[i].buyToken,
                        input: bundledOrders[i].sellToken,
                        // max and min input should be exactly the same as quoted sell amount
                        // this makes sure the cleared order amount will exactly match the 0x quote
                        minimumInput: bundledQuoteAmount,
                        maximumInput: bundledQuoteAmount,
                        maximumIORatio: ethers.constants.MaxUint256,
                        orders: bundledOrders[i].takeOrders.map(v => v.takeOrder),
                    };

                    // submit the transaction
                    try {
                        // const guaranteedAmount = bundledQuoteAmount
                        //     .mul(ethers.utils.parseUnits(("1" - slippage).toString(), 2))
                        //     .div("100");
                        const iface = new ethers.utils.Interface(routeProcessor3Abi);
                        const fnData = iface.encodeFunctionData(
                            "processRoute",
                            [
                                rpParams.tokenIn,
                                rpParams.amountIn,
                                rpParams.tokenOut,
                                // rpParams.amountOutMin,
                                // guaranteedAmount,
                                ethers.BigNumber.from("0"),
                                rpParams.to,
                                rpParams.routeCode
                            ]
                        );
                        const data = ethers.utils.defaultAbiCoder.encode(
                            ["address", "address", "bytes"],
                            [
                                config.routeProcessor3Address,
                                config.routeProcessor3Address,
                                fnData
                            ]
                        );
                        console.log("");
                        console.log(">>> Estimating the profit for this token pair...", "\n");
                        const ethPrice = await getEthPrice(
                            config,
                            bundledOrders[i].buyToken,
                            bundledOrders[i].buyTokenDecimals,
                            gasPrice,
                            dataFetcher
                        );
                        if (ethPrice === undefined) console.log("can not get ETH price, skipping...", "\n");
                        else {
                            const gasLimit = await arb.estimateGas.arb(
                                takeOrdersConfigStruct,
                                // set to zero because only profitable transactions are submitted
                                0,
                                data,
                                { gasPrice }
                            );
                            const gasCost = gasLimit.mul(gasPrice);
                            const maxEstimatedProfit = estimateProfit(
                                ethers.utils.formatEther(bundledOrders[i].initPrice),
                                ethPrice,
                                bundledOrders[i],
                                gasCost,
                                gasCoveragePercentage
                            ).div(
                                "1" + "0".repeat(18 - bundledOrders[i].buyTokenDecimals)
                            );
                            console.log(`Max Estimated Profit: ${
                                ethers.utils.formatUnits(
                                    maxEstimatedProfit,
                                    bundledOrders[i].buyTokenDecimals
                                )
                            } ${bundledOrders[i].buyTokenSymbol}`, "\n");

                            if (maxEstimatedProfit.isNegative()) console.log(
                                ">>> Skipping because estimated negative profit for this token pair",
                                "\n"
                            );
                            else {
                                console.log(">>> Trying to submit the transaction for this token pair...", "\n");
                                const gasCostInToken = ethers.utils.parseUnits(
                                    ethPrice
                                ).mul(
                                    gasCost
                                ).div(
                                    "1" + "0".repeat(
                                        36 - bundledOrders[i].buyTokenDecimals
                                    )
                                );
                                const tx = await arb.arb(
                                    takeOrdersConfigStruct,
                                    // set to zero because only profitable transactions are submitted
                                    gasCostInToken.mul(gasCoveragePercentage).div(100),
                                    data,
                                    { gasPrice, gasLimit }
                                );
                                console.log(config.explorer + "tx/" + tx.hash, "\n");
                                console.log(
                                    ">>> Transaction submitted successfully to the network, waiting for transaction to mine...",
                                    "\n"
                                );

                                try {
                                    const receipt = await tx.wait();
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
                                    console.log(`${bundledOrders[i].takeOrders.length} orders cleared successfully of this token pair!`, "\n");
                                    console.log(`Clear Initial Price: ${ethers.utils.formatEther(bundledOrders[i].initPrice)}`);
                                    console.log(`Clear Actual Price: ${clearActualPrice}`);
                                    console.log(`Clear Amount: ${
                                        ethers.utils.formatUnits(
                                            bundledQuoteAmount,
                                            bundledOrders[i].sellTokenDecimals
                                        )
                                    } ${bundledOrders[i].sellTokenSymbol}`);
                                    console.log(`Consumed Gas: ${
                                        ethers.utils.formatEther(actualGasCost)
                                    } ${
                                        config.nativeToken.symbol
                                    }`, "\n");
                                    if (income) {
                                        console.log(`Raw Income: ${ethers.utils.formatUnits(
                                            income,
                                            bundledOrders[i].buyTokenDecimals
                                        )} ${bundledOrders[i].buyTokenSymbol}`);
                                        console.log(`Net Profit: ${ethers.utils.formatUnits(
                                            netProfit,
                                            bundledOrders[i].buyTokenDecimals
                                        )} ${bundledOrders[i].buyTokenSymbol}`, "\n");
                                    }

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
                                        clearedAmount: bundledQuoteAmount.toString(),
                                        clearPrice: ethers.utils.formatEther(
                                            bundledOrders[i].initPrice
                                        ),
                                        // clearGuaranteedPrice: ethers.utils.formatUnits(
                                        //     guaranteedAmount,
                                        //     bundledOrders[i].buyTokenDecimals
                                        // ),
                                        clearActualPrice,
                                        maxEstimatedProfit,
                                        gasUsed: receipt.gasUsed,
                                        gasCost: actualGasCost,
                                        income,
                                        netProfit,
                                        clearedOrders: bundledOrders[i].takeOrders.map(v => v.id),
                                    });
                                }
                                catch (error) {
                                    console.log(">>> Transaction execution failed due to:");
                                    console.log(error, "\n");
                                }
                            }
                        }
                    }
                    catch (error) {
                        console.log(">>> Transaction failed due to:");
                        console.log(error, "\n");
                    }
                }
            }
        }
        catch (error) {
            console.log(">>> Something went wrong, reason:", "\n");
            console.log(error);
        }
    }
    return report;
};
