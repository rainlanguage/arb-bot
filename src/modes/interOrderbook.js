const ethers = require("ethers");
const { orderbookAbi } = require("../abis");
const { errorSnapshot } = require("../error");
const { getBountyEnsureBytecode } = require("../config");
const { estimateProfit, withBigintSerializer } = require("../utils");

/**
 * @import { PublicClient } from "viem"
 * @import { BotConfig, BundledOrders, ViemClient, DryrunResult } from "../types"
 */

/**
 * Executes a extimateGas call for an inter-orderbook arb() tx, to determine if the tx is successfull ot not
 * @param {{
 *  config: BotConfig,
 *  orderPairObject: BundledOrders,
 *  viemClient: PublicClient,
 *  signer: ViemClient,
 *  arb: ethers.Contract,
 *  gasPrice: bigint,
 *  inputToEthPrice: string,
 *  outputToEthPrice: string,
 *  opposingOrders: BundledOrders,
 *  maximumInput: ethers.BigNumber
 * }} args
 */
async function dryrun({
    orderPairObject,
    opposingOrders,
    signer,
    maximumInput: maximumInputFixed,
    gasPrice,
    arb,
    inputToEthPrice,
    outputToEthPrice,
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

    const opposingMaxInput = orderPairObject.takeOrders[0].quote.ratio.isZero()
        ? ethers.constants.MaxUint256
        : maximumInputFixed
            .mul(orderPairObject.takeOrders[0].quote.ratio)
            .div(`1${"0".repeat(36 - orderPairObject.buyTokenDecimals)}`);

    const opposingMaxIORatio = orderPairObject.takeOrders[0].quote.ratio.isZero()
        ? ethers.constants.MaxUint256
        : ethers.BigNumber.from(`1${"0".repeat(36)}`)
            .div(orderPairObject.takeOrders[0].quote.ratio);

    // encode takeOrders2()
    const obInterface = new ethers.utils.Interface(orderbookAbi);
    const encodedFN = obInterface.encodeFunctionData(
        "takeOrders2",
        [{
            minimumInput: ethers.constants.One,
            maximumInput: opposingMaxInput, // main maxout * main ratio
            maximumIORatio: opposingMaxIORatio, // inverse of main ratio (1 / ratio)
            orders: opposingOrders.takeOrders.map(v => v.takeOrder), // opposing orders
            data: "0x"
        }]
    );
    const takeOrdersConfigStruct = {
        minimumInput: ethers.constants.One,
        maximumInput,
        maximumIORatio: ethers.constants.MaxUint256,
        orders: [orderPairObject.takeOrders[0].takeOrder],
        data: ethers.utils.defaultAbiCoder.encode(
            ["address", "address", "bytes"],
            [opposingOrders.orderbook, opposingOrders.orderbook, encodedFN]
        )
    };

    const task = {
        evaluable: {
            interpreter: orderPairObject.takeOrders[0].takeOrder.order.evaluable.interpreter,
            store: orderPairObject.takeOrders[0].takeOrder.order.evaluable.store,
            bytecode: "0x"
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
    // minimum sender output and second time to check the arb() with headroom
    let gasLimit, blockNumber;
    try {
        blockNumber = Number(await viemClient.getBlockNumber());
        spanAttributes["blockNumber"] = blockNumber;
        gasLimit = ethers.BigNumber.from(await signer.estimateGas(rawtx));
    }
    catch(e) {
        spanAttributes["error"] = errorSnapshot("", e);
        spanAttributes["rawtx"] = JSON.stringify({
            ...rawtx,
            from: signer.account.address,
        }, withBigintSerializer);
        return Promise.reject(result);
    }
    let gasCost = gasLimit.mul(gasPrice);

    // repeat the same process with heaedroom if gas
    // coverage is not 0, 0 gas coverage means 0 minimum
    // sender output which is already called above
    if (config.gasCoveragePercentage !== "0") {
        const headroom = (
            Number(config.gasCoveragePercentage) * 1.03
        ).toFixed();
        task.evaluable.bytecode = getBountyEnsureBytecode(
            ethers.utils.parseUnits(inputToEthPrice),
            ethers.utils.parseUnits(outputToEthPrice),
            gasCost.mul(headroom).div("100"),
        );
        rawtx.data = arb.interface.encodeFunctionData(
            "arb3",
            [
                orderPairObject.orderbook,
                takeOrdersConfigStruct,
                task
            ]
        );

        try {
            blockNumber = Number(await viemClient.getBlockNumber());
            spanAttributes["blockNumber"] = blockNumber;
            gasLimit = ethers.BigNumber.from(await signer.estimateGas(rawtx));
            rawtx.gas = gasLimit.toBigInt();
            gasCost = gasLimit.mul(gasPrice);
            task.evaluable.bytecode = getBountyEnsureBytecode(
                ethers.utils.parseUnits(inputToEthPrice),
                ethers.utils.parseUnits(outputToEthPrice),
                gasCost.mul(config.gasCoveragePercentage).div("100"),
            );
            rawtx.data = arb.interface.encodeFunctionData(
                "arb3",
                [
                    orderPairObject.orderbook,
                    takeOrdersConfigStruct,
                    task
                ]
            );
        }
        catch(e) {
            spanAttributes["error"] = errorSnapshot("", e);
            spanAttributes["rawtx"] = JSON.stringify({
                ...rawtx,
                from: signer.account.address,
            }, withBigintSerializer);
            return Promise.reject(result);
        }
    }
    rawtx.gas = gasLimit.toBigInt();

    // if reached here, it means there was a success and found opp
    spanAttributes["oppBlockNumber"] = blockNumber;
    spanAttributes["foundOpp"] = true;
    delete spanAttributes["blockNumber"];
    result.value = {
        rawtx,
        maximumInput,
        oppBlockNumber: blockNumber,
        estimatedProfit: estimateProfit(
            orderPairObject,
            ethers.utils.parseUnits(inputToEthPrice),
            ethers.utils.parseUnits(outputToEthPrice),
            opposingOrders,
            undefined,
            maximumInputFixed
        )
    };
    return result;
}

/**
 * Tries to find an opp by doing a binary search for the maxInput of an inter-orderbook arb tx
 * @param {{
 *  config: BotConfig,
 *  orderPairObject: BundledOrders,
 *  viemClient: PublicClient,
 *  signer: ViemClient,
 *  arb: ethers.Contract,
 *  orderbooksOrders: BundledOrders[][],
 *  gasPrice: bigint,
 *  inputToEthPrice: string,
 *  outputToEthPrice: string,
 * }} args
 * @returns {Promise<DryrunResult>}
 */
async function findOpp({
    orderPairObject,
    signer,
    gasPrice,
    arb,
    inputToEthPrice,
    outputToEthPrice,
    config,
    viemClient,
    orderbooksOrders,
}) {
    if (!arb) throw undefined;
    const spanAttributes = {};
    const result = {
        value: undefined,
        reason: undefined,
        spanAttributes,
    };

    const opposingOrderbookOrders = orderbooksOrders.map(v => {
        if (v[0].orderbook !== orderPairObject.orderbook) {
            return v.find(e =>
                e.buyToken === orderPairObject.sellToken &&
                e.sellToken === orderPairObject.buyToken &&
                e.takeOrders.filter(
                    c => c.takeOrder.order.owner.toLowerCase() !==
                    orderPairObject.takeOrders[0].takeOrder.order.owner.toLowerCase()
                ).length > 0
            );
        } else {
            return undefined;
        }
    }).filter(v => v !== undefined);

    if (!opposingOrderbookOrders.length) throw undefined;
    let maximumInput = orderPairObject.takeOrders.reduce(
        (a, b) => a.add(b.quote.maxOutput),
        ethers.constants.Zero
    );
    try {
        // try full maxoutput for all available orderbooks before trying binary search
        return await Promise.any(opposingOrderbookOrders.map(v => {
            // filter out the same owner orders
            const opposingOrders = {
                ...v,
                takeOrders: v.takeOrders.filter(
                    e => e.takeOrder.order.owner.toLowerCase() !==
                    orderPairObject.takeOrders[0].takeOrder.order.owner.toLowerCase()
                )
            };
            return dryrun({
                orderPairObject,
                opposingOrders,
                signer,
                maximumInput,
                gasPrice,
                arb,
                inputToEthPrice,
                outputToEthPrice,
                config,
                viemClient,
            });
        }));
    } catch (e) {
        maximumInput = maximumInput.div(2);
        try {
            // try to find the first resolving binary search
            return await Promise.any(opposingOrderbookOrders.map(v => {
                // filter out the same owner orders
                const opposingOrders = {
                    ...v,
                    takeOrders: v.takeOrders.filter(
                        e => e.takeOrder.order.owner.toLowerCase() !==
                        orderPairObject.takeOrders[0].takeOrder.order.owner.toLowerCase()
                    )
                };
                return binarySearch({
                    orderPairObject,
                    opposingOrders,
                    signer,
                    maximumInput,
                    gasPrice,
                    arb,
                    inputToEthPrice,
                    outputToEthPrice,
                    config,
                    viemClient,
                });
            }));
        } catch { /**/ }
        const allOrderbooksAttributes = {};
        for (let i = 0; i < e.errors.length; i++) {
            allOrderbooksAttributes[
                opposingOrderbookOrders[i].orderbook
            ] =  e.errors[i].spanAttributes;
        }
        spanAttributes["againstOrderbooks"] = JSON.stringify(allOrderbooksAttributes);
        return Promise.reject(result);
    }
}

/**
 * Finds best maximumInput by doing a binary search
 * @param {{
 *  config: BotConfig,
 *  orderPairObject: BundledOrders,
 *  viemClient: PublicClient,
 *  signer: ViemClient,
 *  arb: ethers.Contract,
 *  gasPrice: bigint,
 *  inputToEthPrice: string,
 *  outputToEthPrice: string,
 *  opposingOrders: BundledOrders,
 *  maximumInput: ethers.BigNumber
 * }} args
 */
async function binarySearch({
    orderPairObject,
    opposingOrders,
    signer,
    maximumInput,
    gasPrice,
    arb,
    inputToEthPrice,
    outputToEthPrice,
    config,
    viemClient,
}) {
    const spanAttributes = {};
    const result = {
        value: undefined,
        reason: undefined,
        spanAttributes,
    };
    const allSuccessHops = [];
    const initAmount = ethers.BigNumber.from(maximumInput.toString());
    for (let i = 1; i < config.hops; i++) {
        try {
            allSuccessHops.push(await dryrun({
                orderPairObject,
                opposingOrders,
                signer,
                maximumInput,
                gasPrice,
                arb,
                inputToEthPrice,
                outputToEthPrice,
                config,
                viemClient,
            }));
            // set the maxInput for next hop by increasing
            maximumInput = maximumInput.add(initAmount.div(2 ** i));
        } catch(e) {
            // set the maxInput for next hop by decreasing
            maximumInput = maximumInput.sub(initAmount.div(2 ** i));
        }
    }
    if (allSuccessHops.length) {
        return allSuccessHops[allSuccessHops.length - 1];
    }
    else {
        return Promise.reject(result);
    }
}

module.exports = {
    dryrun,
    findOpp,
};