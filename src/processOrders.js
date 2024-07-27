const ethers = require("ethers");
const { BaseError } = require("viem");
const { Token } = require("sushi/currency");
const { arbAbis, orderbookAbi } = require("./abis");
const { SpanStatusCode } = require("@opentelemetry/api");
const {
    getIncome,
    processLps,
    getEthPrice,
    getDataFetcher,
    promiseTimeout,
    bundleOrders,
    getSpanException,
    getVaultBalance,
    createViemClient,
    getActualClearAmount,
    visualizeRoute,
} = require("./utils");
const { Router } = require("sushi/router");

/**
 * Specifies the reason that dryrun failed
 */
const DryrunHaltReason = {
    NoOpportunity: 1,
    NoWalletFund: 2,
    NoRoute: 3,
};

/**
 * Specifies reason that order process halted
 */
const ProcessPairHaltReason = {
    NoWalletFund: 1,
    NoRoute: 2,
    FailedToGetVaultBalance: 3,
    FailedToGetGasPrice: 4,
    FailedToGetEthPrice: 5,
    FailedToGetPools: 6,
    TxFailed: 7,
    TxMineFailed: 8,
    UnexpectedError: 9,
};

/**
 * Specifies status of an processed order report
 */
const ProcessPairReportStatus = {
    EmptyVault: 1,
    NoOpportunity: 2,
    FoundOpportunity: 3,
};

/**
 * Main function that processes all given orders and tries clearing them against onchain liquidity and reports the result
 *
 * @param {object} config - The configuration object
 * @param {any[]} ordersDetails - The order details queried from subgraph
 * @param {import("@opentelemetry/sdk-trace-base").Tracer} tracer
 * @param {import("@opentelemetry/api").Context} ctx
 */
const processOrders = async(
    config,
    ordersDetails,
    tracer,
    ctx,
) => {
    const lps               = processLps(config.lps);
    const viemClient        = createViemClient(config.chain.id, config.rpc, false);
    const dataFetcher       = getDataFetcher(viemClient, lps, false);
    const signer            = config.signer;
    const flashbotSigner    = config.flashbotRpc
        ? new ethers.Wallet(
            signer.privateKey,
            new ethers.providers.JsonRpcProvider(config.flashbotRpc)
        )
        : undefined;

    // instantiating arb contract
    const arb = new ethers.Contract(config.arbAddress, arbAbis, signer);

    // instantiating orderbook contract
    const orderbook = new ethers.Contract(config.orderbookAddress, orderbookAbi, signer);

    // prepare orders
    const bundledOrders = bundleOrders(
        ordersDetails,
        config.shuffle,
        config.bundle,
    );
    if (!bundledOrders.length) return;

    const reports = [];
    for (let i = 0; i < bundledOrders.length; i++) {
        const pair = `${bundledOrders[i].buyTokenSymbol}/${bundledOrders[i].sellTokenSymbol}`;

        // instantiate a span for this pair
        const span = tracer.startSpan(
            (config.bundle ? "bundled-orders" : "single-order") + " " + pair,
            undefined,
            ctx
        );

        // process the pair
        try {
            const result = await processPair({
                config,
                orderPairObject: bundledOrders[i],
                viemClient,
                dataFetcher,
                signer,
                flashbotSigner,
                arb,
                orderbook,
                pair,
            });
            reports.push(result.report);

            // set the span attributes with the values gathered at processPair()
            span.setAttributes(result.spanAttributes);

            // set the otel span status based on report status
            if (result.report.status === ProcessPairReportStatus.EmptyVault) {
                span.setStatus({ code: SpanStatusCode.OK, message: "empty vault" });
            } else if (result.report.status === ProcessPairReportStatus.NoOpportunity) {
                span.setStatus({ code: SpanStatusCode.OK, message: "no opportunity" });
            } else if (result.report.status === ProcessPairReportStatus.FoundOpportunity) {
                span.setStatus({ code: SpanStatusCode.OK, message: "found opportunity" });
            } else {
                // set the span status to unexpected error
                span.setStatus({ code: SpanStatusCode.ERROR, message: "unexpected error" });
            }
        } catch(e) {
            // set the span attributes with the values gathered at processPair()
            span.setAttributes(e.spanAttributes);

            // record otel span status based on reported reason
            if (e.reason) {
                // report the error reason along with the rest of report
                reports.push({
                    ...e.report,
                    error: e.error,
                    reason: e.reason,
                });

                // set the otel span status based on returned reason
                if (e.reason === ProcessPairHaltReason.NoWalletFund) {
                    // in case that wallet has no more funds, terminate the process by breaking the loop
                    if (e.error) span.recordException(getSpanException(e.error));
                    const message = `Recieved insufficient funds error, current balance: ${
                        e.spanAttributes["details.currentWalletBalance"]
                            ? ethers.utils.formatUnits(
                                ethers.BigNumber.from(
                                    e.spanAttributes["details.currentWalletBalance"]
                                )
                            )
                            : "failed to get balance"
                    }`;
                    span.setStatus({ code: SpanStatusCode.ERROR, message });
                    span.end();
                    throw message;
                } else if (e.reason === ProcessPairHaltReason.FailedToGetVaultBalance) {
                    const message = ["failed to get vault balance"];
                    if (e.error) {
                        if (e.error instanceof BaseError) {
                            if (e.error.shortMessage) message.push("Reason: " + e.error.shortMessage);
                            if (e.error.name) message.push("Error: " + e.error.name);
                            if (e.error.details) message.push("Details: " + e.error.details);
                        } else if (e.error instanceof Error) {
                            if (e.error.message) message.push("Reason: " + e.error.message);
                        }
                        span.recordException(getSpanException(e.error));
                    }
                    span.setStatus({ code: SpanStatusCode.ERROR, message: message.join("\n") });
                } else if (e.reason === ProcessPairHaltReason.FailedToGetGasPrice) {
                    if (e.error) span.recordException(getSpanException(e.error));
                    span.setStatus({ code: SpanStatusCode.ERROR, message: pair + ": failed to get gas price" });
                } else if (e.reason === ProcessPairHaltReason.FailedToGetPools) {
                    if (e.error) span.recordException(getSpanException(e.error));
                    span.setStatus({ code: SpanStatusCode.ERROR, message: pair + ": failed to get pool details" });
                } else if (e.reason === ProcessPairHaltReason.FailedToGetEthPrice) {
                    // set OK status because a token might not have a pool and as a result eth price cannot
                    // be fetched for it and if it is set to ERROR it will constantly error on each round
                    // resulting in lots of false positives
                    if (e.error) span.setAttribute("errorDetails", JSON.stringify(getSpanException(e.error)));
                    span.setStatus({ code: SpanStatusCode.OK, message: "failed to get eth price" });
                } else {
                    // set the otel span status as OK as an unsuccessfull clear, this can happen for example
                    // because of mev front running or false positive opportunities, etc
                    if (e.error) span.setAttribute("errorDetails", JSON.stringify(getSpanException(e.error)));
                    span.setStatus({ code: SpanStatusCode.OK });
                    span.setAttribute("unsuccessfullClear", true);
                }
            } else {
                // record the error for the span
                if (e.error) span.recordException(getSpanException(e.error));

                // report the unexpected error reason
                reports.push({
                    ...e.report,
                    error: e.error,
                    reason: ProcessPairHaltReason.UnexpectedError,
                });
                // set the span status to unexpected error
                span.setStatus({ code: SpanStatusCode.ERROR, message: pair + ": unexpected error" });
            }
        }
        span.end();
    }
    return reports;
};

/**
 * Processes an pair order by trying to clear it against an onchain liquidity and reporting the result
 */
async function processPair(args) {
    const {
        config,
        orderPairObject,
        viemClient,
        dataFetcher,
        signer,
        flashbotSigner,
        arb,
        orderbook,
        pair,
    } = args;

    const spanAttributes = {};
    const result = {
        reason: undefined,
        error: undefined,
        report: undefined,
        spanAttributes,
    };

    spanAttributes["details.orders"] = orderPairObject.takeOrders.map(v => v.id);
    spanAttributes["details.pair"] = pair;

    const fromToken = new Token({
        chainId: config.chain.id,
        decimals: orderPairObject.sellTokenDecimals,
        address: orderPairObject.sellToken,
        symbol: orderPairObject.sellTokenSymbol
    });
    const toToken = new Token({
        chainId: config.chain.id,
        decimals: orderPairObject.buyTokenDecimals,
        address: orderPairObject.buyToken,
        symbol: orderPairObject.buyTokenSymbol
    });

    // get vault balance
    let vaultBalance;
    try {
        vaultBalance = await getVaultBalance(
            orderPairObject,
            orderbook.address,
            // if on test, use test hardhat viem client
            config.isTest ? config.testViemClient : viemClient,
            config.isTest ? "0xcA11bde05977b3631167028862bE2a173976CA11" : undefined
        );
        if (vaultBalance.isZero()) {
            result.report = {
                status: ProcessPairReportStatus.EmptyVault,
                tokenPair: pair,
                buyToken: orderPairObject.buyToken,
                sellToken: orderPairObject.sellToken,
            };
            return result;
        }
    } catch(e) {
        result.error = e;
        result.reason = ProcessPairHaltReason.FailedToGetVaultBalance;
        throw result;
    }

    // get gas price
    let gasPrice;
    try {
        // only for test case
        if (config.isTest && config.testType === "gas-price") throw "gas-price";
        const gasPriceBigInt = await viemClient.getGasPrice();
        gasPrice = ethers.BigNumber.from(gasPriceBigInt);
        spanAttributes["details.gasPrice"] = gasPrice.toString();
    } catch(e) {
        result.reason = ProcessPairHaltReason.FailedToGetGasPrice;
        result.error = e;
        throw result;
    }

    // get eth price
    let ethPrice;
    if (config.gasCoveragePercentage !== "0") {
        try {
            const options = {
                fetchPoolsTimeout: 30000,
                memoize: true,
            };
            // pin block number for test case
            if (config.isTest && config.testBlockNumber) {
                options.blockNumber = config.testBlockNumber;
            }
            ethPrice = await getEthPrice(
                config,
                orderPairObject.buyToken,
                orderPairObject.buyTokenDecimals,
                gasPrice,
                dataFetcher,
                options
            );
            if (!ethPrice) {
                result.reason = ProcessPairHaltReason.FailedToGetEthPrice;
                return Promise.reject(result);
            }
            else spanAttributes["details.ethPrice"] = ethPrice;
        } catch(e) {
            result.reason = ProcessPairHaltReason.FailedToGetEthPrice;
            result.error = e;
            throw result;
        }
    }
    else ethPrice = "0";

    // get pool details
    try {
        // only for test case
        if (config.isTest && config.testType === "pools") throw "pools";
        const options = {
            fetchPoolsTimeout: 90000,
            memoize: true,
        };
        // pin block number for test case
        if (config.isTest && config.testBlockNumber) {
            options.blockNumber = config.testBlockNumber;
        }
        await dataFetcher.fetchPoolsForToken(
            fromToken,
            toToken,
            undefined,
            options
        );
    } catch(e) {
        result.reason = ProcessPairHaltReason.FailedToGetPools;
        result.error = e;
        throw result;
    }

    // execute maxInput discovery dryrun logic
    let rawtx,
        gasCostInToken,
        takeOrdersConfigStruct,
        price,
        routeVisual,
        maximumInput,
        oppBlockNumber;
    try {
        const findOppResult = config.bundle
            ? await findOpp({
                mode: 0,
                orderPairObject,
                dataFetcher,
                fromToken,
                toToken,
                signer,
                vaultBalance,
                gasPrice,
                arb,
                ethPrice,
                config,
                viemClient,
            })
            : await findOppWithRetries({
                orderPairObject,
                dataFetcher,
                fromToken,
                toToken,
                signer,
                vaultBalance,
                gasPrice,
                arb,
                ethPrice,
                config,
                viemClient,
            });
        ({
            rawtx,
            gasCostInToken,
            takeOrdersConfigStruct,
            price,
            routeVisual,
            maximumInput,
            oppBlockNumber,
        } = findOppResult.value);

        // record span attrs
        for (attrKey in findOppResult.spanAttributes) {
            if (attrKey !== "oppBlockNumber" && attrKey !== "foundOpp") {
                spanAttributes["details." + attrKey] = findOppResult.spanAttributes[attrKey];
            }
            else {
                spanAttributes[attrKey] = findOppResult.spanAttributes[attrKey];
            }
        }
    } catch (e) {
        if (e.reason === DryrunHaltReason.NoWalletFund) {
            result.reason = ProcessPairHaltReason.NoWalletFund;
            if (e.spanAttributes["currentWalletBalance"]) {
                spanAttributes["details.currentWalletBalance"] = e.spanAttributes["currentWalletBalance"];
            }
            throw result;
        }
        if (e.reason === DryrunHaltReason.NoRoute) {
            result.reason = ProcessPairHaltReason.NoRoute;
            throw result;
        }
        // record all span attributes in case neither of above errors were present
        for (attrKey in e.spanAttributes) {
            if (attrKey !== "oppBlockNumber" && attrKey !== "foundOpp") {
                spanAttributes["details." + attrKey] = e.spanAttributes[attrKey];
            }
            else {
                spanAttributes[attrKey] = e.spanAttributes[attrKey];
            }
        }
        rawtx = undefined;
    }

    if (!rawtx) {
        result.report = {
            status: ProcessPairReportStatus.NoOpportunity,
            tokenPair: pair,
            buyToken: orderPairObject.buyToken,
            sellToken: orderPairObject.sellToken,
        };
        return result;
    }

    // from here on we know an opp is found, so record it in report and in otel span attributes
    result.report = {
        status: ProcessPairReportStatus.FoundOpportunity,
        tokenPair: pair,
        buyToken: orderPairObject.buyToken,
        sellToken: orderPairObject.sellToken,
    };
    spanAttributes["foundOpp"] = true;

    // get block number
    let blockNumber;
    try {
        blockNumber = Number(await viemClient.getBlockNumber());
        spanAttributes["details.blockNumber"] = blockNumber;
        spanAttributes["details.blockNumberDiff"] = blockNumber - oppBlockNumber;
    } catch(e) {
        // dont reject if getting block number fails but just record it,
        // since an opp is found and can ultimately be cleared
        spanAttributes["details.blockNumberError"] = JSON.stringify(getSpanException(e));
    }

    // submit the tx
    let tx, txUrl;
    try {
        spanAttributes["details.route"] = routeVisual;
        spanAttributes["details.maxInput"] = maximumInput.toString();
        spanAttributes["details.marketPrice"] = ethers.utils.formatEther(price);
        spanAttributes["details.gasCostInToken"] = ethers.utils.formatUnits(gasCostInToken, toToken.decimals);

        rawtx.data = arb.interface.encodeFunctionData(
            "arb",
            [
                takeOrdersConfigStruct,
                gasCostInToken.mul(config.gasCoveragePercentage).div("100")
            ]
        );

        // only for test case
        if (config.isTest && config.testType === "tx-fail") throw "tx-fail";

        tx = config.timeout
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

        txUrl = config.chain.blockExplorers.default.url + "/tx/" + tx.hash;
        console.log("\x1b[33m%s\x1b[0m", txUrl, "\n");
        spanAttributes["details.txUrl"] = txUrl;
        spanAttributes["details.tx"] = JSON.stringify(tx);
    } catch(e) {
        // record rawtx in case it is not already present in the error
        if (!JSON.stringify(e).includes(rawtx.data)) spanAttributes[
            "details.rawTx"
        ] = JSON.stringify(rawtx);
        result.error = e;
        result.reason = ProcessPairHaltReason.TxFailed;
        throw result;
    }

    // wait for tx receipt
    try {
        // only for test case
        if (config.isTest && config.testType === "tx-mine-fail") throw "tx-mine-fail";

        const receipt = config.timeout
            ? await promiseTimeout(
                tx.wait(),
                config.timeout,
                `Transaction failed to mine after ${config.timeout}ms`
            )
            : await tx.wait();

        if (receipt.status === 1) {
            spanAttributes["didClear"] = true;

            const clearActualAmount = getActualClearAmount(
                arb.address,
                orderbook.address,
                receipt
            );
            const income = getIncome(await signer.getAddress(), receipt);
            const actualGasCost = ethers.BigNumber.from(
                receipt.effectiveGasPrice
            ).mul(receipt.gasUsed);
            const actualGasCostInToken = ethers.utils.parseUnits(
                ethPrice
            ).mul(
                actualGasCost
            ).div(
                "1" + "0".repeat(
                    36 - orderPairObject.buyTokenDecimals
                )
            );
            const netProfit = income
                ? income.sub(actualGasCostInToken)
                : undefined;

            if (income) {
                spanAttributes["details.income"] = ethers.utils.formatUnits(
                    income,
                    orderPairObject.buyTokenDecimals
                );
                spanAttributes["details.netProfit"] = ethers.utils.formatUnits(
                    netProfit,
                    orderPairObject.buyTokenDecimals
                );
            }
            result.report = {
                status: ProcessPairReportStatus.FoundOpportunity,
                txUrl,
                tokenPair: pair,
                buyToken: orderPairObject.buyToken,
                sellToken: orderPairObject.sellToken,
                clearedAmount: clearActualAmount.toString(),
                actualGasCost: ethers.utils.formatUnits(actualGasCost),
                actualGasCostInToken: ethers.utils.formatUnits(
                    actualGasCostInToken,
                    orderPairObject.buyTokenDecimals
                ),
                income,
                netProfit,
                clearedOrders: orderPairObject.takeOrders.map(
                    v => v.id
                ),
            };
            return result;
        }
        else {
            spanAttributes["details.receipt"] = JSON.stringify(receipt);
            result.reason = ProcessPairHaltReason.TxMineFailed;
            return Promise.reject(result);
        }
    } catch(e) {
        result.error = e;
        result.reason = ProcessPairHaltReason.TxMineFailed;
        throw result;
    }
}

/**
 * Route Processor versions
 */
const getRouteProcessorParamsVersion = {
    "3": Router.routeProcessor3Params,
    "3.1": Router.routeProcessor3_1Params,
    "3.2": Router.routeProcessor3_2Params,
    "4": Router.routeProcessor4Params,
};

/**
 * Executes a extimateGas call for an arb() tx, to determine if the tx is successfull ot not
 */
async function dryrun({
    mode,
    orderPairObject,
    dataFetcher,
    fromToken,
    toToken,
    signer,
    maximumInput,
    gasPrice,
    arb,
    ethPrice,
    config,
    viemClient,
    knownInitGas,
}) {
    const spanAttributes = {};
    const result = {
        value: undefined,
        reason: undefined,
        spanAttributes,
    };

    spanAttributes["maxInput"] = maximumInput.toString();

    const maximumInputFixed = maximumInput.mul(
        "1" + "0".repeat(18 - orderPairObject.sellTokenDecimals)
    );

    // get route details from sushi dataFetcher
    const pcMap = dataFetcher.getCurrentPoolCodeMap(
        fromToken,
        toToken
    );
    const route = Router.findBestRoute(
        pcMap,
        config.chain.id,
        fromToken,
        maximumInput.toBigInt(),
        toToken,
        gasPrice.toNumber(),
    );

    if (route.status == "NoWay" || (config.isTest && config.testType === "no-route")) {
        spanAttributes["route"] = "no-way";
        result.reason = DryrunHaltReason.NoRoute;
        return Promise.reject(result);
    }
    else {
        const rateFixed = ethers.BigNumber.from(route.amountOutBI).mul(
            "1" + "0".repeat(18 - orderPairObject.buyTokenDecimals)
        );
        const price = rateFixed.mul("1" + "0".repeat(18)).div(maximumInputFixed);
        spanAttributes["marketPrice"] = ethers.utils.formatEther(price);

        const routeVisual = [];
        try {
            visualizeRoute(fromToken, toToken, route.legs).forEach(
                v => {routeVisual.push(v);}
            );
        } catch {
            /**/
        }
        spanAttributes["route"] = routeVisual;

        const rpParams = getRouteProcessorParamsVersion["4"](
            pcMap,
            route,
            fromToken,
            toToken,
            arb.address,
            config.routeProcessors["4"],
        );

        const orders = mode === 0
            ? orderPairObject.takeOrders.map(v => v.takeOrder)
            : mode === 1
                ? [orderPairObject.takeOrders[0].takeOrder]
                : mode === 2
                    ? [
                        orderPairObject.takeOrders[0].takeOrder,
                        orderPairObject.takeOrders[0].takeOrder
                    ]
                    : [
                        orderPairObject.takeOrders[0].takeOrder,
                        orderPairObject.takeOrders[0].takeOrder,
                        orderPairObject.takeOrders[0].takeOrder
                    ];

        const takeOrdersConfigStruct = {
            minimumInput: ethers.constants.One,
            maximumInput,
            maximumIORatio: config.maxRatio ? ethers.constants.MaxUint256 : price,
            orders,
            data: ethers.utils.defaultAbiCoder.encode(
                ["bytes"],
                [rpParams.routeCode]
            )
        };

        const rawtx = {
            data: arb.interface.encodeFunctionData("arb", [takeOrdersConfigStruct, "0"]),
            to: arb.address,
            gasPrice
        };

        // trying to find opp with doing gas estimation, once to get gas and calculate
        // minimum sender output and second to check the arb() with headroom
        let gasLimit, blockNumber;
        try {
            if (config.isTest && config.testType === "no-fund") throw "insufficient funds for gas";

            blockNumber = Number(await viemClient.getBlockNumber());
            spanAttributes["blockNumber"] = blockNumber;

            if (knownInitGas.value) {
                gasLimit = knownInitGas.value;
            } else {
                gasLimit = await signer.estimateGas(rawtx);
                knownInitGas.value = gasLimit;
            }
        }
        catch(e) {
            // reason, code, method, transaction, error, stack, message
            const spanError = getSpanException(e);
            const errorString = JSON.stringify(spanError);
            spanAttributes["error"] = spanError;

            // check for no wallet fund
            if (
                (e.code && e.code === ethers.errors.INSUFFICIENT_FUNDS)
                || errorString.includes("gas required exceeds allowance")
                || errorString.includes("insufficient funds for gas")
            ) {
                result.reason = DryrunHaltReason.NoWalletFund;
                spanAttributes["currentWalletBalance"] = (await signer.getBalance()).toString();
            } else {
                result.reason = DryrunHaltReason.NoOpportunity;
            }
            return Promise.reject(result);
        }
        gasLimit = gasLimit.mul("103").div("100");
        rawtx.gasLimit = gasLimit;
        const gasCost = gasLimit.mul(gasPrice);
        const gasCostInToken = ethers.utils.parseUnits(
            ethPrice
        ).mul(
            gasCost
        ).div(
            "1" + "0".repeat(
                36 - orderPairObject.buyTokenDecimals
            )
        );

        // repeat the same process with heaedroom if gas
        // coverage is not 0, 0 gas coverage means 0 minimum
        // sender output which is already called above
        if (config.gasCoveragePercentage !== "0") {
            const headroom = (
                Number(config.gasCoveragePercentage) * 1.05
            ).toFixed();
            rawtx.data = arb.interface.encodeFunctionData(
                "arb",
                [
                    takeOrdersConfigStruct,
                    gasCostInToken.mul(headroom).div("100")
                ]
            );

            try {
                blockNumber = Number(await viemClient.getBlockNumber());
                spanAttributes["blockNumber"] = blockNumber;
                await signer.estimateGas(rawtx);
            }
            catch(e) {
                const spanError = getSpanException(e);
                const errorString = JSON.stringify(spanError);
                spanAttributes["error"] = spanError;

                // check for no wallet fund
                if (
                    (e.code && e.code === ethers.errors.INSUFFICIENT_FUNDS)
                    || errorString.includes("gas required exceeds allowance")
                    || errorString.includes("insufficient funds for gas")
                ) {
                    result.reason = DryrunHaltReason.NoWalletFund;
                    spanAttributes["currentWalletBalance"] = (await signer.getBalance()).toString();
                } else {
                    result.reason = DryrunHaltReason.NoOpportunity;
                }
                return Promise.reject(result);
            }
        }

        // if reached here, it means there was a success and found opp
        // rest of span attr are not needed since they are present in the result.data
        result.spanAttributes = {
            oppBlockNumber: blockNumber,
            foundOpp: true,
        };
        result.value = {
            rawtx,
            maximumInput,
            gasCostInToken,
            takeOrdersConfigStruct,
            price,
            routeVisual,
            oppBlockNumber: blockNumber,
        };
        return result;
    }
}

/**
 * Tries to find an opp by doing a binary search for the maxInput of an arb tx
 * it calls dryrun() on each iteration and based on the outcome, +/- the maxInput
 * until the binary search is over and returns teh final result
 */
async function findOpp({
    mode,
    orderPairObject,
    dataFetcher,
    fromToken,
    toToken,
    signer,
    vaultBalance,
    gasPrice,
    arb,
    ethPrice,
    config,
    viemClient,
}) {
    const spanAttributes = {};
    const result = {
        value: undefined,
        reason: undefined,
        spanAttributes,
    };

    let noRoute = true;
    let maximumInput = vaultBalance;

    const allSuccessHops = [];
    const allHopsAttributes = [];
    const knownInitGas = { value: undefined };
    for (let i = 1; i < config.hops + 1; i++) {
        try {
            const dryrunResult = await dryrun({
                mode,
                orderPairObject,
                dataFetcher,
                fromToken,
                toToken,
                signer,
                maximumInput,
                gasPrice,
                arb,
                ethPrice,
                config,
                viemClient,
                knownInitGas,
            });

            // return early if there was success on first attempt (ie full vault balance)
            // else record the success result
            if (i == 1) {
                return dryrunResult;
            } else {
                allSuccessHops.push(dryrunResult);
            }
            // set the maxInput for next hop by increasing
            maximumInput = maximumInput.add(vaultBalance.div(2 ** i));
        } catch(e) {
            // reject early in case of no wallet fund
            if (e.reason === DryrunHaltReason.NoWalletFund) {
                result.reason = DryrunHaltReason.NoWalletFund;
                spanAttributes["currentWalletBalance"] = e.spanAttributes["currentWalletBalance"];
                return Promise.reject(result);
            } else {
                // the fail reason can only be no route in case all hops fail
                // reasons are no route
                if (e.reason !== DryrunHaltReason.NoRoute) noRoute = false;

                // record this hop attributes
                // error attr is only recorded for first hop,
                // since it is repeated and consumes lots of data
                if (i !== 1) delete e.spanAttributes["error"];
                allHopsAttributes.push(JSON.stringify(e.spanAttributes));
            }

            // set the maxInput for next hop by decreasing
            maximumInput = maximumInput.sub(vaultBalance.div(2 ** i));
        }
    }

    if (allSuccessHops.length) {
        return allSuccessHops[allSuccessHops.length - 1];
    }
    else {
        // in case of no successfull hop, allHopsAttributes will be included
        spanAttributes["hops"] = allHopsAttributes;

        if (noRoute) result.reason = DryrunHaltReason.NoRoute;
        else result.reason = DryrunHaltReason.NoOpportunity;

        return Promise.reject(result);
    }
}

/**
 * Tries to find opportunity for a signle order with retries and returns the best one if found any
 */
async function findOppWithRetries({
    orderPairObject,
    dataFetcher,
    fromToken,
    toToken,
    signer,
    vaultBalance,
    gasPrice,
    arb,
    ethPrice,
    config,
    viemClient,
}) {
    const spanAttributes = {};
    const result = {
        value: undefined,
        reason: undefined,
        spanAttributes,
    };

    const promises = [];
    for (let i = 1; i < config.retries + 1; i++) {
        promises.push(
            findOpp({
                mode: i,
                orderPairObject,
                dataFetcher,
                fromToken,
                toToken,
                signer,
                vaultBalance,
                gasPrice,
                arb,
                ethPrice,
                config,
                viemClient,
            })
        );
    }
    const allPromises = await Promise.allSettled(promises);
    if (allPromises.some(v => v.status === "fulfilled")) {
        let choice;
        for (let i = 0; i < allPromises.length; i++) {
            // from retries, choose the one that can clear the most
            // ie its maxInput is the greatest
            if (allPromises[i].status === "fulfilled") {
                if (
                    !choice ||
                    choice.maximumInput.lt(allPromises[i].value.value.maximumInput)
                ) {
                    // record the attributes of the choosing one
                    for (attrKey in allPromises[i].value.spanAttributes) {
                        spanAttributes[attrKey] = allPromises[i].value.spanAttributes[attrKey];
                    }
                    choice = allPromises[i].value.value;
                }
            }
        }
        result.value = choice;
        return result;
    } else {
        for (let i = 0; i < allPromises.length; i++) {
            if (allPromises[i].reason.reason === DryrunHaltReason.NoWalletFund) {
                result.reason = DryrunHaltReason.NoWalletFund;
                if (allPromises[i].reason.spanAttributes["currentWalletBalance"]) {
                    spanAttributes["currentWalletBalance"] = allPromises[i].reason.spanAttributes["currentWalletBalance"];
                }
                throw result;
            }
            if (allPromises[i].reason.reason === DryrunHaltReason.NoRoute) {
                result.reason = DryrunHaltReason.NoRoute;
                throw result;
            }
        }
        // record all retries span attributes in case neither of above errors were present
        for (attrKey in allPromises[0].reason.spanAttributes) {
            spanAttributes[attrKey] = allPromises[0].reason.spanAttributes[attrKey];
        }
        result.reason = DryrunHaltReason.NoOpportunity;
        throw result;
    }
}

module.exports = {
    processOrders,
    processPair,
    ProcessPairHaltReason,
    ProcessPairReportStatus,
};
