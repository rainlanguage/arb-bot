import { BigNumber, ethers } from "ethers";
import { BaseError, PublicClient } from "viem";
import { erc20Abi, orderbookAbi } from "../abis";
import { getWithdrawEnsureBytecode } from "../config";
import { containsNodeError, errorSnapshot } from "../error";
import { estimateProfit, withBigintSerializer } from "../utils";
import {
    BotConfig,
    BundledOrders,
    ViemClient,
    TakeOrderDetails,
    DryrunResult,
    SpanAttrs,
} from "../types";

/**
 * Executes a extimateGas call for an intra-orderbook tx (clear2()), to determine if the tx is successfull ot not
 */
export async function dryrun({
    orderPairObject,
    opposingOrder,
    signer,
    gasPrice,
    inputToEthPrice,
    outputToEthPrice,
    config,
    viemClient,
    inputBalance,
    outputBalance,
}: {
    config: BotConfig;
    orderPairObject: BundledOrders;
    viemClient: PublicClient;
    signer: ViemClient;
    gasPrice: bigint;
    inputToEthPrice: string;
    outputToEthPrice: string;
    inputBalance: BigNumber;
    outputBalance: BigNumber;
    opposingOrder: TakeOrderDetails;
}): Promise<DryrunResult> {
    const spanAttributes: SpanAttrs = {};
    const result: DryrunResult = {
        value: undefined,
        reason: undefined,
        spanAttributes,
    };

    const inputBountyVaultId = "1";
    const outputBountyVaultId = "1";
    const obInterface = new ethers.utils.Interface(orderbookAbi);
    const withdrawInputCalldata = obInterface.encodeFunctionData("withdraw2", [
        orderPairObject.buyToken,
        inputBountyVaultId,
        ethers.constants.MaxUint256,
        [],
    ]);
    let withdrawOutputCalldata = obInterface.encodeFunctionData("withdraw2", [
        orderPairObject.sellToken,
        outputBountyVaultId,
        ethers.constants.MaxUint256,
        [],
    ]);
    const clear2Calldata = obInterface.encodeFunctionData("clear2", [
        orderPairObject.takeOrders[0].takeOrder.order,
        opposingOrder.takeOrder.order,
        {
            aliceInputIOIndex: orderPairObject.takeOrders[0].takeOrder.inputIOIndex,
            aliceOutputIOIndex: orderPairObject.takeOrders[0].takeOrder.outputIOIndex,
            bobInputIOIndex: opposingOrder.takeOrder.inputIOIndex,
            bobOutputIOIndex: opposingOrder.takeOrder.outputIOIndex,
            aliceBountyVaultId: inputBountyVaultId,
            bobBountyVaultId: outputBountyVaultId,
        },
        [],
        [],
    ]);
    const rawtx: any = {
        data: obInterface.encodeFunctionData("multicall", [
            [clear2Calldata, withdrawInputCalldata, withdrawOutputCalldata],
        ]),
        to: orderPairObject.orderbook,
        gasPrice,
    };

    // trying to find opp with doing gas estimation, once to get gas and calculate
    // minimum sender output and second time to check the clear2() with withdraw2() and headroom
    let gasLimit, blockNumber;
    try {
        blockNumber = Number(await viemClient.getBlockNumber());
        spanAttributes["blockNumber"] = blockNumber;
        gasLimit = ethers.BigNumber.from(await signer.estimateGas(rawtx));
    } catch (e) {
        // reason, code, method, transaction, error, stack, message
        const isNodeError = containsNodeError(e as BaseError);
        const errMsg = errorSnapshot("", e);
        spanAttributes["isNodeError"] = isNodeError;
        spanAttributes["error"] = errMsg;
        spanAttributes["rawtx"] = JSON.stringify(
            {
                ...rawtx,
                from: signer.account.address,
            },
            withBigintSerializer,
        );
        if (!isNodeError) {
            result.value = {
                noneNodeError: errMsg,
                estimatedProfit: ethers.constants.Zero,
            };
        }
        return Promise.reject(result);
    }
    let gasCost = gasLimit.mul(gasPrice);

    // repeat the same process with heaedroom if gas
    // coverage is not 0, 0 gas coverage means 0 minimum
    // sender output which is already called above
    if (config.gasCoveragePercentage !== "0") {
        const headroom = (Number(config.gasCoveragePercentage) * 1.03).toFixed();
        const task = {
            evaluable: {
                interpreter: orderPairObject.takeOrders[0].takeOrder.order.evaluable.interpreter,
                store: orderPairObject.takeOrders[0].takeOrder.order.evaluable.store,
                bytecode: getWithdrawEnsureBytecode(
                    signer.account.address,
                    orderPairObject.buyToken,
                    orderPairObject.sellToken,
                    inputBalance,
                    outputBalance,
                    ethers.utils.parseUnits(inputToEthPrice),
                    ethers.utils.parseUnits(outputToEthPrice),
                    gasCost.mul(headroom).div("100"),
                ),
            },
            signedContext: [],
        };
        withdrawOutputCalldata = obInterface.encodeFunctionData("withdraw2", [
            orderPairObject.sellToken,
            outputBountyVaultId,
            ethers.constants.MaxUint256,
            [task],
        ]);
        rawtx.data = obInterface.encodeFunctionData("multicall", [
            [clear2Calldata, withdrawInputCalldata, withdrawOutputCalldata],
        ]);

        try {
            blockNumber = Number(await viemClient.getBlockNumber());
            spanAttributes["blockNumber"] = blockNumber;
            gasLimit = ethers.BigNumber.from(await signer.estimateGas(rawtx));
            rawtx.gas = gasLimit.toBigInt();
            gasCost = gasLimit.mul(gasPrice);
            task.evaluable.bytecode = getWithdrawEnsureBytecode(
                signer.account.address,
                orderPairObject.buyToken,
                orderPairObject.sellToken,
                inputBalance,
                outputBalance,
                ethers.utils.parseUnits(inputToEthPrice),
                ethers.utils.parseUnits(outputToEthPrice),
                gasCost.mul(config.gasCoveragePercentage).div("100"),
            );
            withdrawOutputCalldata = obInterface.encodeFunctionData("withdraw2", [
                orderPairObject.sellToken,
                outputBountyVaultId,
                ethers.constants.MaxUint256,
                [task],
            ]);
            rawtx.data = obInterface.encodeFunctionData("multicall", [
                [clear2Calldata, withdrawInputCalldata, withdrawOutputCalldata],
            ]);
        } catch (e) {
            const isNodeError = containsNodeError(e as BaseError);
            const errMsg = errorSnapshot("", e);
            spanAttributes["isNodeError"] = isNodeError;
            spanAttributes["error"] = errMsg;
            spanAttributes["rawtx"] = JSON.stringify(
                {
                    ...rawtx,
                    from: signer.account.address,
                },
                withBigintSerializer,
            );
            if (!isNodeError) {
                result.value = {
                    noneNodeError: errMsg,
                    estimatedProfit: ethers.constants.Zero,
                };
            }
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
        oppBlockNumber: blockNumber,
        estimatedProfit: estimateProfit(
            orderPairObject,
            ethers.utils.parseUnits(inputToEthPrice),
            ethers.utils.parseUnits(outputToEthPrice),
            opposingOrder,
        )!,
    };
    return result;
}

/**
 * Tries to find an opp from the same orderbook's opposing orders
 */
export async function findOpp({
    orderPairObject,
    signer,
    gasPrice,
    inputToEthPrice,
    outputToEthPrice,
    config,
    viemClient,
    orderbooksOrders,
}: {
    config: BotConfig;
    orderPairObject: BundledOrders;
    viemClient: PublicClient;
    signer: ViemClient;
    orderbooksOrders: BundledOrders[][];
    gasPrice: bigint;
    inputToEthPrice: string;
    outputToEthPrice: string;
}): Promise<DryrunResult> {
    const spanAttributes: SpanAttrs = {};
    const result: DryrunResult = {
        value: undefined,
        reason: undefined,
        spanAttributes,
    };

    const ONE = ethers.utils.parseUnits("1");
    const opposingOrders = orderbooksOrders
        .map((v) => {
            if (v[0].orderbook === orderPairObject.orderbook) {
                return v.find(
                    (e) =>
                        e.buyToken === orderPairObject.sellToken &&
                        e.sellToken === orderPairObject.buyToken,
                );
            } else {
                return undefined;
            }
        })
        .find((v) => v !== undefined)
        ?.takeOrders.filter(
            (v) =>
                // not same order
                v.id !== orderPairObject.takeOrders[0].id &&
                // not same owner
                v.takeOrder.order.owner.toLowerCase() !==
                    orderPairObject.takeOrders[0].takeOrder.order.owner.toLowerCase() &&
                // only orders that (priceA x priceB < 1) can be profitbale
                v.quote!.ratio.mul(orderPairObject.takeOrders[0].quote!.ratio).div(ONE).lt(ONE),
        );
    if (!opposingOrders || !opposingOrders.length) throw undefined;

    const allErrorAttributes: string[] = [];
    const erc20 = new ethers.utils.Interface(erc20Abi);
    const inputBalance = ethers.BigNumber.from(
        (
            await viemClient.call({
                to: orderPairObject.buyToken as `0x${string}`,
                data: erc20.encodeFunctionData("balanceOf", [
                    signer.account.address,
                ]) as `0x${string}`,
            })
        ).data,
    );
    const outputBalance = ethers.BigNumber.from(
        (
            await viemClient.call({
                to: orderPairObject.sellToken as `0x${string}`,
                data: erc20.encodeFunctionData("balanceOf", [
                    signer.account.address,
                ]) as `0x${string}`,
            })
        ).data,
    );
    for (let i = 0; i < opposingOrders.length; i++) {
        try {
            return await dryrun({
                orderPairObject,
                opposingOrder: opposingOrders[i],
                signer,
                gasPrice,
                inputToEthPrice,
                outputToEthPrice,
                config,
                viemClient,
                inputBalance,
                outputBalance,
            });
        } catch (e: any) {
            allErrorAttributes.push(JSON.stringify(e.spanAttributes));
        }
    }
    spanAttributes["intraOrderbook"] = allErrorAttributes;
    return Promise.reject(result);
}
