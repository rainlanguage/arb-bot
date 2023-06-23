const ethers = require("ethers");
const { arbAbi, orderbookAbi } = require("./abis");
const {
    getIncome,
    processLps,
    getEthPrice,
    getDataFetcher,
    getActualPrice,
    estimateProfit,
    bundleTakeOrders,
    ETHERSCAN_TX_PAGE,
} = require("./utils");


/**
 * Curve pools function signatures
 */
const POOLS_FNS = [
    "function get_dy(int128 i, int128 j, uint256 dx) view returns (uint256)",
    "function get_dy_underlying(int128 i, int128 j, uint256 dx) view returns (uint256)",
    "function exchange(int128 i, int128 j, uint256 dx, uint256 min_dy) returns (uint256)",
    "function exchange_underlying(int128 i, int128 j, uint256 dx, uint256 min_dy) returns (uint256)"
];

/**
 * Curve Zap contract function signatures
 */
const ZAP_FNS = [
    [`function exchange_underlying(
        address _pool,
        int128 _i,
        int128 _j,
        uint256 _dx,
        uint256 _min_dy
    ) returns (uint256)`],

    [`function exchange_underlying(
        address _pool,
        int128 _i,
        int128 _j,
        uint256 _dx,
        uint256 _min_dy,
        address _receiver
    ) returns (uint256)`],

    [`function exchange_underlying(
        address _pool,
        int128 _i,
        int128 _j,
        uint256 _dx,
        uint256 _min_dy,
        address _receiver,
        bool _use_underlying
    ) returns (uint256)`]
];

/**
 * Returns array of available swaps pairs from specified curve pools in config file
 * @param {any} config - The config of a network from config.json file
 */
const getAvailableSwaps = (config) => {
    const swaps = [];
    for (let i = 0; i < config.curve.pools.length; i++) {
        const pool = config.curve.pools[i];
        swaps.push({});
        if (pool.coins) {
            swaps[swaps.length - 1].coins = [];
            for (let j = 0; j < pool.coins.length; j++) {
                for (let k = j + 1; k < pool.coins.length; k++) {
                    const pair1 = pool.coins[j].symbol +
                        "/" +
                        pool.coins[k].symbol;
                    const pair2 = pool.coins[k].symbol +
                        "/" +
                        pool.coins[j].symbol;
                    if (!swaps[swaps.length - 1].coins.includes(pair1))
                        swaps[swaps.length - 1].coins.push(pair1);
                    if (!swaps[swaps.length - 1].coins.includes(pair2))
                        swaps[swaps.length - 1].coins.push(pair2);
                }
            }
        }
        if (pool.underlyingCoins) {
            swaps[swaps.length - 1].underlyingCoins = [];
            for (let j = 0; j < pool.underlyingCoins.length; j++) {
                for (let k = j + 1; k < pool.underlyingCoins.length; k++) {
                    const pair1 = pool.underlyingCoins[j].symbol +
                        "/" +
                        pool.underlyingCoins[k].symbol;
                    const pair2 = pool.underlyingCoins[k].symbol +
                        "/" +
                        pool.underlyingCoins[j].symbol;
                    if (!swaps[swaps.length - 1].underlyingCoins.includes(pair1))
                        swaps[swaps.length - 1].underlyingCoins.push(pair1);
                    if (!swaps[swaps.length - 1].underlyingCoins.includes(pair2))
                        swaps[swaps.length - 1].underlyingCoins.push(pair2);
                }
            }
        }
        if (pool.underlyingCoinsUnwrapped) {
            swaps[swaps.length - 1].underlyingCoinsUnwrapped = [];
            for (let j = 0; j < pool.underlyingCoinsUnwrapped.length; j++) {
                for (let k = j + 1; k < pool.underlyingCoinsUnwrapped.length; k++) {
                    const pair1 = pool.underlyingCoinsUnwrapped[j].symbol +
                        "/" +
                        pool.underlyingCoinsUnwrapped[k].symbol;
                    const pair2 = pool.underlyingCoinsUnwrapped[k].symbol +
                        "/" +
                        pool.underlyingCoinsUnwrapped[j].symbol;
                    if (!swaps[swaps.length - 1].underlyingCoinsUnwrapped.includes(pair1))
                        swaps[swaps.length - 1].underlyingCoinsUnwrapped.push(pair1);
                    if (!swaps[swaps.length - 1].underlyingCoinsUnwrapped.includes(pair2))
                        swaps[swaps.length - 1].underlyingCoinsUnwrapped.push(pair2);
                }
            }
        }
    }
    return swaps;
};

/**
 * Prepares the bundled orders by getting the best deals from Curve pools and sorting the
 * bundled orders based on the best deals
 *
 * @param {any[]} bundledOrders - The bundled orders array
 * @param {any[]} availableSwaps - The available swaps from Curve specofied pools
 * @param {any} config - The network config data
 * @param {ethers.Signer} - The ethersjs signer
 * @param {boolean} sort - (optional) Sort based on best deals or not
 */
const prepare = async(bundledOrders, availableSwaps, config, signer, sort = true) => {
    for (let i = 0; i < bundledOrders.length; i++) {
        let pairFormat;
        const bOrder = bundledOrders[i];
        const pair = bOrder.buyTokenSymbol + "/" + bOrder.sellTokenSymbol;
        const poolIndex = availableSwaps.findIndex(v => {
            if (v.coins?.includes(pair)) pairFormat = "c";
            if (v.underlyingCoins?.includes(pair)) pairFormat = "uc";
            if (v.underlyingCoinsUnwrapped?.includes(pair)) pairFormat = "ucu";
            return v.coins?.includes(pair) ||
            v.underlyingCoins?.includes(pair) ||
            v.underlyingCoinsUnwrapped?.includes(pair);
        });
        if (poolIndex > -1) {
            const pool = config.curve.pools[poolIndex];
            bOrder.poolIndex = poolIndex;
            bOrder.poolContract = new ethers.Contract(pool.address, POOLS_FNS, signer);
            bOrder.pairFormat = pairFormat;
            bOrder.buyTokenIndex = pairFormat === "c"
                ? pool.coins.findIndex(v => v.symbol === bOrder.buyTokenSymbol)
                : pairFormat === "uc"
                    ? pool.underlyingCoins.findIndex(v => v.symbol === bOrder.buyTokenSymbol)
                    : pool.underlyingCoinsUnwrapped.findIndex(
                        v => v.symbol === bOrder.buyTokenSymbol
                    );
            bOrder.sellTokenIndex = pairFormat === "c"
                ? pool.coins.findIndex(v => v.symbol === bOrder.sellTokenSymbol)
                : pairFormat === "uc"
                    ? pool.underlyingCoins.findIndex(v => v.symbol === bOrder.sellTokenSymbol)
                    : pool.underlyingCoinsUnwrapped.findIndex(
                        v => v.symbol === bOrder.sellTokenSymbol
                    );
            try {
                let rate;
                let cumulativeAmountFixed = ethers.constants.Zero;
                bOrder.takeOrders.forEach(v => {
                    cumulativeAmountFixed = cumulativeAmountFixed.add(v.quoteAmount);
                });
                const cumulativeAmount = cumulativeAmountFixed.div("1" + "0".repeat(18 - bOrder.sellTokenDecimals));
                if (pairFormat === "c") {
                    rate = await bOrder.poolContract.get_dy(
                        bOrder.sellTokenIndex,
                        bOrder.buyTokenIndex,
                        cumulativeAmount
                    );
                }
                else {
                    rate = await bOrder.poolContract.get_dy_underlying(
                        bOrder.sellTokenIndex,
                        bOrder.buyTokenIndex,
                        cumulativeAmount
                    );
                }
                const rateFixed = rate.mul("1" + "0".repeat(18 - bOrder.buyTokenDecimals));
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
 * Main function that gets order details from subgraph, bundles the ones that have balance and tries clearing them with curve
 *
 * @param {ethers.Signer} signer - The ethersjs signer constructed from provided private keys and rpc url provider
 * @param {object} config - The configuration object
 * @param {any[]} ordersDetails - The order details queried from subgraph
 * @param {string} slippage - (optional) The slippage for clearing orders, default is 0.01 i.e. 1 percent
 * @param {string} gasCoveragePercentage - (optional) The percentage of the gas cost to cover on each transaction
 * for it to be considered profitable and get submitted
 * @param {boolean} prioritization - (optional) Prioritize better deals to get cleared first, default is true
 * @returns The report of details of cleared orders
 */
exports.curveClear = async(
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

    const chainId = config.chainId;
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
            "------------------------- Getting Best Deals From Curve -------------------------",
            "\n"
        );
        const availableSwaps = getAvailableSwaps(config);
        await prepare(bundledOrders, availableSwaps, config, signer, prioritization);
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
    const dataFetcher = getDataFetcher(config, processLps(config.lps));
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
                let cumulativeAmount = ethers.constants.Zero;
                bundledOrders[i].takeOrders.forEach(v => {
                    cumulativeAmount = cumulativeAmount.add(v.quoteAmount);
                });

                const bundledQuoteAmount = cumulativeAmount.div(
                    "1" + "0".repeat(18 - bundledOrders[i].sellTokenDecimals)
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
                    const guaranteedAmount = bundledQuoteAmount
                        .mul(ethers.utils.parseUnits(("1" - slippage).toString(), 2))
                        .div("100");
                    let fnData;
                    let data;
                    let iface;
                    if (bundledOrders[i].pairFormat === "ucu") {
                        if (config.curve.usdZapAddress) {
                            iface = new ethers.utils.Interface(ZAP_FNS[0]);
                            fnData = iface.encodeFunctionData(
                                "exchange_underlying",
                                [
                                    bundledOrders[i].poolContract.address,
                                    bundledOrders[i].sellTokenIndex.toString(),
                                    bundledOrders[i].buyTokenIndex.toString(),
                                    bundledQuoteAmount.toString(),
                                    guaranteedAmount.toString()
                                ]
                            );
                            data = ethers.utils.defaultAbiCoder.encode(
                                ["address", "address", "bytes"],
                                [
                                    config.curve.usdZapAddress,
                                    config.curve.usdZapAddress,
                                    fnData
                                ]
                            );
                        }
                        else console.log(">>> cannot find Zap contract address for this network, skipping...");
                    }
                    else {
                        iface = new ethers.utils.Interface(POOLS_FNS);
                        if (bundledOrders[i].pairFormat === "c") {
                            fnData = iface.encodeFunctionData(
                                "exchange",
                                [
                                    bundledOrders[i].sellTokenIndex.toString(),
                                    bundledOrders[i].buyTokenIndex.toString(),
                                    bundledQuoteAmount.toString(),
                                    guaranteedAmount.toString()
                                ]
                            );
                        }
                        else {
                            fnData = iface.encodeFunctionData(
                                "exchange_underlying",
                                [
                                    bundledOrders[i].sellTokenIndex.toString(),
                                    bundledOrders[i].buyTokenIndex.toString(),
                                    bundledQuoteAmount.toString(),
                                    guaranteedAmount.toString()
                                ]
                            );
                        }
                        data = ethers.utils.defaultAbiCoder.encode(
                            ["address", "address", "bytes"],
                            [
                                bundledOrders[i].poolContract.address,
                                bundledOrders[i].poolContract.address,
                                fnData
                            ]
                        );
                    }
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
                        const maxEstimatedProfit = estimateProfit(
                            ethers.utils.formatEther(bundledOrders[i].initPrice),
                            ethPrice,
                            bundledOrders[i],
                            gasLimit.mul(gasPrice),
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
                            const tx = await arb.arb(
                                takeOrdersConfigStruct,
                                // set to zero because only profitable transactions are submitted
                                0,
                                data,
                                { gasPrice, gasLimit }
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
                                    receipt.effectiveGasPrice
                                ).mul(receipt.gasUsed);
                                const clearActualPrice = getActualPrice(
                                    receipt,
                                    orderbookAddress,
                                    arbAddress,
                                    cumulativeAmount,
                                    bundledOrders[i].sellTokenDecimals,
                                    bundledOrders[i].buyTokenDecimals
                                );
                                const netProfit = income
                                    ? income.sub(
                                        ethers.utils.parseUnits(
                                            ethPrice
                                        ).mul(
                                            gasCost
                                        ).div(
                                            "1" + "0".repeat(
                                                36 - bundledOrders[i].buyTokenDecimals
                                            )
                                        )
                                    )
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
                                    clearPrice: ethers.utils.formatEther(
                                        bundledOrders[i].initPrice
                                    ),
                                    clearGuaranteedPrice: ethers.utils.formatUnits(
                                        guaranteedAmount,
                                        bundledOrders[i].buyTokenDecimals
                                    ),
                                    clearActualPrice,
                                    maxEstimatedProfit,
                                    gasUsed: receipt.gasUsed,
                                    gasCost,
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
        catch (error) {
            console.log(">>> Something went wrong, reason:", "\n");
            console.log(error);
        }
    }
    return report;
};