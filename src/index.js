const axios = require("axios");
const CONFIG = require("../config.json");
const { curveClear } = require("./curve");
const { DefaultQuery } = require("./query");
const { zeroExClear } = require("./zeroex");
const { routerClear } = require("./router");


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

//  * @param {string} arbAbiPath - (optional) The path to Arb contract ABI, default is ABI in './src/abis' folder
//  * @param {string} interpreterAbiPath - (optional) The path to IInterpreter contract ABI, default is ABI in './src/abis' folder
//  * @param {string} orderbookAbiPath - (optional) The path to Orderbook contract ABI, default is ABI in './src/abis' folder
/**
 * Get the configuration info of a network required for the bot
 *
 * @param {ethers.Wallet} wallet - The ethers wallet with private key instance
 * @param {string} orderbookAddress - The Rain Orderbook contract address deployed on the network
 * @param {string} arbAddress - The Rain Arb contract address deployed on the network
 * @param {string} zerExApiKey - (optional) The 0x API key
 * @param {string[]} liquidityProviders - (optional) List of liquidity providers for router contract tomoperate on
 * @returns The configuration object
 */
const getConfig = async(
    wallet,
    orderbookAddress,
    arbAddress,
    // arbAbiPath = "",
    // interpreterAbiPath = "",
    // orderbookAbiPath = "",
    zeroExApiKey = undefined,
    liquidityProviders = undefined
) => {
    const AddressPattern = /^0x[a-fA-F0-9]{40}$/;
    const chainId = (await wallet.getChainId());
    const config = CONFIG.find(v => v.chainId === chainId);
    if (!AddressPattern.test(orderbookAddress)) throw "invalid orderbook contract address";
    if (!AddressPattern.test(arbAddress)) throw "invalid arb contract address";
    config.orderbookAddress = orderbookAddress;
    config.arbAddress = arbAddress;
    config.lps = liquidityProviders;
    // if (interpreterAbiPath) config.interpreterAbi = interpreterAbiPath;
    // if (arbAbiPath) config.arbAbi = arbAbiPath;
    // if (orderbookAbiPath) config.orderbookAbi = orderbookAbiPath;
    if (zeroExApiKey) config.apiKey = zeroExApiKey;
    return config;
};

/**
 * Method to clear orders against a liquidity provider
 *
 * @param {string} mode - The mode for clearing, either "0x" or "curve" or "router"
 * @param {ethers.Signer} signer - The ethersjs signer constructed from provided private keys and rpc url provider
 * @param {object} config - The configuration object
 * @param {any[]} ordersDetails - The order details queried from subgraph
 * @param {string} slippage - (optional) The slippage for clearing orders, default is 0.01 i.e. 1 percent
 * @param {string} gasCoveragePercentage - (optional) The percentage of the gas cost to cover on each transaction
 * for it to be considered profitable and get submitted
 * @param {boolean} prioritization - (optional) Prioritize better deals to get cleared first, default is true
 * @returns The report of details of cleared orders
 */
const clear = async(
    mode,
    signer,
    config,
    ordersDetails,
    slippage = "0.01",
    gasCoveragePercentage = "100",
    prioritization = true
) => {
    if (mode.toLowerCase() === "0x") return await zeroExClear(
        signer,
        config,
        ordersDetails,
        slippage,
        gasCoveragePercentage,
        prioritization
    );
    else if (mode.toLowerCase() === "curve") return await curveClear(
        signer,
        config,
        ordersDetails,
        slippage,
        gasCoveragePercentage,
        prioritization
    );
    else if (mode.toLowerCase() === "router") return await routerClear(
        signer,
        config,
        ordersDetails,
        slippage,
        gasCoveragePercentage,
        prioritization
    );
    else throw "unknown mode, must be 0x or curve";
};

module.exports = {
    query,
    getConfig,
    clear
};