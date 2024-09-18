const ethers = require("ethers");
const { Router } = require("sushi/router");
const { errorSnapshot } = require("../error");
const { getBountyEnsureBytecode } = require("../config");
const { visualizeRoute, RPoolFilter, clone, estimateProfit, withBigintSerializer } = require("../utils");

/**
 * @import { PublicClient } from "viem"
 * @import { DataFetcher } from "sushi"
 * @import { Token } from "sushi/currency"
 * @import { BotConfig, BundledOrders, ViemClient, DryrunResult } from "../types"
 */

/**
 * Specifies the reason that dryrun failed
 * @readonly
 * @enum {number}
 */
const RouteProcessorDryrunHaltReason = {
    NoOpportunity: 1,
    NoRoute: 2,
};

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
 * @param {{
 *  mode: number,
 *  config: BotConfig,
 *  orderPairObject: BundledOrders,
 *  viemClient: PublicClient,
 *  dataFetcher: DataFetcher,
 *  signer: ViemClient,
 *  arb: ethers.Contract,
 *  gasPrice: bigint,
 *  ethPrice: string,
 *  toToken: Token,
 *  fromToken: Token,
 *  maximumInput: ethers.BigNumber
 * }} args
 */
async function dryrun({
    mode,
    orderPairObject,
    dataFetcher,
    fromToken,
    toToken,
    signer,
    maximumInput: maximumInputFixed,
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

    const maximumInput = maximumInputFixed.div(
        "1" + "0".repeat(18 - orderPairObject.sellTokenDecimals)
    );
    spanAttributes["maxInput"] = maximumInput.toString();

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
        Number(gasPrice),
        undefined,
        RPoolFilter
    );
    if (route.status == "NoWay") {
        spanAttributes["route"] = "no-way";
        result.reason = RouteProcessorDryrunHaltReason.NoRoute;
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

        // exit early if market price is lower than order quote ratio
        if (price.lt(orderPairObject.takeOrders[0].quote.ratio)) {
            result.reason = RouteProcessorDryrunHaltReason.NoOpportunity;
            return Promise.reject(result);
        }

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

        const task = {
            evaluable: {
                interpreter: orderPairObject.takeOrders[0].takeOrder.order.evaluable.interpreter,
                store: orderPairObject.takeOrders[0].takeOrder.order.evaluable.store,
                bytecode: "0x",
            },
            signedContext: []
        };
        const rawtx = {
            data: arb.interface.encodeFunctionData(
                "arb3",
                [
                    orderPairObject.orderbook,
                    takeOrdersConfigStruct,
                    task
                ]
            ),
            to: arb.address,
            gasPrice
        };

        // trying to find opp with doing gas estimation, once to get gas and calculate
        // minimum sender output and second to check the arb() with headroom
        let gasLimit, blockNumber;
        try {
            blockNumber = Number(await viemClient.getBlockNumber());
            spanAttributes["blockNumber"] = blockNumber;
            gasLimit = ethers.BigNumber.from(await signer.estimateGas(rawtx));
        }
        catch(e) {
            // reason, code, method, transaction, error, stack, message
            spanAttributes["error"] = errorSnapshot("", e);
            spanAttributes["rawtx"] = JSON.stringify({
                ...rawtx,
                from: signer.account.address,
            }, withBigintSerializer);
            result.reason = RouteProcessorDryrunHaltReason.NoOpportunity;
            return Promise.reject(result);
        }
        gasLimit = gasLimit.mul("107").div("100");
        rawtx.gas = gasLimit.toBigInt();
        let gasCost = gasLimit.mul(gasPrice);

        // repeat the same process with heaedroom if gas
        // coverage is not 0, 0 gas coverage means 0 minimum
        // sender output which is already called above
        if (config.gasCoveragePercentage !== "0") {
            const headroom = (
                Number(config.gasCoveragePercentage) * 1.05
            ).toFixed();
            task.evaluable.bytecode = getBountyEnsureBytecode(
                ethers.utils.parseUnits(ethPrice),
                ethers.constants.Zero,
                gasCost.mul(headroom).div("100")
            );
            rawtx.data = arb.interface.encodeFunctionData(
                "arb3",
                [
                    orderPairObject.orderbook,
                    takeOrdersConfigStruct,
                    task,
                ]
            );

            try {
                blockNumber = Number(await viemClient.getBlockNumber());
                spanAttributes["blockNumber"] = blockNumber;
                gasLimit = ethers.BigNumber.from(await signer.estimateGas(rawtx));
                gasLimit = gasLimit.mul("107").div("100");
                rawtx.gas = gasLimit.toBigInt();
                gasCost = gasLimit.mul(gasPrice);
                task.evaluable.bytecode = getBountyEnsureBytecode(
                    ethers.utils.parseUnits(ethPrice),
                    ethers.constants.Zero,
                    gasCost.mul(config.gasCoveragePercentage).div("100"),
                );
                rawtx.data = arb.interface.encodeFunctionData(
                    "arb3",
                    [
                        orderPairObject.orderbook,
                        takeOrdersConfigStruct,
                        task,
                    ]
                );
            }
            catch(e) {
                spanAttributes["error"] = errorSnapshot("", e);
                spanAttributes["rawtx"] = JSON.stringify({
                    ...rawtx,
                    from: signer.account.address,
                }, withBigintSerializer);
                result.reason = RouteProcessorDryrunHaltReason.NoOpportunity;
                return Promise.reject(result);
            }
        }

        // if reached here, it means there was a success and found opp
        // rest of span attr are not needed since they are present in the result.data
        spanAttributes["oppBlockNumber"] = blockNumber;
        spanAttributes["foundOpp"] = true;
        delete spanAttributes["blockNumber"];
        result.value = {
            rawtx,
            maximumInput,
            price,
            routeVisual,
            oppBlockNumber: blockNumber,
            estimatedProfit: estimateProfit(
                orderPairObject,
                ethers.utils.parseUnits(ethPrice),
                undefined,
                undefined,
                price,
                maximumInputFixed
            )
        };
        return result;
    }
}

/**
 * Tries to find an opp by doing a binary search for the maxInput of an arb tx
 * it calls dryrun() on each iteration and based on the outcome, +/- the maxInput
 * until the binary search is over and returns teh final result
 * @param {{
 *  mode: number,
 *  config: BotConfig,
 *  orderPairObject: BundledOrders,
 *  viemClient: PublicClient,
 *  dataFetcher: DataFetcher,
 *  signer: ViemClient,
 *  arb: ethers.Contract,
 *  gasPrice: bigint,
 *  ethPrice: string,
 *  toToken: Token,
 *  fromToken: Token
 * }} args
 * @returns {Promise<DryrunResult>}
 */
async function findOpp({
    mode,
    orderPairObject,
    dataFetcher,
    fromToken,
    toToken,
    signer,
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
    const initAmount = orderPairObject.takeOrders.reduce(
        (a, b) => a.add(b.quote.maxOutput),
        ethers.constants.Zero
    );
    let maximumInput = clone(initAmount);

    const allSuccessHops = [];
    const allHopsAttributes = [];
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
            });

            // return early if there was success on first attempt (ie full vault balance)
            // else record the success result
            if (i == 1) {
                return dryrunResult;
            } else {
                allSuccessHops.push(dryrunResult);
            }
            // set the maxInput for next hop by increasing
            maximumInput = maximumInput.add(initAmount.div(2 ** i));
        } catch(e) {
            // the fail reason can only be no route in case all hops fail reasons are no route
            if (e.reason !== RouteProcessorDryrunHaltReason.NoRoute) noRoute = false;

            // record this hop attributes
            // error attr is only recorded for first hop,
            // since it is repeated and consumes lots of data
            if (i !== 1) {
                delete e.spanAttributes["error"];
                delete e.spanAttributes["rawtx"];
            }
            allHopsAttributes.push(JSON.stringify(e.spanAttributes));

            // set the maxInput for next hop by decreasing
            maximumInput = maximumInput.sub(initAmount.div(2 ** i));
        }
    }

    if (allSuccessHops.length) {
        return allSuccessHops[allSuccessHops.length - 1];
    }
    else {
        // in case of no successfull hop, allHopsAttributes will be included
        spanAttributes["hops"] = allHopsAttributes;

        if (noRoute) result.reason = RouteProcessorDryrunHaltReason.NoRoute;
        else result.reason = RouteProcessorDryrunHaltReason.NoOpportunity;

        return Promise.reject(result);
    }
}

/**
 * Tries to find opportunity for a signle order with retries and returns the best one if found any
 * @param {{
 *  config: BotConfig,
 *  orderPairObject: BundledOrders,
 *  viemClient: PublicClient,
 *  dataFetcher: DataFetcher,
 *  signer: ViemClient,
 *  arb: ethers.Contract,
 *  gasPrice: bigint,
 *  ethPrice: string,
 *  toToken: Token,
 *  fromToken: Token
 * }} args
 * @returns {Promise<DryrunResult>}
 */
async function findOppWithRetries({
    orderPairObject,
    dataFetcher,
    fromToken,
    toToken,
    signer,
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
            if (allPromises[i].reason.reason === RouteProcessorDryrunHaltReason.NoRoute) {
                result.reason = RouteProcessorDryrunHaltReason.NoRoute;
                throw result;
            }
        }
        // record all retries span attributes in case neither of above errors were present
        for (attrKey in allPromises[0].reason.spanAttributes) {
            spanAttributes[attrKey] = allPromises[0].reason.spanAttributes[attrKey];
        }
        result.reason = RouteProcessorDryrunHaltReason.NoOpportunity;
        throw result;
    }
}

module.exports = {
    dryrun,
    findOpp,
    findOppWithRetries,
    RouteProcessorDryrunHaltReason,
};