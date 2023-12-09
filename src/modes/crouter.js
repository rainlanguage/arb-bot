const ethers = require("ethers");
const { parseAbi } = require("viem");
const { Router, Token } = require("sushiswap-router");
const { arbAbis, orderbookAbi, routeProcessor3Abi, CURVE_POOLS_FNS, CURVE_ZAP_FNS } = require("../abis");
const {
    getIncome,
    processLps,
    getEthPrice,
    getDataFetcher,
    getActualPrice,
    visualizeRoute,
    promiseTimeout,
    bundleTakeOrders,
    createViemClient
} = require("../utils");


/**
 * Returns array of available swaps pairs from specified curve pools in config file
 * @param {any} config - The config of a network from config.json file
 */
const getCurveSwaps = (config) => {
    const swaps = [];
    for (let i = 0; i < config.curve.pools.length; i++) {
        const pool = config.curve.pools[i];
        swaps.push({ address: pool.address, index: i });
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
const setCurveSwaps = (bundledOrders, availableSwaps, config, signer) => {
    for (let i = 0; i < bundledOrders.length; i++) {
        const pairFormat = [];
        const bOrder = bundledOrders[i];
        const pair = bOrder.buyTokenSymbol + "/" + bOrder.sellTokenSymbol;
        const pools = availableSwaps.filter(v => {
            const _l = pairFormat.length;
            if (v.coins?.includes(pair)) pairFormat.push("c");
            else if (v.underlyingCoins?.includes(pair)) pairFormat.push("uc");
            else if (v.underlyingCoinsUnwrapped?.includes(pair)) pairFormat.push("ucu");
            return pairFormat.length > _l;
        });
        if (pools.length > 0) {
            bOrder.curve = [];
            pools.forEach((_pool, i) => {
                const _curvePoolDetailsForPair = {};
                const poolConfig = config.curve.pools[_pool.index];
                _curvePoolDetailsForPair.poolContract = new ethers.Contract(
                    _pool.address,
                    CURVE_POOLS_FNS,
                    signer
                );
                _curvePoolDetailsForPair.pairFormat = pairFormat[i];
                _curvePoolDetailsForPair.buyTokenIndex = pairFormat[i] === "c"
                    ? poolConfig.coins.findIndex(v => v.symbol === bOrder.buyTokenSymbol)
                    : pairFormat[i] === "uc"
                        ? poolConfig.underlyingCoins.findIndex(
                            v => v.symbol === bOrder.buyTokenSymbol
                        )
                        : poolConfig.underlyingCoinsUnwrapped.findIndex(
                            v => v.symbol === bOrder.buyTokenSymbol
                        );
                _curvePoolDetailsForPair.sellTokenIndex = pairFormat[i] === "c"
                    ? poolConfig.coins.findIndex(v => v.symbol === bOrder.sellTokenSymbol)
                    : pairFormat[i] === "uc"
                        ? poolConfig.underlyingCoins.findIndex(
                            v => v.symbol === bOrder.sellTokenSymbol
                        )
                        : poolConfig.underlyingCoinsUnwrapped.findIndex(
                            v => v.symbol === bOrder.sellTokenSymbol
                        );
                bOrder.curve.push(_curvePoolDetailsForPair);
            });
        }
    }
    // bundledOrders = bundledOrders.filter(v => v.curve !== undefined);
    return bundledOrders;
};

/**
 * Main function that gets order details from subgraph, bundles the ones that have balance and tries clearing them with router contract
 *
 * @param {object} config - The configuration object
 * @param {any[]} ordersDetails - The order details queried from subgraph
 * @param {string} gasCoveragePercentage - (optional) The percentage of the gas cost to cover on each transaction
 * for it to be considered profitable and get submitted
 * @returns The report of details of cleared orders
 */
const crouterClear = async(
    config,
    ordersDetails,
    gasCoveragePercentage = "100"
) => {
    if (
        gasCoveragePercentage < 0 ||
        !Number.isInteger(Number(gasCoveragePercentage))
    ) throw "invalid gas coverage percentage, must be an integer greater than equal 0";

    const lps               = processLps(config.lps, config.chainId);
    const viemClient        = createViemClient(config.chainId, [config.rpc], !!config.usePublicRpc);
    const dataFetcher       = getDataFetcher(viemClient, lps);
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
        "\x1b[32mCURVE-ROUTER\x1b[0m",
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
        bundledOrders = await bundleTakeOrders(ordersDetails, orderbook, arb, undefined, config.rpc !== "test", config.interpreterv2);
        const availableSwaps = getCurveSwaps(config);
        bundledOrders = setCurveSwaps(
            bundledOrders,
            availableSwaps,
            config,
            signer
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
                console.log(">>> Getting best market rate for this token pair", "\n");

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

                const gasPrice = await signer.provider.getGasPrice();
                const pricePromises = [
                    dataFetcher.fetchPoolsForToken(fromToken, toToken)
                ];
                if (bundledOrders[i].curve) pricePromises.push(viemClient.multicall({
                    multicallAddress: viemClient.chain?.contracts?.multicall3?.address,
                    allowFailure: true,
                    contracts: bundledOrders[i].curve.map((curvePool) => {
                        if (curvePool.pairFormat === "c") return {
                            address: curvePool.poolContract.address,
                            chainId: config.chainId,
                            args: [
                                curvePool.sellTokenIndex,
                                curvePool.buyTokenIndex,
                                cumulativeAmount.toBigInt()
                            ],
                            abi: parseAbi(CURVE_POOLS_FNS),
                            functionName: "get_dy"
                        };
                        else return {
                            address: curvePool.poolContract.address,
                            chainId: config.chainId,
                            args: [
                                curvePool.sellTokenIndex,
                                curvePool.buyTokenIndex,
                                cumulativeAmount.toBigInt()
                            ],
                            abi: parseAbi(CURVE_POOLS_FNS),
                            functionName: "get_dy_underlying"
                        };
                    })
                }));

                console.log(
                    ">>> getting market rate for " +
                    ethers.utils.formatUnits(cumulativeAmountFixed) +
                    " " +
                    bundledOrders[i].sellTokenSymbol
                );

                const _res = await Promise.allSettled(pricePromises);
                let topCurveDealPoolIndex = -1;
                if (_res[1] !== undefined && _res[1].status === "fulfilled") topCurveDealPoolIndex = _res[1].value.indexOf(
                    (_res[1].value.filter(v => v.status === "success").sort(
                        (a, b) => b.result > a.result ? 1 : b.result < a.result ? -1 : 0
                    ))[0]
                );
                const pcMap = dataFetcher.getCurrentPoolCodeMap(fromToken, toToken);
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

                let rate;
                let useCurve = false;
                if (route.status == "NoWay" && topCurveDealPoolIndex === -1) throw "could not find any routes or quote form curve for this token pair";
                else if (route.status !== "NoWay" && topCurveDealPoolIndex !== -1) {
                    const curveAmountOut = ethers.BigNumber.from(
                        _res[1].value[topCurveDealPoolIndex].result
                    );
                    console.log(
                        "best rate from specified curve pools: " +
                        ethers.utils.formatUnits(curveAmountOut, bundledOrders[i].buyTokenDecimals)+
                        " " +
                        bundledOrders[i].buyTokenSymbol
                    );
                    console.log(
                        "best rate from router: " +
                        ethers.utils.formatUnits(
                            route.amountOutBN,
                            bundledOrders[i].buyTokenDecimals
                        ) +
                        " " +
                        bundledOrders[i].buyTokenSymbol
                    );
                    if (route.amountOutBN.lt(_res[1].value[topCurveDealPoolIndex].result)) {
                        useCurve = true;
                    }
                    console.log(useCurve ? "choosing curve..." : "choosing router...");
                    rate = useCurve
                        ? ethers.BigNumber.from(_res[1].value[topCurveDealPoolIndex].result)
                        : route.amountOutBN;
                }
                else if (route.status !== "NoWay" && topCurveDealPoolIndex === -1) {
                    console.log("got no quote from curve");
                    console.log(
                        "best rate from router: " +
                        ethers.utils.formatUnits(
                            route.amountOutBN,
                            bundledOrders[i].buyTokenDecimals
                        ) +
                        " " +
                        bundledOrders[i].buyTokenSymbol
                    );
                    rate = route.amountOutBN;
                }
                else {
                    console.log("found no route from router");
                    console.log(
                        "best rate from specified curve pools: " +
                        ethers.utils.formatUnits(curveAmountOut, bundledOrders[i].buyTokenDecimals)+
                        " " +
                        bundledOrders[i].buyTokenSymbol
                    );
                    rate = ethers.BigNumber.from(_res[1].value[topCurveDealPoolIndex].result);
                    useCurve = true;
                }

                const rateFixed = rate.mul("1" + "0".repeat(18 - bundledOrders[i].buyTokenDecimals));
                const price = rateFixed.mul("1" + "0".repeat(18)).div(cumulativeAmountFixed);
                console.log("");
                console.log(
                    "Current best price for this token pair:",
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

                    let exchangeData;
                    if (!useCurve) {
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
                            config.routeProcessor3Address,
                            // permits
                            // "0.005"
                        );
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
                        exchangeData = ethers.utils.defaultAbiCoder.encode(
                            ["address", "address", "bytes"],
                            [
                                config.routeProcessor3Address,
                                config.routeProcessor3Address,
                                fnData
                            ]
                        );
                    }
                    else {
                        if (bundledOrders[i].curve[topCurveDealPoolIndex].pairFormat === "ucu") {
                            if (config.curve.usdZapAddress) {
                                iface = new ethers.utils.Interface(CURVE_ZAP_FNS[0]);
                                fnData = iface.encodeFunctionData(
                                    "exchange_underlying",
                                    [
                                        bundledOrders[i].curve[
                                            topCurveDealPoolIndex
                                        ].poolContract.address,
                                        bundledOrders[i].curve[
                                            topCurveDealPoolIndex
                                        ].sellTokenIndex.toString(),
                                        bundledOrders[i].curve[
                                            topCurveDealPoolIndex
                                        ].buyTokenIndex.toString(),
                                        bundledQuoteAmount.toString(),
                                        // guaranteedAmount.toString()
                                        "0"
                                    ]
                                );
                                exchangeData = ethers.utils.defaultAbiCoder.encode(
                                    ["address", "address", "bytes"],
                                    [
                                        config.curve.usdZapAddress,
                                        config.curve.usdZapAddress,
                                        fnData
                                    ]
                                );
                            }
                            else throw ">>> cannot find Zap contract address for this network, skipping...";
                        }
                        else {
                            iface = new ethers.utils.Interface(CURVE_POOLS_FNS);
                            if (bundledOrders[i].curve[topCurveDealPoolIndex].pairFormat === "c") {
                                fnData = iface.encodeFunctionData(
                                    "exchange",
                                    [
                                        bundledOrders[i].curve[
                                            topCurveDealPoolIndex
                                        ].sellTokenIndex.toString(),
                                        bundledOrders[i].curve[
                                            topCurveDealPoolIndex
                                        ].buyTokenIndex.toString(),
                                        bundledQuoteAmount.toString(),
                                        // guaranteedAmount.toString()
                                        "0"
                                    ]
                                );
                            }
                            else {
                                fnData = iface.encodeFunctionData(
                                    "exchange_underlying",
                                    [
                                        bundledOrders[i].curve[
                                            topCurveDealPoolIndex
                                        ].sellTokenIndex.toString(),
                                        bundledOrders[i].curve[
                                            topCurveDealPoolIndex
                                        ].buyTokenIndex.toString(),
                                        bundledQuoteAmount.toString(),
                                        // guaranteedAmount.toString()
                                        "0"
                                    ]
                                );
                            }
                            exchangeData = ethers.utils.defaultAbiCoder.encode(
                                ["address", "address", "bytes"],
                                [
                                    bundledOrders[i].curve[
                                        topCurveDealPoolIndex
                                    ].poolContract.address,
                                    bundledOrders[i].curve[
                                        topCurveDealPoolIndex
                                    ].poolContract.address,
                                    fnData
                                ]
                            );
                        }
                    }

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
                            gasLimit = gasLimit.mul("112").div("100");
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
                                    Number(gasCoveragePercentage) * 1.15
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
                                const tx = flashbotSigner !== undefined
                                    ? await flashbotSigner.sendTransaction(rawtx)
                                    : await signer.sendTransaction(rawtx);
                                console.log("\x1b[33m%s\x1b[0m", config.explorer + "tx/" + tx.hash, "\n");
                                console.log(
                                    ">>> Transaction submitted successfully to the network, waiting for transaction to mine...",
                                    "\n"
                                );

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
    crouterClear
};