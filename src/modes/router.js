const ethers = require("ethers");
const { Router, Token } = require("sushiswap-router");
const { arbAbis, orderbookAbi, routeProcessor3Abi } = require("../abis");
const {
    getIncome,
    processLps,
    getEthPrice,
    getDataFetcher,
    getActualPrice,
    visualizeRoute,
    promiseTimeout,
    bundleTakeOrders
} = require("../utils");


/**
 * Main function that gets order details from subgraph, bundles the ones that have balance and tries clearing them with router contract
 *
 * @param {object} config - The configuration object
 * @param {any[]} ordersDetails - The order details queried from subgraph
 * @param {string} gasCoveragePercentage - (optional) The percentage of the gas cost to cover on each transaction
 * for it to be considered profitable and get submitted
 * @returns The report of details of cleared orders
 */
const routerClear = async(
    config,
    ordersDetails,
    gasCoveragePercentage = "100"
) => {
    if (
        gasCoveragePercentage < 0 ||
        !Number.isInteger(Number(gasCoveragePercentage))
    ) throw "invalid gas coverage percentage, must be an integer greater than equal 0";

    const lps               = processLps(config.lps, config.chainId);
    const dataFetcher       = getDataFetcher(config, lps, !!config.usePublicRpcs);
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

    console.log(
        "------------------------- Starting The",
        "\x1b[32mROUTER\x1b[0m",
        "Mode -------------------------",
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
        bundledOrders = await bundleTakeOrders(
            ordersDetails,
            orderbook,
            arb,
            undefined,
            config.rpc !== "test",
            config.interpreterv2,
            config.bundle
        );
    }
    else {
        console.log("No orders found, exiting...", "\n");
        return;
    }

    if (!bundledOrders.length) {
        console.log("Could not find any order to clear for current market price, exiting...", "\n");
        return;
    }

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

                console.log(
                    ">>> getting market rate for " +
                    ethers.utils.formatUnits(cumulativeAmountFixed) +
                    " " +
                    bundledOrders[i].sellTokenSymbol
                );

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

                // await fetchPoolsForTokenWrapper(dataFetcher, fromToken, toToken);
                await dataFetcher.fetchPoolsForToken(fromToken, toToken);
                const pcMap = dataFetcher.getCurrentPoolCodeMap(fromToken,toToken);
                const gasPrice = await signer.provider.getGasPrice();
                const route = Router.findBestRoute(
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

                console.log(
                    "best rate from router: " +
                    ethers.utils.formatUnits(
                        route.amountOutBN,
                        bundledOrders[i].buyTokenDecimals
                    ) +
                    " " +
                    bundledOrders[i].buyTokenSymbol
                );

                const rateFixed = route.amountOutBN.mul(
                    "1" + "0".repeat(18 - bundledOrders[i].buyTokenDecimals)
                );
                const price = rateFixed.mul("1" + "0".repeat(18)).div(cumulativeAmountFixed);
                console.log("");
                console.log(
                    "Current best route price for this token pair:",
                    `\x1b[33m${ethers.utils.formatEther(price)}\x1b[0m`,
                    "\n"
                );

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
                    console.log(">>> Route portions: ", "\n");
                    visualizeRoute(fromToken, toToken, route.legs).forEach(
                        v => console.log("\x1b[36m%s\x1b[0m", v)
                    );
                    console.log("");

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
                    if (/^flash-loan-v3$|^order-taker$/.test(arbType)) {
                        takeOrdersConfigStruct.data = "0x00";
                        delete takeOrdersConfigStruct.output;
                        delete takeOrdersConfigStruct.input;
                        if (arbType === "flash-loan-v3") takeOrdersConfigStruct.data = "0x";
                    }

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

                        const ethPrice = gasCoveragePercentage === "0"
                            ? "0"
                            : await getEthPrice(
                                config,
                                bundledOrders[i].buyToken,
                                bundledOrders[i].buyTokenDecimals,
                                gasPrice,
                                dataFetcher
                            );
                        if (ethPrice === undefined) console.log("can not get ETH price, skipping...", "\n");
                        else {
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
                            console.log("Block Number: " + await signer.provider.getBlockNumber(), "\n");
                            let gasLimit = await signer.estimateGas(rawtx);
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
                                await signer.estimateGas(rawtx);
                            }

                            try {
                                console.log(">>> Trying to submit the transaction for this token pair...", "\n");
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
                                console.log("Block Number: " + await signer.provider.getBlockNumber(), "\n");
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
                                console.log("\x1b[33m%s\x1b[0m", config.explorer + "tx/" + tx.hash, "\n");
                                console.log(
                                    ">>> Transaction submitted successfully to the network, waiting for transaction to mine...",
                                    "\n"
                                );
                                console.log(tx);
                                const receipt = config.timeout
                                    ? await promiseTimeout(
                                        tx.wait(),
                                        config.timeout,
                                        `Transaction failed to mine after ${config.timeout}ms`
                                    )
                                    : await tx.wait();
                                console.log(receipt);
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
                                console.log(
                                    "\x1b[34m%s\x1b[0m",
                                    `${bundledOrders[i].takeOrders.length} orders cleared successfully of this token pair!`,
                                    "\n"
                                );
                                console.log(
                                    "\x1b[36m%s\x1b[0m",
                                    `Clear Initial Price: ${ethers.utils.formatEther(price)}`
                                );
                                console.log("\x1b[36m%s\x1b[0m", `Clear Actual Price: ${clearActualPrice}`);
                                console.log("\x1b[36m%s\x1b[0m", `Clear Amount: ${
                                    ethers.utils.formatUnits(
                                        bundledQuoteAmount,
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
                                console.log("\x1b[31m%s\x1b[0m", ">>> Transaction execution failed due to:");
                                console.log(error, "\n");
                            }
                        }
                    }
                    catch (error) {
                        if (error === "dryrun" || error === "nomatch") {
                            console.log("\x1b[31m%s\x1b[0m", ">>> Transaction dry run failed, skipping...");
                        }
                        else {
                            console.log("\x1b[31m%s\x1b[0m", ">>> Transaction failed due to:");
                            console.log(error, "\n");
                            // reason, code, method, transaction, error, stack, message
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
    return report;
};

module.exports = {
    routerClear
};