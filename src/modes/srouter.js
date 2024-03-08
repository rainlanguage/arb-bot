const ethers = require("ethers");
const { arbAbis, orderbookAbi } = require("../abis");
const { Router, Token } = require("sushiswap-router");
const {
    getIncome,
    processLps,
    getEthPrice,
    getDataFetcher,
    getActualPrice,
    visualizeRoute,
    promiseTimeout,
    bundleTakeOrders,
    getActualClearAmount
} = require("../utils");


/**
 * Main function that gets order details from subgraph, bundles the ones that have balance and tries clearing them with specialized router contract
 *
 * @param {object} config - The configuration object
 * @param {any[]} ordersDetails - The order details queried from subgraph
 * @param {string} gasCoveragePercentage - (optional) The percentage of the gas cost to cover on each transaction
 * for it to be considered profitable and get submitted
 * @returns The report of details of cleared orders
 */
const srouterClear = async(
    config,
    ordersDetails,
    gasCoveragePercentage = "100"
) => {
    if (
        gasCoveragePercentage < 0 ||
        !Number.isInteger(Number(gasCoveragePercentage))
    ) throw "invalid gas coverage percentage, must be an integer greater than equal 0";

    const lps               = processLps(config.lps, config.chainId);
    const dataFetcher       = getDataFetcher(config, lps, !!config.usePublicRpc);
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
    if (ordersDetails.length) {
        console.log(
            "------------------------- Bundling Orders -------------------------", "\n"
        );
        bundledOrders = await bundleTakeOrders(
            ordersDetails,
            orderbook,
            arb,
            maxProfit,
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

            if (!bundledOrders[i].takeOrders.length) throw "All orders of this token pair have empty vault balance, skipping...";

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

            if (obSellTokenBalance.isZero()) throw `Orderbook has no ${
                bundledOrders[i].sellTokenSymbol
            } balance, skipping...`;

            let ethPrice;
            const gasPrice = (await signer.provider.getGasPrice()).mul("11").div("10");
            try {
                if (gasCoveragePercentage !== "0") ethPrice = await getEthPrice(
                    config,
                    bundledOrders[i].buyToken,
                    bundledOrders[i].buyTokenDecimals,
                    gasPrice,
                    dataFetcher
                );
                else ethPrice = "0";
                if (ethPrice === undefined) throw "could not find a route for ETH price, skipping...";
            }
            catch {
                throw "could not get ETH price, skipping...";
            }

            await dataFetcher.fetchPoolsForToken(fromToken, toToken);

            let rawtx, gasCostInToken, takeOrdersConfigStruct, price;
            if (config.bundle) {
                try {
                    ({ rawtx, gasCostInToken, takeOrdersConfigStruct, price } = await checkArb(
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
                    ));
                } catch {
                    rawtx = undefined;
                }
            } else {
                const promises = [];
                for (let j = 1; j < 4; j++) {
                    promises.push(
                        checkArb(
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
                console.log("\x1b[31m%s\x1b[0m", "found no match for this pair...");
            }
            else {
                try {
                    console.log(">>> Trying to submit the transaction...", "\n");
                    rawtx.data = arb.interface.encodeFunctionData(
                        "arb",
                        [
                            takeOrdersConfigStruct,
                            gasCostInToken.mul(gasCoveragePercentage).div("100")
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
                        console.log("could not arb this pair, tx receipt: ");
                        console.log(receipt);
                    }
                }
                catch (error) {
                    console.log("\x1b[31m%s\x1b[0m", ">>> Transaction execution failed due to:");
                    console.log(error, "\n");
                }
            }
        }
        catch (error) {
            if (typeof error === "string") console.log("\x1b[31m%s\x1b[0m", error, "\n");
            else {
                console.log("\x1b[31m%s\x1b[0m", ">>> Something went wrong, reason:", "\n");
                console.log(error);
            }
        }
    }
    return report;
};

async function checkArb(
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
) {
    let succesOrFailure = true;
    let maximumInput = obSellTokenBalance;
    const modeText = mode === 0
        ? "bundled orders"
        : mode === 1
            ? "single order"
            : mode === 2
                ? "double orders"
                : "triple orders";
    for (let j = 1; j < hops + 1; j++) {
        const maximumInputFixed = maximumInput.mul(
            "1" + "0".repeat(18 - bundledOrder.sellTokenDecimals)
        );

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

            // filter out orders that are not price match or failed eval when --max-profit is enabled
            // price check is at +2% as a headroom for current block vs tx block
            if (!mode && maxProfit) bundledOrder.takeOrders = bundledOrder.takeOrders.filter(
                v => v.ratio !== undefined ? price.mul("102").div("100").gte(v.ratio) : false
            );

            if (bundledOrder.takeOrders.length === 0) {
                maximumInput = maximumInput.sub(obSellTokenBalance.div(2 ** j));
                continue;
            }

            console.log(
                `Current best route price for ${modeText} for this token pair:`,
                `\x1b[33m${ethers.utils.formatEther(price)}\x1b[0m`,
                "\n"
            );
            console.log(`>>> Route portions for ${modeText}: `, "\n");
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
                config.routeProcessor3_2Address,
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

            // building and submit the transaction
            try {
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
                gasLimit = gasLimit.mul("112").div("100");
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
                if (gasCoveragePercentage !== "0") {
                    const headroom = (
                        Number(gasCoveragePercentage) * 1.2
                    ).toFixed();
                    rawtx.data = arb.interface.encodeFunctionData(
                        "arb",
                        [
                            takeOrdersConfigStruct,
                            gasCostInToken.mul(headroom).div("100")
                        ]
                    );
                    try {
                        await signer.estimateGas(rawtx);
                    }
                    catch {
                        throw "dryrun";
                    }
                }
                succesOrFailure = true;
                if (j == 1 || j == hops) {
                    return {rawtx, maximumInput, gasCostInToken, takeOrdersConfigStruct, price};
                }
            }
            catch (error) {
                succesOrFailure = false;
                if (error !== "nomatch" && error !== "dryrun") {
                    console.log("\x1b[31m%s\x1b[0m", `>>> Transaction for ${modeText} failed due to:`);
                    console.log(error, "\n");
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
        }
        maximumInput = succesOrFailure
            ? maximumInput.add(obSellTokenBalance.div(2 ** j))
            : maximumInput.sub(obSellTokenBalance.div(2 ** j));
    }
    return Promise.reject();
}

module.exports = {
    srouterClear
};
