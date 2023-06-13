// const fs = require("fs");
// const path = require("path");
const axios = require("axios");
const ethers = require("ethers");
const CONFIG = require("../config.json");
const { DefaultQuery } = require("./query");
// let { abi: orderbookAbi } = require("./abis/OrderBook.json");
// const { abi: erc20Abi } = require("./abis/ERC20Upgradeable.json");
// let { abi: interpreterAbi } = require("./abis/IInterpreterV1.json");
// let { abi: arbAbi } = require("./abis/ZeroExOrderBookFlashBorrower.json");
const {
    interpreterEval,
    getOrderStruct,
    // ETHERSCAN_TX_PAGE,
    // sleep
} = require("./utils");


/**
 * Get the order details from a subgraph
 *
 * @param {string} subgraphUrl - The subgraph endpoint URL to query for orders' details
 * @returns An array of order details
 */
const query = async(subgraphUrl) => {
    try {
        const result = await axios.post(
            subgraphUrl,
            { query: DefaultQuery },
            { headers: { "Content-Type": "application/json" } }
        );
        return result.data.data.orders;
    }
    catch {
        throw "Cannot get order details from subgraph";
    }
};

/**
 * Get the configuration info of a network required for the bot
 * @param {ethers.Wallet} wallet - The ethers wallet with private key instance
 * @param {string} orderbookAddress - The Rain Orderbook contract address deployed on the network
 * @param {string} arbAddress - The Rain Arb contract address deployed on the network
 * @param {string} arbAbiPath - (optional) The path to Arb contract ABI, default is ABI in './src/abis' folder
 * @param {string} interpreterAbiPath - (optional) The path to IInterpreter contract ABI, default is ABI in './src/abis' folder
 * @param {string} orderbookAbiPath - (optional) The path to Orderbook contract ABI, default is ABI in './src/abis' folder
 * @returns The configuration object
 */
const getConfig = async(
    wallet,
    orderbookAddress,
    arbAddress,
    arbAbiPath = "",
    interpreterAbiPath = "",
    orderbookAbiPath = "",
) => {
    const AddressPattern = /^0x[a-fA-F0-9]{40}$/;
    const chainId = (await wallet.getChainId());
    const config = CONFIG.find(v => v.chainId === chainId);
    if (!AddressPattern.test(orderbookAddress)) throw "invalid orderbook contract address";
    if (!AddressPattern.test(arbAddress)) throw "invalid arb contract address";
    config.orderbookAddress = orderbookAddress;
    config.arbAddress = arbAddress;
    if (interpreterAbiPath) config.interpreterAbi = interpreterAbiPath;
    if (arbAbiPath) config.arbAbi = arbAbiPath;
    if (orderbookAbiPath) config.orderbookAbi = orderbookAbiPath;
    return config;
};

/**
 * Builds and bundles orders which their details are queried from a orderbook subgraph by checking the vault balances and evaling
 *
 * @param {any[]} ordersDetails - Orders details queried from subgraph
 * @param {ethers.Contract} orderbook - The Orderbook EthersJS contract instance with signer
 * @param {ethers.Contract} arb - The Arb EthersJS contract instance with signer
 * @param {object} interpreterAbi - The IInterpreterV1 ABI
 * @returns Array of bundled take orders
 */
const bundleTakeOrders = async(ordersDetails, orderbook, arb, interpreterAbi) => {
    const bundledOrders = [];
    const obAsSigner = new ethers.VoidSigner(
        orderbook.address,
        orderbook.signer.provider
    );

    for (let i = 0; i < ordersDetails.length; i++) {
        const order = ordersDetails[i];
        for (let j = 0; j < order.validOutputs.length; j++) {
            const _output = order.validOutputs[j];
            const _outputBalance = ethers.utils.parseUnits(
                ethers.utils.formatUnits(
                    await orderbook.vaultBalance(
                        order.owner.id,
                        _output.token.id,
                        _output.vault.id.split("-")[0]
                    ),
                    _output.token.decimals
                )
            );
            // const _outputBalance = ethers.utils.parseUnits(
            //     ethers.utils.formatUnits(
            //         _output.tokenVault.balance,
            //         _output.token.decimals
            //     )
            // );
            if (!_outputBalance.isZero()) {
                for (let k = 0; k < order.validInputs.length; k ++) {
                    if (_output.token.id !== order.validInputs[k].token.id) {
                        const _input = order.validInputs[k];
                        const { maxOutput, ratio } = await interpreterEval(
                            new ethers.Contract(
                                order.interpreter,
                                interpreterAbi,
                                obAsSigner
                            ),
                            arb.address,
                            orderbook.address,
                            order,
                            k,
                            j
                        );
                        if (maxOutput && ratio) {
                            const quoteAmount = _outputBalance.lte(maxOutput)
                                ? _outputBalance
                                : maxOutput;

                            if (!quoteAmount.isZero()) {
                                // initRequests(
                                //     api,
                                //     initQuotes,
                                //     _output.token.id,
                                //     _output.token.decimals,
                                //     _output.token.symbol
                                // );
                                // initRequests(
                                //     api,
                                //     initQuotes,
                                //     _input.token.id,
                                //     _input.token.decimals,
                                //     _input.token.symbol
                                // );
                                const pair = bundledOrders.find(v =>
                                    v.sellToken === _output.token.id &&
                                  v.buyToken === _input.token.id
                                );
                                if (pair) pair.takeOrders.push({
                                    id: order.id,
                                    ratio,
                                    quoteAmount,
                                    takeOrder: {
                                        order: getOrderStruct(order),
                                        inputIOIndex: k,
                                        outputIOIndex: j,
                                        signedContext: []
                                    }
                                });
                                else bundledOrders.push({
                                    buyToken: _input.token.id,
                                    buyTokenSymbol: _input.token.symbol,
                                    buyTokenDecimals: _input.token.decimals,
                                    sellToken: _output.token.id,
                                    sellTokenSymbol: _output.token.symbol,
                                    sellTokenDecimals: _output.token.decimals,
                                    takeOrders: [{
                                        id: order.id,
                                        ratio,
                                        quoteAmount,
                                        takeOrder: {
                                            order: getOrderStruct(order),
                                            inputIOIndex: k,
                                            outputIOIndex: j,
                                            signedContext: []
                                        }
                                    }]
                                });
                            }
                        }
                    }
                }
            }
        }
    }
    return bundledOrders;
};

module.exports = {
    query,
    getConfig,
    bundleTakeOrders
};