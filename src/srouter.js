const ethers = require("ethers");
const { Router } = require("@sushiswap/router");
const { Token } = require("@sushiswap/currency");
const { arbAbis, orderbookAbi } = require("./abis");
const {
    getIncome,
    processLps,
    getEthPrice,
    getDataFetcher,
    getActualPrice,
    visualizeRoute,
    bundleTakeOrders,
    getActualClearAmount,
    fetchPoolsForTokenWrapper
} = require("./utils");


/**
 * Prepares the bundled orders by getting the best deals from Router and sorting the
 * bundled orders based on the best deals
 *
 * @param {any[]} bundledOrders - The bundled orders array
 * @param {string[]} lps - The list of liquidity providers
 * @param {any} config - The network config data
 * @param {ethers.BigNumber} gasPrice - The network gas price
 * @param {boolean} sort - (optional) Sort based on best deals or not
 */
const prepare = async(bundledOrders, lps, config, gasPrice, sort = true) => {
    for (let i = 0; i < bundledOrders.length; i++) {
        const bOrder = bundledOrders[i];
        const pair = bOrder.buyTokenSymbol + "/" + bOrder.sellTokenSymbol;
        try {
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
            const dataFetcher = getDataFetcher(config, lps);
            await fetchPoolsForTokenWrapper(dataFetcher, fromToken, toToken);
            const pcMap = dataFetcher.getCurrentPoolCodeMap(fromToken, toToken);
            const route = Router.findBestRoute(
                pcMap,
                config.chainId,
                fromToken,
                // cumulativeAmount,
                "1" + "0".repeat(bOrder.sellTokenDecimals),
                toToken,
                gasPrice.toNumber(),
                // providers,
                // poolFilter
            );
            if (route.status == "NoWay") throw "could not find any route for this token pair";

            const price = route.amountOutBN.mul("1" + "0".repeat(18 - bOrder.buyTokenDecimals));
            bOrder.initPrice = price;
            bOrder.dataFetcher = dataFetcher;

            console.log(`Current market price for ${pair} for: ${ethers.utils.formatEther(price)}`);
            console.log("Current ratio of the orders in this token pair:");
            bOrder.takeOrders.forEach(v => {
                if (v.ratio) console.log(ethers.utils.formatEther(v.ratio));
            });
            bOrder.takeOrders = bOrder.takeOrders.filter(
                v => v.ratio !== undefined ? price.gte(v.ratio) : true
            );
            console.log("\n");
        }
        catch(error) {
            console.log(`>>> could not get price for this ${pair} due to:`);
            console.log(error, "\n");
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
    return bundledOrders;
};

/**
 * Main function that gets order details from subgraph, bundles the ones that have balance and tries clearing them with specialized router contract
 *
 * @param {object} config - The configuration object
 * @param {any[]} ordersDetails - The order details queried from subgraph
 * @param {string} gasCoveragePercentage - (optional) The percentage of the gas cost to cover on each transaction
 * for it to be considered profitable and get submitted
 * @param {boolean} prioritization - (optional) Prioritize better deals to get cleared first, default is true
 * @returns The report of details of cleared orders
 */
const srouterClear = async(
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

    const lps               = processLps(config.lps);
    const dataFetcher       = getDataFetcher(config, lps);
    const signer            = config.signer;
    const arbAddress        = config.arbAddress;
    const orderbookAddress  = config.orderbookAddress;
    const maxProfit         = config.maxProfit;
    const maxRatio          = config.maxRatio;

    // instantiating arb contract
    const arb = new ethers.Contract(arbAddress, arbAbis["srouter"], signer);

    // instantiating orderbook contract
    const orderbook = new ethers.Contract(orderbookAddress, orderbookAbi, signer);

    let gasPrice = await signer.provider.getGasPrice();

    console.log(
        "------------------------- Starting Clearing Process -------------------------",
        "\n"
    );
    console.log("\x1b[33m%s\x1b[0m", Date());
    console.log("Arb Contract Address: " , arbAddress);
    console.log("OrderBook Contract Address: " , orderbookAddress, "\n");

    let bundledOrders = [];
    if (ordersDetails.length) {
        console.log(
            "------------------------- Bundling Orders -------------------------", "\n"
        );
        bundledOrders = await bundleTakeOrders(ordersDetails, orderbook, arb, maxProfit);
        console.log(
            "------------------------- Getting Best Deals From RouteProcessor3 -------------------------",
            "\n"
        );
        bundledOrders = await prepare(bundledOrders, lps, config, gasPrice, prioritization);
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
            gasPrice = await signer.provider.getGasPrice();
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

            if (!bundledOrders[i].takeOrders.length) console.log(
                "All orders of this token pair have empty vault balance, skipping...",
                "\n"
            );
            else {
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
                const quoteChunks = obSellTokenBalance.div("5");
                let ethPrice;

                for (let j = 5; j > 0; j--) {
                    const maximumInput = j === 5 ? obSellTokenBalance : quoteChunks.mul(j);
                    const maximumInputFixed = maximumInput.mul(
                        "1" + "0".repeat(18 - bundledOrders[i].sellTokenDecimals)
                    );

                    console.log(`>>> Trying to arb with ${
                        ethers.utils.formatEther(maximumInputFixed)
                    } ${
                        bundledOrders[i].sellTokenSymbol
                    } as maximum input`);
                    console.log(">>> Getting best route", "\n");
                    const pcMap = bundledOrders[i].dataFetcher.getCurrentPoolCodeMap(
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
                    if (route.status == "NoWay") console.log(
                        "could not find any route for this token pair with this certain amount"
                    );
                    else {
                        const rateFixed = route.amountOutBN.mul(
                            "1" + "0".repeat(18 - bundledOrders[i].buyTokenDecimals)
                        );
                        const price = rateFixed.mul("1" + "0".repeat(18)).div(maximumInputFixed);
                        console.log(`Current best route price for this token pair: ${ethers.utils.formatEther(price)}`, "\n");
                        console.log(">>> Route portions: ", "\n");
                        visualizeRoute(fromToken.address, toToken.address, route.legs).forEach(
                            v => console.log("\x1b[36m%s\x1b[0m", v)
                        );
                        console.log("\n");
                        // console.log(
                        //     "\x1b[36m%s\x1b[0m",
                        //     "\n"
                        // );

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
                            minimumInput: ethers.constants.One,
                            maximumInput,
                            maximumIORatio: maxRatio ? ethers.constants.MaxUint256 : price,
                            orders: bundledOrders[i].takeOrders.map(v => v.takeOrder),
                            data: ethers.utils.defaultAbiCoder.encode(
                                ["bytes"],
                                [rpParams.routeCode]
                            )
                        };

                        // building and submit the transaction
                        try {
                            if (ethPrice === undefined) ethPrice = await getEthPrice(
                                config,
                                bundledOrders[i].buyToken,
                                bundledOrders[i].buyTokenDecimals,
                                gasPrice,
                                dataFetcher
                            );
                            if (ethPrice === undefined) console.log("can not get ETH price, skipping...", "\n");
                            else {
                                const rawtx = {
                                    data: arb.interface.encodeFunctionData("arb", [takeOrdersConfigStruct, "0"]),
                                    to: arb.address,
                                    gasPrice
                                };
                                console.log("Block Number: " + await signer.provider.getBlockNumber(), "\n");
                                let gasLimit;
                                try {
                                    gasLimit = await signer.estimateGas(rawtx);
                                }
                                catch {
                                    throw "nomatch";
                                }
                                gasLimit = gasLimit.mul("11").div("10");
                                rawtx.gasLimit = gasLimit;
                                const gasCost = gasLimit.mul(gasPrice);
                                // const maxEstimatedProfit = estimateProfit(
                                //     ethers.utils.formatEther(bundledOrders[i].initPrice),
                                //     ethPrice,
                                //     bundledOrders[i],
                                //     gasCost,
                                //     gasCoveragePercentage
                                // ).div(
                                //     "1" + "0".repeat(18 - bundledOrders[i].buyTokenDecimals)
                                // );
                                // console.log(`Max Estimated Profit: ${
                                //     ethers.utils.formatUnits(
                                //         maxEstimatedProfit,
                                //         bundledOrders[i].buyTokenDecimals
                                //     )
                                // } ${bundledOrders[i].buyTokenSymbol}`, "\n");

                                // if (maxEstimatedProfit.isNegative()) console.log(
                                //     ">>> Skipping because estimated negative profit for this token pair",
                                //     "\n"
                                // );
                                // else {
                                console.log(">>> Trying to submit the transaction...", "\n");
                                const gasCostInToken = ethers.utils.parseUnits(
                                    ethPrice
                                ).mul(
                                    gasCost
                                ).div(
                                    "1" + "0".repeat(
                                        36 - bundledOrders[i].buyTokenDecimals
                                    )
                                );
                                console.log("Block Number: " + await signer.provider.getBlockNumber(), "\n");
                                rawtx.data = arb.interface.encodeFunctionData(
                                    "arb",
                                    [
                                        takeOrdersConfigStruct,
                                        gasCostInToken.mul(gasCoveragePercentage).div(100)
                                    ]
                                );
                                const tx = await signer.sendTransaction(rawtx);

                                console.log("\x1b[33m%s\x1b[0m", config.explorer + "tx/" + tx.hash, "\n");
                                console.log(
                                    ">>> Transaction submitted successfully to the network, waiting for transaction to mine...",
                                    "\n"
                                );

                                try {
                                    const receipt = await tx.wait();
                                    // console.log(receipt);
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
                                            `Clear Initial Price: ${ethers.utils.formatEther(bundledOrders[i].initPrice)}`
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
                                            console.log("\x1b[35m%s\x1b[0m", `Gross Income: ${ethers.utils.formatUnits(
                                                income,
                                                bundledOrders[i].buyTokenDecimals
                                            )} ${bundledOrders[i].buyTokenSymbol}`);
                                            console.log("\x1b[35m%s\x1b[0m", `Net Profit: ${ethers.utils.formatUnits(
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
                                            clearedAmount: clearActualAmount.toString(),
                                            clearPrice: ethers.utils.formatEther(
                                                bundledOrders[i].initPrice
                                            ),
                                            clearActualPrice,
                                            // maxEstimatedProfit,
                                            gasUsed: receipt.gasUsed,
                                            gasCost: actualGasCost,
                                            income,
                                            netProfit,
                                            clearedOrders: bundledOrders[i].takeOrders.map(
                                                v => v.id
                                            ),
                                        });
                                        j = 0;
                                    }
                                    else if (j > 1) console.log(
                                        `could not clear with ${ethers.utils.formatEther(
                                            maximumInputFixed
                                        )} ${
                                            bundledOrders[i].sellTokenSymbol
                                        } as max input, trying with lower amount...`
                                    );
                                    else console.log("could not arb this pair");
                                }
                                catch (error) {
                                    console.log("\x1b[31m%s\x1b[0m", ">>> Transaction execution failed due to:");
                                    console.log(error, "\n");
                                    if (j > 1) console.log(
                                        "\x1b[34m%s\x1b[0m",
                                        `could not clear with ${ethers.utils.formatEther(
                                            maximumInputFixed
                                        )} ${
                                            bundledOrders[i].sellTokenSymbol
                                        } as max input, trying with lower amount...`, "\n"
                                    );
                                    else console.log("\x1b[34m%s\x1b[0m", "could not arb this pair", "\n");
                                }
                            }
                        }
                        catch (error) {
                            if (error !== "nomatch") {
                                console.log("\x1b[31m%s\x1b[0m", ">>> Transaction failed due to:");
                                console.log(error, "\n");
                                // reason, code, method, transaction, error, stack, message
                            }
                            if (j > 1) console.log(
                                "\x1b[34m%s\x1b[0m",
                                `could not clear with ${ethers.utils.formatEther(
                                    maximumInputFixed
                                )} ${
                                    bundledOrders[i].sellTokenSymbol
                                } as max input, trying with lower amount...`, "\n"
                            );
                            else console.log("\x1b[34m%s\x1b[0m", "could not arb this pair", "\n");
                        }
                    }
                }
            }
        }
        catch (error) {
            console.log("\x1b[31m%s\x1b[0m", ">>> Something went wrong, reason:", "\n");
            console.log(error);
        }
    }
    dataFetcher.stopDataFetching();
    return report;
};

module.exports = {
    srouterClear
};