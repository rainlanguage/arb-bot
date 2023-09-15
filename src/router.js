const ethers = require("ethers");
const { Router } = require("@sushiswap/router");
const { Token } = require("@sushiswap/currency");
const { arbAbis, orderbookAbi, routeProcessor3Abi } = require("./abis");
const {
    sleep,
    getIncome,
    processLps,
    getEthPrice,
    getDataFetcher,
    getActualPrice,
    visualizeRoute,
    build0xQueries,
    bundleTakeOrders,
    fetchPoolsForTokenWrapper
} = require("./utils");


const HEADERS = { headers: { "accept-encoding": "null" } };

/**
 * Prepares the bundled orders by getting the best deals from Router and sorting the
 * bundled orders based on the best deals
 *
 * @param {any[]} bundledOrders - The bundled orders array
 * @param {string[]} zeroexQueries - The 0x request queries
 * @param {any} dataFetcher - The DataFetcher instance
 * @param {any} config - The network config data
 * @param {ethers.BigNumber} gasPrice - The network gas price
 * @param {boolean} sort - (optional) Sort based on best deals or not
 */
const prepare = async(bundledOrders, zeroexQueries, dataFetcher, config, gasPrice, sort = true) => {
    try {
        let prices = [];
        if (config.apiKey) {
            console.log(">>> Getting initial prices from 0x");
            const zeroexPromises = [];
            for (let i = 0; i < zeroexQueries.length; i++) {
                zeroexPromises.push(axios.get(zeroexQueries[i].quote, HEADERS));
                await sleep(1000);
            }
            const zeroexResponses = await Promise.allSettled(zeroexPromises);

            for (let i = 0; i < zeroexResponses.length; i++) {
                if (zeroexResponses[i].status == "fulfilled") prices.push([
                    {
                        token: zeroexResponses[i].value.data.buyTokenAddress,
                        rate: zeroexResponses[i].value.data.buyTokenToEthRate
                    },
                    {
                        token: zeroexResponses[i].value.data.sellTokenAddress,
                        rate: zeroexResponses[i].value.data.sellTokenToEthRate
                    }
                ]);
                else {
                    console.log("");
                    console.log(
                        "\x1b[31m%s\x1b[0m",
                        `Could not get prices from 0x for ${
                            zeroexQueries[i].tokens[0]
                        } and ${
                            zeroexQueries[i].tokens[1]
                        }`
                    );
                    console.log(">>> Trying to get prices from Router...");
                    try {
                        if (
                            zeroexQueries[i].tokens[2].toLowerCase() !==
                            config.nativeWrappedToken.address.toLowerCase()
                        ) {
                            const token0ToEthRate = await getEthPrice(
                                config,
                                zeroexQueries[i].tokens[2],
                                zeroexQueries[i].tokens[4],
                                gasPrice,
                                dataFetcher
                            );
                            if (token0ToEthRate !== undefined) prices.push([{
                                token: zeroexQueries[i].tokens[2],
                                rate: token0ToEthRate
                            }]);
                            else throw "noway";
                        }
                        else prices.push([{
                            token: config.nativeWrappedToken.address.toLowerCase(),
                            rate: "1"
                        }]);
                    }
                    catch (e0) {
                        if (e0 === "noway") console.log(
                            "\x1b[31m%s\x1b[0m",
                            `could not find any route for ${zeroexQueries[i].tokens[0]}`
                        );
                        else console.log(
                            "\x1b[31m%s\x1b[0m",
                            `could not get price for ${zeroexQueries[i].tokens[0]} from Router`
                        );
                    }
                    try {
                        if (
                            zeroexQueries[i].tokens[3].toLowerCase() !==
                            config.nativeWrappedToken.address.toLowerCase()
                        ) {
                            const token1ToEthRate = await getEthPrice(
                                config,
                                zeroexQueries[i].tokens[3],
                                zeroexQueries[i].tokens[5],
                                gasPrice,
                                dataFetcher
                            );
                            if (token1ToEthRate !== undefined) prices.push([{
                                token: zeroexQueries[i].tokens[3],
                                rate: token1ToEthRate
                            }]);
                            else throw "noway";
                        }
                        else prices.push([{
                            token: config.nativeWrappedToken.address.toLowerCase(),
                            rate: "1"
                        }]);
                    }
                    catch (e1) {
                        if (e1 === "noway") console.log(
                            "\x1b[31m%s\x1b[0m",
                            `could not find any route for ${zeroexQueries[i].tokens[1]}`
                        );
                        else console.log(
                            "\x1b[31m%s\x1b[0m",
                            `could not get price for ${zeroexQueries[i].tokens[1]} from Router`
                        );
                    }
                }
            }
        }
        else {
            console.log(">>> Getting initial prices from Router");
            for (let i = 0; i < zeroexQueries.length; i++) {
                try {
                    if (
                        zeroexQueries[i].tokens[2].toLowerCase() !==
                        config.nativeWrappedToken.address.toLowerCase()
                    ) {
                        const token0ToEthRate = await getEthPrice(
                            config,
                            zeroexQueries[i].tokens[2],
                            zeroexQueries[i].tokens[4],
                            gasPrice,
                            dataFetcher
                        );
                        if (token0ToEthRate !== undefined) prices.push([{
                            token: zeroexQueries[i].tokens[2],
                            rate: token0ToEthRate
                        }]);
                        else throw "noway";
                    }
                    else prices.push([{
                        token: config.nativeWrappedToken.address.toLowerCase(),
                        rate: "1"
                    }]);
                }
                catch (e0) {
                    if (e0 === "noway") console.log(
                        "\x1b[31m%s\x1b[0m",
                        `could not find any route for ${zeroexQueries[i].tokens[0]}`
                    );
                    else console.log(
                        "\x1b[31m%s\x1b[0m",
                        `could not get price for ${zeroexQueries[i].tokens[0]} from Router`
                    );
                }
                try {
                    if (
                        zeroexQueries[i].tokens[3].toLowerCase() !==
                        config.nativeWrappedToken.address.toLowerCase()
                    ) {
                        const token1ToEthRate = await getEthPrice(
                            config,
                            zeroexQueries[i].tokens[3],
                            zeroexQueries[i].tokens[5],
                            gasPrice,
                            dataFetcher
                        );
                        if (token1ToEthRate !== undefined) prices.push([{
                            token: zeroexQueries[i].tokens[3],
                            rate: token1ToEthRate
                        }]);
                        else throw "noway";
                    }
                    else prices.push([{
                        token: config.nativeWrappedToken.address.toLowerCase(),
                        rate: "1"
                    }]);
                }
                catch (e1) {
                    if (e1 === "noway") console.log(
                        "\x1b[31m%s\x1b[0m",
                        `could not find any route for ${zeroexQueries[i].tokens[1]}`
                    );
                    else console.log(
                        "\x1b[31m%s\x1b[0m",
                        `could not get price for ${zeroexQueries[i].tokens[1]} from Router`
                    );
                }
            }

        }
        prices = prices.flat();
        console.log("");

        bundledOrders.forEach(v => {
            console.log(`Current market price for ${v.buyTokenSymbol}/${v.sellTokenSymbol}:`);
            const sellTokenToEthRate = prices.find(
                e => e.token.toLowerCase() === v.sellToken.toLowerCase()
            )?.rate;
            const buyTokenToEthRate = prices.find(
                e => e.token.toLowerCase() === v.buyToken.toLowerCase()
            )?.rate;
            if (sellTokenToEthRate && buyTokenToEthRate) {
                v.initPrice = ethers.utils.parseUnits(buyTokenToEthRate)
                    .mul(ethers.utils.parseUnits("1"))
                    .div(ethers.utils.parseUnits(sellTokenToEthRate));
                console.log("\x1b[36m%s\x1b[0m", `${ethers.utils.formatEther(v.initPrice)}`);
            }
            else console.log(
                "\x1b[31m%s\x1b[0m",
                "Could not calculate market price for this token pair due to lack of required data!"
            );
            console.log("");
        });
        bundledOrders = bundledOrders.filter(v => v.initPrice !== undefined);
        // bundledOrders.forEach(v => {
        //     v.takeOrders = v.takeOrders.filter(
        //         e => e.ratio !== undefined ? v.initPrice.gte(e.ratio) : true
        //     );
        // });

        if (sort) {
            console.log("\n", ">>> Sorting the pairs based on ...");
            bundledOrders.sort(
                (a, b) => a.initPrice.gt(b.initPrice) ? -1 : a.initPrice.lt(b.initPrice) ? 1 : 0
            );
        }
        return [bundledOrders, prices];
    }
    catch (error) {
        console.log("something went wrong during the process of getting initial prices!");
        console.log(error);
        return [[], []];
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
const routerClear = async(
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

    const lps               = processLps(config.lps, config.chainId);
    const dataFetcher       = getDataFetcher(config, lps, !!config.usePublicRpc);
    const signer            = config.signer;
    const arbAddress        = config.arbAddress;
    const orderbookAddress  = config.orderbookAddress;
    const arbType           = config.arbType;
    const api               = config.zeroEx.apiUrl;
    const nativeToken       = config.nativeWrappedToken;

    if (config.apiKey) HEADERS.headers["0x-api-key"] = config.apiKey;

    // instantiating arb contract
    const arb = new ethers.Contract(arbAddress, arbAbis[arbType], signer);

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

    const initPriceQueries = [];
    let bundledOrders = [];
    let ethPrices = [];
    if (ordersDetails.length) {
        console.log(
            "------------------------- Bundling Orders -------------------------", "\n"
        );
        bundledOrders = await bundleTakeOrders(ordersDetails, orderbook, arb);
        for (let i = 0; i < bundledOrders.length; i++) {
            build0xQueries(
                api,
                initPriceQueries,
                bundledOrders[i].sellToken,
                bundledOrders[i].sellTokenDecimals,
                bundledOrders[i].sellTokenSymbol
            );
            build0xQueries(
                api,
                initPriceQueries,
                bundledOrders[i].buyToken,
                bundledOrders[i].buyTokenDecimals,
                bundledOrders[i].buyTokenSymbol
            );
        }
        if (Array.isArray(initPriceQueries[initPriceQueries.length - 1])) {
            initPriceQueries[initPriceQueries.length - 1] = {
                quote: `${
                    api
                }swap/v1/price?buyToken=${
                    nativeToken.address.toLowerCase()
                }&sellToken=${
                    initPriceQueries[initPriceQueries.length - 1][0]
                }&sellAmount=${
                    "1" + "0".repeat(initPriceQueries[initPriceQueries.length - 1][1])
                }`,
                tokens: [
                    nativeToken.symbol,
                    initPriceQueries[initPriceQueries.length - 1][2],
                    nativeToken.address.toLowerCase(),
                    initPriceQueries[initPriceQueries.length - 1][0],
                    nativeToken.decimals,
                    initPriceQueries[initPriceQueries.length - 1][1],
                ]
            };
        }
        console.log(
            "------------------------- Getting Best Deals From RouteProcessor3 -------------------------",
            "\n"
        );
        [ bundledOrders, ethPrices ] = await prepare(
            bundledOrders,
            initPriceQueries,
            dataFetcher,
            config,
            gasPrice,
            prioritization
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
                const pcMap = dataFetcher.getCurrentPoolCodeMap(fromToken,toToken);
                gasPrice = await signer.provider.getGasPrice();
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
                    // console.log(
                    //     "\x1b[36m%s\x1b[0m",
                    //     visualizeRoute(fromToken.address, toToken.address, route.legs),
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
                                config.routeProcessor3Address,
                                config.routeProcessor3Address,
                                fnData
                            ]
                        );
                        if (arbType === "order-taker") takeOrdersConfigStruct.data = exchangeData;

                        // console.log(">>> Estimating the profit for this token pair...", "\n");
                        const ethPrice = ethPrices.find(v =>
                            v.token.toLowerCase() === bundledOrders[i].buyToken.toLowerCase()
                        )?.rate;
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
                            gasLimit = gasLimit.mul("112").div("100");
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
                            if (gasCoveragePercentage !== "0") {
                                const headroom = (
                                    Number(gasCoveragePercentage) * 1.15
                                ).toFixed();
                                rawtx.data = arb.interface.encodeFunctionData(
                                    "arb",
                                    arbType === "order-taker"
                                        ? [
                                            takeOrdersConfigStruct,
                                            gasCostInToken.mul(headroom).div(100)
                                        ]
                                        : [
                                            takeOrdersConfigStruct,
                                            gasCostInToken.mul(headroom).div(100),
                                            exchangeData
                                        ]
                                );
                                await signer.estimateGas(rawtx);
                                // try {
                                //     await signer.estimateGas(rawtx);
                                // }
                                // catch {
                                //     // console.log(err);
                                //     throw "dryrun";
                                // }
                            }
                            rawtx.data = arb.interface.encodeFunctionData(
                                "arb",
                                arbType === "order-taker"
                                    ? [
                                        takeOrdersConfigStruct,
                                        gasCostInToken.mul(gasCoveragePercentage).div(100)
                                    ]
                                    : [
                                        takeOrdersConfigStruct,
                                        gasCostInToken.mul(gasCoveragePercentage).div(100),
                                        exchangeData
                                    ]
                            );
                            console.log("Block Number: " + await signer.provider.getBlockNumber(), "\n");
                            const tx = await signer.sendTransaction(rawtx);
                            console.log("\x1b[33m%s\x1b[0m", config.explorer + "tx/" + tx.hash, "\n");
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
                                console.log(
                                    "\x1b[34m%s\x1b[0m",
                                    `${bundledOrders[i].takeOrders.length} orders cleared successfully of this token pair!`,
                                    "\n"
                                );
                                console.log(
                                    "\x1b[36m%s\x1b[0m",
                                    `Clear Initial Price: ${ethers.utils.formatEther(bundledOrders[i].initPrice)}`
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
                                        bundledOrders[i].initPrice
                                    ),
                                    // clearGuaranteedPrice: ethers.utils.formatUnits(
                                    //     guaranteedAmount,
                                    //     bundledOrders[i].buyTokenDecimals
                                    // ),
                                    clearActualPrice,
                                    // maxEstimatedProfit,
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
                        // }
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