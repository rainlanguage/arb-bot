const ethers = require("ethers");
const { parseAbi } = require("viem");
const { trace, context, SpanStatusCode } = require("@opentelemetry/api");
const { arbAbis, orderbookAbi, CURVE_POOLS_FNS, CURVE_ZAP_FNS } = require("../abis");
const {
    getIncome,
    processLps,
    getEthPrice,
    getDataFetcher,
    getActualPrice,
    promiseTimeout,
    bundleTakeOrders,
    createViemClient,
    getSpanException
} = require("../utils");

/**
 * Returns array of available swaps pairs from specified curve pools in config file
 * @param {any} config - The config of a network from config.json file
 */
const getAvailableSwaps = (config) => {
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
const prepare = (bundledOrders, availableSwaps, config, signer) => {
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
            // v.coins?.includes(pair) ||
            // v.underlyingCoins?.includes(pair) ||
            // v.underlyingCoinsUnwrapped?.includes(pair);
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
            // try {
            //     let rate;
            //     // let cumulativeAmountFixed = ethers.constants.Zero;
            //     // bOrder.takeOrders.forEach(v => {
            //     //     cumulativeAmountFixed = cumulativeAmountFixed.add(v.quoteAmount);
            //     // });
            //     // const cumulativeAmount = cumulativeAmountFixed.div("1" + "0".repeat(18 - bOrder.sellTokenDecimals));
            //     if (pairFormat === "c") {
            //         rate = await bOrder.poolContract.get_dy(
            //             bOrder.sellTokenIndex,
            //             bOrder.buyTokenIndex,
            //             // cumulativeAmount
            //             "1" + "0".repeat(bOrder.sellTokenDecimals)
            //         );
            //     }
            //     else {
            //         rate = await bOrder.poolContract.get_dy_underlying(
            //             bOrder.sellTokenIndex,
            //             bOrder.buyTokenIndex,
            //             // cumulativeAmount
            //             "1" + "0".repeat(bOrder.sellTokenDecimals)
            //         );
            //     }
            //     // const rateFixed = rate.mul("1" + "0".repeat(18 - bOrder.buyTokenDecimals));
            //     // const price = rateFixed.mul("1" + "0".repeat(18)).div(cumulativeAmountFixed);
            //     const price = rate.mul("1" + "0".repeat(18 - bOrder.buyTokenDecimals));
            //     bOrder.initPrice = price;

            //     console.log(`Current market price for ${pair}: ${ethers.utils.formatEther(price)}`);
            //     console.log("Current ratio of the orders in this token pair:");
            //     bOrder.takeOrders.forEach(v => {
            //         console.log(ethers.utils.formatEther(v.ratio));
            //     });
            //     bOrder.takeOrders = bOrder.takeOrders.filter(
            //         v => price.gte(v.ratio)
            //     );
            //     console.log("\n");
            // }
            // catch(error) {
            //     console.log(`>>> could not get price for this ${pair} due to:`);
            //     console.log(error);
            // }
        }
    }
    // console.log(
    //     ">>> Filtering bundled orders with lower ratio than current market price...",
    //     "\n"
    // );
    // bundledOrders = bundledOrders.filter(v => v.initPrice && v.takeOrders.length > 0);
    // if (sort) {
    //     console.log("\n", ">>> Sorting the bundled orders based on initial prices...");
    //     bundledOrders.sort(
    //         (a, b) => a.initPrice.gt(b.initPrice) ? -1 : a.initPrice.lt(b.initPrice) ? 1 : 0
    //     );
    // }
    bundledOrders = bundledOrders.filter(v => v.curve !== undefined);
    return bundledOrders;
};

/**
 * Main function that gets order details from subgraph, bundles the ones that have balance and tries clearing them with curve
 *
 * @param {object} config - The configuration object
 * @param {any[]} ordersDetails - The order details queried from subgraph
 * @param {string} gasCoveragePercentage - (optional) The percentage of the gas cost to cover on each transaction
 * for it to be considered profitable and get submitted
 * @param {import("@opentelemetry/sdk-trace-base").Tracer} tracer
 * @param {import("@opentelemetry/api").Context} ctx
 * @returns The report of details of cleared orders
 */
const curveClear = async(
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
        "\x1b[32mCURVE.FI\x1b[0m",
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
            "details.doesEval": true,
            "details.doesBundle": config.bundle
        });
        try {
            const result = await bundleTakeOrders(
                ordersDetails,
                orderbook,
                arb,
                undefined,
                config.rpc !== "test",
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
    const availableSwaps = getAvailableSwaps(config);
    bundledOrders = prepare(
        bundledOrders,
        availableSwaps,
        config,
        signer
    );

    if (!bundledOrders.length) {
        console.log("Could not find any order to clear for current market price, exiting...", "\n");
        return;
    }

    const clearProcSpan = tracer.startSpan("clear-process", undefined, ctx);
    const clearProcCtx = trace.setSpan(context.active(), clearProcSpan);

    const report = [];
    const viemClient = createViemClient(config.chainId, [config.rpc], false);
    const dataFetcher = getDataFetcher(viemClient, processLps(config.lps));
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


            if (!bundledOrders[i].takeOrders.length) {
                pairSpan.setStatus({code: SpanStatusCode.OK, message: "all orders have empty vault balance"});
                console.log("All orders of this token pair have empty vault balance, skipping...");
            }
            else {
                console.log(">>> order ids", bundledOrders[i].takeOrders.map(v => v.id));
                let cumulativeAmount = ethers.constants.Zero;
                bundledOrders[i].takeOrders.forEach(v => {
                    cumulativeAmount = cumulativeAmount.add(v.quoteAmount);
                });

                const bundledQuoteAmount = cumulativeAmount.div(
                    "1" + "0".repeat(18 - bundledOrders[i].sellTokenDecimals)
                );
                pairSpan.setAttributes({
                    "details.bundledQuoteAmount": bundledQuoteAmount.toString(),
                });

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
                if (/^flash-loan-v3$|^order-taker$/.test(arbType)) {
                    takeOrdersConfigStruct.data = "0x";
                    delete takeOrdersConfigStruct.output;
                    delete takeOrdersConfigStruct.input;
                }

                const _amountOuts = await viemClient.multicall({
                    multicallAddress: viemClient.chain?.contracts?.multicall3?.address,
                    allowFailure: true,
                    contracts: bundledOrders[i].curve.map((curvePool) => {
                        if (curvePool.pairFormat === "c") return {
                            address: curvePool.poolContract.address,
                            chainId: config.chainId,
                            args: [
                                curvePool.sellTokenIndex,
                                curvePool.buyTokenIndex,
                                bundledQuoteAmount.toBigInt()
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
                                bundledQuoteAmount.toBigInt()
                            ],
                            abi: parseAbi(CURVE_POOLS_FNS),
                            functionName: "get_dy_underlying"
                        };
                    })
                });
                const topDealPoolIndex = _amountOuts.indexOf(
                    (_amountOuts.filter(v => v.status === "success").sort(
                        (a, b) => b.result > a.result ? 1 : b.result < a.result ? -1 : 0
                    ))[0]
                );
                if (topDealPoolIndex === -1) {
                    pairSpan.setStatus({code: SpanStatusCode.OK, message: "could not get deal from curve pools"});
                    console.log("could not get deal from curve pools");
                }
                else {
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

                    const dryrunSpan = tracer.startSpan("dryrun", undefined, pairCtx);
                    // submit the transaction
                    try {
                        let fnData;
                        let exchangeData;
                        let iface;
                        if (bundledOrders[i].curve[topDealPoolIndex].pairFormat === "ucu") {
                            if (config.curve.usdZapAddress) {
                                iface = new ethers.utils.Interface(CURVE_ZAP_FNS[0]);
                                fnData = iface.encodeFunctionData(
                                    "exchange_underlying",
                                    [
                                        bundledOrders[i].curve[
                                            topDealPoolIndex
                                        ].poolContract.address,
                                        bundledOrders[i].curve[
                                            topDealPoolIndex
                                        ].sellTokenIndex.toString(),
                                        bundledOrders[i].curve[
                                            topDealPoolIndex
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
                            else console.log(">>> cannot find Zap contract address for this network, skipping...");
                        }
                        else {
                            iface = new ethers.utils.Interface(CURVE_POOLS_FNS);
                            if (bundledOrders[i].curve[topDealPoolIndex].pairFormat === "c") {
                                fnData = iface.encodeFunctionData(
                                    "exchange",
                                    [
                                        bundledOrders[i].curve[
                                            topDealPoolIndex
                                        ].sellTokenIndex.toString(),
                                        bundledOrders[i].curve[
                                            topDealPoolIndex
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
                                            topDealPoolIndex
                                        ].sellTokenIndex.toString(),
                                        bundledOrders[i].curve[
                                            topDealPoolIndex
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
                                    bundledOrders[i].curve[topDealPoolIndex].poolContract.address,
                                    bundledOrders[i].curve[topDealPoolIndex].poolContract.address,
                                    fnData
                                ]
                            );
                        }
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
                                        span.recordException(new Error("could not get ETH price"));
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
                            console.log("can not get ETH price, skipping...", "\n");
                            pairSpan.recordException(new Error("could not get ETH price"));
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
                            console.log("Block Number: " + blockNumber, "\n");

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
                                dryrunSpan.setAttribute("details.headroom", gasCostInToken.mul(headroom).div("100").toString());
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
                                pairSpan.setAttribute("details.takeOrdersConfigStruct", JSON.stringify(takeOrdersConfigStruct));
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

                                const blockNumber = await signer.provider.getBlockNumber();
                                pairSpan.setAttribute("details.blockNumber", blockNumber);
                                console.log("Block Number: " + blockNumber, "\n");

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

                                const income = getIncome(signer, receipt);
                                const clearActualPrice = getActualPrice(
                                    receipt,
                                    orderbookAddress,
                                    arbAddress,
                                    cumulativeAmount,
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
                                // console.log(
                                //     "\x1b[36m%s\x1b[0m",
                                //     `Clear Initial Price: ${ethers.utils.formatEther(bundledOrders[i].initPrice)}`
                                // );
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
                                    "details.clearAmount": bundledQuoteAmount.toString(),
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
                                    clearedAmount: bundledQuoteAmount.toString(),
                                    // clearPrice: ethers.utils.formatEther(
                                    //     bundledOrders[i].initPrice
                                    // ),
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
                            dryrunSpan.recordException(getSpanException(error));
                            console.log("\x1b[31m%s\x1b[0m", ">>> Transaction failed due to:");
                            console.log(error, "\n");
                        }
                    }
                    dryrunSpan.end();
                }
            }
        }
        catch (error) {
            pairSpan.recordException(getSpanException(error));
            pairSpan.setStatus({ code: SpanStatusCode.ERROR });
            console.log("\x1b[31m%s\x1b[0m", ">>> Something went wrong, reason:", "\n");
            console.log(error);
        }
        pairSpan.end();
    }
    clearProcSpan.end();
    return report;
};

module.exports = {
    curveClear
};