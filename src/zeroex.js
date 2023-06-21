const axios = require("axios");
const ethers = require("ethers");
const { bundleTakeOrders } = require("./utils");
const { arbAbi, orderbookAbi } = require("./abis");
const {
    sleep,
    HEADERS,
    getIncome,
    getActualPrice,
    estimateProfit,
    ETHERSCAN_TX_PAGE
} = require("./utils");


const RateLimit = 0.075;    // rate limit per second per month

/**
 * Builds initial 0x requests bodies from token addresses that is required
 * for getting token prices with least amount of hits possible and that is
 * to pair up tokens in a way that each show up only once in a request body
 * so that the number of requests will be: "number-of-tokens / 2" at best or
 * "(number-of-tokens / 2) + 1" at worst if the number of tokens is an odd digit.
 * This way the responses will include the "rate" for sell/buy tokens to native
 * network token which will be used to estimate the initial price of all possible
 * token pair combinations.
 *
 * @param {string} api - The 0x API endpoint URL
 * @param {any[]} quotes - The array that keeps the quotes
 * @param {string} tokenAddress - The token address
 * @param {number} tokenDecimals - The token decimals
 * @param {string} tokenSymbol - The token symbol
 */
const initRequests = (api, quotes, tokenAddress, tokenDecimals, tokenSymbol) => {
    if (quotes.length === 0) quotes.push([
        tokenAddress,
        tokenDecimals,
        tokenSymbol
    ]);
    else if (!Array.isArray(quotes[quotes.length - 1])) {
        if(!quotes.find(v => v.quote.includes(tokenAddress))) quotes.push([
            tokenAddress,
            tokenDecimals,
            tokenSymbol
        ]);
    }
    else {
        if(
            quotes[quotes.length - 1][0] !== tokenAddress &&
            !quotes.slice(0, -1).find(v => v.quote.includes(tokenAddress))
        ) {
            quotes[quotes.length - 1] = {
                quote: `${
                    api
                }swap/v1/price?buyToken=${
                    quotes[quotes.length - 1][0]
                }&sellToken=${
                    tokenAddress
                }&sellAmount=${
                    "100" + "0".repeat(tokenDecimals)
                }`,
                tokens: [quotes[quotes.length - 1][2], tokenSymbol]
            };
        }
    }
};

/**
 * Prepares the bundled orders by getting the best deals from 0x and sorting the
 * bundled orders based on the best deals
 *
 * @param {string[]} quotes - The 0x request quote bodies
 * @param {any[]} bundledOrders - The bundled orders array
 * @param {boolean} sort - (optional) Sort based on best deals or not
 */
const prepare = async(quotes, bundledOrders, sort = true) => {
    try {
        console.log(">>> Getting initial prices from 0x");
        const promises = [];
        for (let i = 0; i < quotes.length; i++) {
            if (i > 0 && i % 2 === 0) await sleep(1000);
            promises.push(await axios.get(quotes[i].quote, HEADERS));
        }
        const responses = await Promise.allSettled(promises);

        let prices = [];
        responses.forEach((v, i) => {
            if (v.status == "fulfilled") prices.push([
                {
                    token: v.value.data.buyTokenAddress,
                    rate: v.value.data.buyTokenToEthRate
                },
                {
                    token: v.value.data.sellTokenAddress,
                    rate: v.value.data.sellTokenToEthRate
                }
            ]);
            else {
                console.log(`Could not get prices for ${quotes[i].tokens[0]} and ${quotes[i].tokens[1]}, reason:`);
                console.log(v.reason.message);
            }
        });
        prices = prices.flat();

        bundledOrders.forEach(v => {
            console.log(`\nCalculating initial price for ${v.buyTokenSymbol}/${v.sellTokenSymbol} ...`);
            const sellTokenPrice = prices.find(
                e => e.token.toLowerCase() === v.sellToken.toLowerCase()
            )?.rate;
            const buyTokenPrice = prices.find(
                e => e.token.toLowerCase() === v.buyToken.toLowerCase()
            )?.rate;
            if (sellTokenPrice && buyTokenPrice) {
                v.initPrice = ethers.utils.parseUnits(buyTokenPrice)
                    .mul(ethers.utils.parseUnits("1"))
                    .div(ethers.utils.parseUnits(sellTokenPrice));
                console.log(`result: ${ethers.utils.formatEther(v.initPrice)}`);
            }
            else console.log("Could not calculate initial price for this token pair due to lack of required data!");
        });
        bundledOrders = bundledOrders.filter(v => v.initPrice !== undefined);

        if (sort) {
            console.log("\n", ">>> Sorting the bundled orders based on initial prices...");
            bundledOrders.sort(
                (a, b) => a.initPrice.gt(b.initPrice) ? -1 : a.initPrice.lt(b.initPrice) ? 1 : 0
            );
        }
        return bundledOrders;
    }
    catch (error) {
        console.log("something went wrong during the process of getting initial prices!");
        console.log(error);
        return undefined;
    }
};

/**
 * Main function that gets order details from subgraph, bundles the ones that have balance and tries clearing them with 0x
 *
 * @param {ethers.Signer} signer - The ethersjs signer constructed from provided private keys and rpc url provider
 * @param {object} config - The configuration object
 * @param {any[]} ordersDetails - The order details queried from subgraph
 * @param {string} slippage - (optional) The slippage for clearing orders, default is 0.01 i.e. 1 percent
 * @param {string} gasCoveragePercentage - (optional) The percentage of the gas cost to cover on each transaction for it to be considered profitable and get submitted
 * @param {boolean} prioritization - (optional) Prioritize better deals to get cleared first, default is true
 * @returns The report of details of cleared orders
 */
exports.zeroExClear = async(
    signer,
    config,
    ordersDetails,
    slippage = "0.01",
    gasCoveragePercentage = "100",
    prioritization = true
) => {
    if (
        gasCoveragePercentage < 0 ||
        gasCoveragePercentage > 100 ||
        !Number.isInteger(Number(gasCoveragePercentage))
    ) throw "invalid gas coverage percentage, must be an integer between 0 - 100";

    const start = Date.now();
    let hits = 0;
    const api = config.zeroEx.apiUrl;
    const proxyAddress = config.zeroEx.proxyAddress;
    const chainId = config.chainId;
    const arbAddress = config.arbAddress;
    const orderbookAddress = config.orderbookAddress;
    const nativeToken = config.nativeToken;
    // const intAbiPath = config.interpreterAbi;
    // const arbAbiPath = config.arbAbi;
    // const orderbookAbiPath = config.orderbookAbi;

    // set the api key in headers
    if (config.apiKey) HEADERS.headers["0x-api-key"] = config.apiKey;
    else throw "invalid 0x API key";

    // get the abis if path is provided for them
    // if (intAbiPath) interpreterAbi = (JSON.parse(
    //     fs.readFileSync(path.resolve(__dirname, intAbiPath)).toString())
    // )?.abi;
    // if (arbAbiPath) arbAbi = JSON.parse(
    //     fs.readFileSync(path.resolve(__dirname, arbAbiPath)).toString()
    // )?.abi;
    // if (orderbookAbiPath) orderbookAbi = JSON.parse(
    //     fs.readFileSync(path.resolve(__dirname, orderbookAbiPath)).toString()
    // )?.abi;

    // instantiating arb contract
    const arb = new ethers.Contract(arbAddress, arbAbi, signer);

    // instantiating orderbook contract
    const orderbook = new ethers.Contract(orderbookAddress, orderbookAbi, signer);

    // orderbook as signer used for eval
    // const obAsSigner = new ethers.VoidSigner(
    //     orderbookAddress,
    //     signer.provider
    // );

    console.log(
        "------------------------- Starting Clearing Process -------------------------",
        "\n"
    );
    console.log(Date());
    console.log("Arb Contract Address: " , arbAddress);
    console.log("OrderBook Contract Address: " , orderbookAddress, "\n");

    const initQuotes = [];
    let bundledOrders = [];

    if (ordersDetails.length) {
        console.log(
            "------------------------- Bundling Orders -------------------------", "\n"
        );
        bundledOrders = await bundleTakeOrders(ordersDetails, orderbook, arb);
        for (let i = 0; i < bundledOrders.length; i++) {
            initRequests(
                api,
                initQuotes,
                bundledOrders[i].sellToken,
                bundledOrders[i].sellTokenDecimals,
                bundledOrders[i].sellTokenSymbol
            );
            initRequests(
                api,
                initQuotes,
                bundledOrders[i].buyToken,
                bundledOrders[i].buyTokenDecimals,
                bundledOrders[i].buyTokenSymbol
            );
        }
    }
    else {
        console.log("No orders found, exiting...", "\n");
        return;
    }

    if (!bundledOrders.length) {
        console.log("Could not find any order with sufficient balance, exiting...", "\n");
        return;
    }

    console.log(
        "------------------------- Getting Best Deals From 0x -------------------------",
        "\n"
    );
    if (Array.isArray(initQuotes[initQuotes.length - 1])) {
        initQuotes[initQuotes.length - 1] = {
            quote: `${
                api
            }swap/v1/price?buyToken=${
                nativeToken.address.toLowerCase()
            }&sellToken=${
                initQuotes[initQuotes.length - 1][0]
            }&sellAmount=${
                "1" + "0".repeat(initQuotes[initQuotes.length - 1][1])
            }`,
            tokens: ["ETH", initQuotes[initQuotes.length - 1][2]]
        };
    }
    hits += initQuotes.length;
    bundledOrders = await prepare(
        initQuotes,
        bundledOrders,
        prioritization
    ) ?? bundledOrders;

    if (bundledOrders.length) console.log(
        "------------------------- Trying To Clear Bundled Orders -------------------------",
        "\n"
    );
    else {
        console.log("Could not find any order to clear for current market price, exiting...", "\n");
        return;
    }

    const report = [];
    for (let i = 0; i < bundledOrders.length; i++) {
        await sleep(1000);
        if (bundledOrders[i].takeOrders.length) {
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

                if (bundledOrders[i].takeOrders.length) {
                    console.log(">>> Getting current price for this token pair...", "\n");

                    let cumulativeAmount = ethers.constants.Zero;
                    bundledOrders[i].takeOrders.forEach(v => {
                        cumulativeAmount = cumulativeAmount.add(v.quoteAmount);
                    });
                    const price = (await axios.get(
                        `${
                            api
                        }swap/v1/price?buyToken=${
                            bundledOrders[i].buyToken
                        }&sellToken=${
                            bundledOrders[i].sellToken
                        }&sellAmount=${
                            cumulativeAmount.div(
                                "1" + "0".repeat(18 - bundledOrders[i].sellTokenDecimals)
                            ).div(2).toString()
                        }&skipValidation=false`,
                        HEADERS
                    ))?.data?.price;
                    hits++;
                    const currentPrice = ethers.utils.parseUnits(price);

                    console.log(`Quote amount: ${ethers.utils.formatUnits(
                        cumulativeAmount.div(
                            "1" + "0".repeat(18 - bundledOrders[i].sellTokenDecimals)
                        ).div(2),
                        bundledOrders[i].sellTokenDecimals
                    )} ${bundledOrders[i].sellTokenSymbol}`);
                    console.log(`Current market price of this token pair: ${price}`);
                    console.log("Current ratio of the orders in this token pair:");
                    bundledOrders[i].takeOrders.forEach(v => {
                        console.log(ethers.utils.formatEther(v.ratio));
                    });

                    console.log(
                        "\n>>> Filtering the bundled orders of this token pair with lower ratio than current market price...",
                        "\n"
                    );

                    bundledOrders[i].takeOrders = bundledOrders[i].takeOrders.filter(
                        v => currentPrice.gte(v.ratio)
                    );

                    if (bundledOrders[i].takeOrders.length) {

                        cumulativeAmount = ethers.constants.Zero;
                        bundledOrders[i].takeOrders.forEach(v => {
                            cumulativeAmount = cumulativeAmount.add(v.quoteAmount);
                        });

                        const bundledQuoteAmount = cumulativeAmount.div(
                            "1" + "0".repeat(18 - bundledOrders[i].sellTokenDecimals)
                        );

                        console.log(">>> Getting quote for this token pair...", "\n");
                        const response = await axios.get(
                            `${
                                api
                            }swap/v1/quote?buyToken=${
                                bundledOrders[i].buyToken
                            }&sellToken=${
                                bundledOrders[i].sellToken
                            }&sellAmount=${
                                bundledQuoteAmount.toString()
                            }&slippagePercentage=${
                                slippage
                            }`,
                            HEADERS
                        );
                        hits++;

                        const txQuote = response?.data;
                        if (txQuote) {
                            console.log("the full quote that will be submitted is:" + "\n" + JSON.stringify(txQuote, null, 2), "\n");
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
                                const data = ethers.utils.defaultAbiCoder.encode(
                                    ["address", "address", "bytes"],
                                    [txQuote.allowanceTarget, proxyAddress, txQuote.data]
                                );
                                console.log(">>> Estimating the profit for this token pair...", "\n");
                                const gasLimit = await arb.estimateGas.arb(
                                    takeOrdersConfigStruct,
                                    // set to zero because only profitable transactions are submitted
                                    0,
                                    data,
                                    // txQuote.allowanceTarget,
                                    // txQuote.data,
                                    { gasPrice: txQuote.gasPrice }
                                );
                                const maxEstimatedProfit = estimateProfit(
                                    txQuote.price,
                                    txQuote.buyTokenToEthRate,
                                    bundledOrders[i],
                                    gasLimit.mul(txQuote.gasPrice),
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

                                if (!maxEstimatedProfit.isNegative()) {
                                    console.log(">>> Trying to submit the transaction for this token pair...", "\n");
                                    const tx = await arb.arb(
                                        takeOrdersConfigStruct,
                                        // set to zero because only profitable transactions are submitted
                                        0,
                                        data,
                                        // txQuote.allowanceTarget,
                                        // txQuote.data,
                                        { gasPrice: txQuote.gasPrice, gasLimit }
                                    );
                                    console.log(ETHERSCAN_TX_PAGE[chainId] + tx.hash, "\n");
                                    console.log(
                                        ">>> Transaction submitted successfully to the network, waiting for transaction to mine...",
                                        "\n"
                                    );

                                    try {
                                        const receipt = await tx.wait();
                                        const income = getIncome(signer, receipt);
                                        const gasCost = ethers.BigNumber.from(
                                            txQuote.gasPrice
                                        ).mul(receipt.gasUsed);
                                        const clearActualPrice = getActualPrice(
                                            receipt,
                                            orderbookAddress,
                                            arbAddress,
                                            cumulativeAmount,
                                            // bundledQuoteAmount.mul(
                                            //     "1" + "0".repeat(
                                            //         18 - bundledOrders[i].sellTokenDecimals
                                            //     )
                                            // ),
                                            bundledOrders[i].sellTokenDecimals,
                                            bundledOrders[i].buyTokenDecimals
                                        );
                                        const netProfit = income
                                            ? income.sub(
                                                ethers.utils.parseUnits(
                                                    txQuote.buyTokenToEthRate
                                                ).mul(
                                                    gasCost
                                                ).div(
                                                    "1" + "0".repeat(
                                                        36 - bundledOrders[i].buyTokenDecimals
                                                    )
                                                )
                                            )
                                            : undefined;
                                        console.log(`${bundledOrders[i].takeOrders.length} orders cleared successfully!`);
                                        console.log(`Clear Quote Price: ${txQuote.price}`);
                                        console.log(`Clear Actual Price: ${clearActualPrice}`);
                                        console.log(`Clear Amount: ${
                                            ethers.utils.formatUnits(
                                                bundledQuoteAmount,
                                                bundledOrders[i].sellTokenDecimals
                                            )
                                        } ${bundledOrders[i].sellTokenSymbol}`);
                                        console.log(`Consumed Gas: ${ethers.utils.formatEther(gasCost)} ETH`, "\n");
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
                                            clearPrice: txQuote.price,
                                            clearGuaranteedPrice: txQuote.guaranteedPrice,
                                            clearActualPrice,
                                            maxEstimatedProfit,
                                            gasUsed: receipt.gasUsed,
                                            gasCost,
                                            income,
                                            netProfit,
                                            clearedOrders: bundledOrders[i].takeOrders,
                                        });
                                    }
                                    catch (error) {
                                        console.log(">>> Transaction execution failed due to:");
                                        console.log(error, "\n");
                                    }
                                }
                                else console.log(">>> Skipping because estimated negative profit for this token pair", "\n");
                            }
                            catch (error) {
                                console.log(">>> Transaction failed due to:");
                                console.log(error, "\n");
                            }
                        }
                        else console.log("Failed to get quote from 0x", "\n");
                    }
                    else console.log(
                        "All orders of this token pair have higher ratio than current market price, checking next token pair...",
                        "\n"
                    );
                }
                else console.log("All orders of this token pair have empty vault balance, skipping...", "\n");
            }
            catch (error) {
                console.log(">>> Failed to get quote from 0x due to:", "\n");
                console.log(error.message);
                console.log("data:");
                console.log(JSON.stringify(error.response.data, null, 2), "\n");
            }
        }
    }
    console.log("---------------------------------------------------------------------------", "\n");

    // wait to stay within montly ratelimit
    if (config.monthlyRatelimit) {
        const rateLimitDuration = Number((((hits / RateLimit) * 1000) + 1).toFixed());
        const duration = Date.now() - start;
        console.log(`Executed in ${duration} miliseconds with ${hits} 0x api calls`);
        const msToWait = rateLimitDuration - duration;
        if (msToWait > 0) {
            console.log(`Waiting ${msToWait} more miliseconds to stay within monthly rate limit...`);
            await sleep(msToWait);
        }
        console.log("---------------------------------------------------------------------------", "\n");
    }
    return report;
};