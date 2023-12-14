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
            // const quoteChunks = obSellTokenBalance.div("5");

            if (obSellTokenBalance.isZero()) throw `Orderbook has no ${
                bundledOrders[i].sellTokenSymbol
            } balance, skipping...`;

            let ethPrice;
            const gasPrice = await signer.provider.getGasPrice();
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
            let maximumInput = obSellTokenBalance;
            let succesOrFailure = true;
            for (let j = 1; j < 6; j++) {
                // const maximumInput = j === 5 ? obSellTokenBalance : quoteChunks.mul(j);
                const maximumInputFixed = maximumInput.mul(
                    "1" + "0".repeat(18 - bundledOrders[i].sellTokenDecimals)
                );

                console.log(`>>> Trying to arb with ${
                    ethers.utils.formatEther(maximumInputFixed)
                } ${
                    bundledOrders[i].sellTokenSymbol
                } as maximum input`);
                console.log(">>> Getting best route", "\n");

                // await fetchPoolsForTokenWrapper(dataFetcher, fromToken, toToken);
                await dataFetcher.fetchPoolsForToken(fromToken, toToken);
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
                        `could not find any route for this token pair for ${
                            ethers.utils.formatEther(maximumInputFixed)
                        } ${
                            bundledOrders[i].sellTokenSymbol
                        }, trying with a lower amount...`
                    );
                }
                else {
                    const rateFixed = route.amountOutBN.mul(
                        "1" + "0".repeat(18 - bundledOrders[i].buyTokenDecimals)
                    );
                    const price = rateFixed.mul("1" + "0".repeat(18)).div(maximumInputFixed);

                    // filter out orders that are not price match or failed eval when --max-profit is enabled
                    // price check is at +2% as a headroom for current block vs tx block
                    if (maxProfit) bundledOrders[i].takeOrders = bundledOrders[i].takeOrders.filter(
                        v => v.ratio !== undefined ? price.mul("102").div("100").gte(v.ratio) : false
                    );

                    console.log(
                        "Current best route price for this token pair:",
                        `\x1b[33m${ethers.utils.formatEther(price)}\x1b[0m`,
                        "\n"
                    );
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
                                36 - bundledOrders[i].buyTokenDecimals
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
                        if (j == 1 || j == 5) {
                            // submit the tx only if dry runs with headroom is passed
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
                                        clearedOrders: bundledOrders[i].takeOrders.map(
                                            v => v.id
                                        ),
                                    });
                                    j = 6;
                                }
                                else {
                                    succesOrFailure = false;
                                    if (j < 5) console.log(
                                        `could not clear with ${ethers.utils.formatEther(
                                            maximumInputFixed
                                        )} ${
                                            bundledOrders[i].sellTokenSymbol
                                        } as max input, trying with lower amount...`
                                    );
                                    else console.log("could not arb this pair");
                                }
                            }
                            catch (error) {
                                console.log("\x1b[31m%s\x1b[0m", ">>> Transaction execution failed due to:");
                                console.log(error, "\n");
                                throw "failed-exec";
                            }
                        }
                    }
                    catch (error) {
                        succesOrFailure = false;
                        if (error !== "nomatch" && error !== "dryrun" && error !== "failed-exec") {
                            console.log("\x1b[31m%s\x1b[0m", ">>> Transaction failed due to:");
                            console.log(error, "\n");
                            // reason, code, method, transaction, error, stack, message
                        }
                        if (error === "failed-exec") throw "Transaction execution failed, skipping this pair...";
                        if (j < 5) console.log(
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
                maximumInput = succesOrFailure
                    ? maximumInput.add(obSellTokenBalance.div(2 ** j))
                    : maximumInput.sub(obSellTokenBalance.div(2 ** j));
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

module.exports = {
    srouterClear
};
