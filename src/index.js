const fs = require("fs");
const axios = require("axios");
const CONFIG = require("../config.json");
const { curveClear } = require("./curve");
const { DefaultQuery } = require("./query");
const { zeroExClear } = require("./zeroex");
const { routerClear } = require("./router");
const { getOrderDetailsFromJson } = require("./utils");


/**
 * Options for getConfig()
 */
const configOptions = {
    /**
     * The 0x API key
     */
    zeroExApiKey: undefined,
    /**
     * List of liquidity providers for router contract tomoperate on
     */
    liquidityProviders: undefined,
    /**
     * Option to make the app respect 200k 0x API calls per month rate limit
     */
    monthlyRatelimit: undefined
};

/**
 * Options for clear()
 */
const clearOptions = {
    /**
     * The slippage for clearing orders, default is 0.01 i.e. 1 percent
     */
    slippage: "0.01",
    /**
     * The percentage of the gas cost to cover on each transaction
     * for it to be considered profitable and get submitted
     */
    gasCoveragePercentage: "100",
    /**
     * Prioritize better deals to get cleared first, default is true
     */
    prioritization: true
};

/**
 * Get the order details from a source, i.e subgraph or a local json file
 *
 * @param {string} source - The subgraph endpoint URL to query for orders' details
 * @returns An array of order details
 */
const getOrderDetails = async(source, signer) => {
    if (source.startsWith("https://api.thegraph.com/subgraphs/name/")) {
        try {
            const result = await axios.post(
                source,
                { query: DefaultQuery },
                { headers: { "Content-Type": "application/json" } }
            );
            return result.data.data.orders;
        }
        catch {
            throw "Cannot get order details from subgraph";
        }
    }
    else if (source.endsWith(".json")) {
        const content = fs.readFileSync(source).toString();
        return await getOrderDetailsFromJson(content, signer);
    }
    else throw "invalid source for orders";
};

/**
 * Get the configuration info of a network required for the bot
 *
 * @param {string} rpcUrl - The RPC URL
 * @param {string} walletPrivateKey - The wallet private key
 * @param {string} orderbookAddress - The Rain Orderbook contract address deployed on the network
 * @param {string} arbAddress - The Rain Arb contract address deployed on the network
 * @param {configOptions} options - (optional) Optional parameters, 0x API key, liquidity providers and monthly ratelimit
 * @returns The configuration object
 */
const getConfig = async(
    rpcUrl,
    walletPrivateKey,
    orderbookAddress,
    arbAddress,
    options = configOptions
) => {
    const AddressPattern = /^0x[a-fA-F0-9]{40}$/;
    if (!/^(0x)?[a-fA-F0-9]{64}$/.test(walletPrivateKey)) throw "invalid wallet private key";

    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    const signer = new ethers.Wallet(walletPrivateKey, provider);
    const chainId = await signer.getChainId();
    const config = CONFIG.find(v => v.chainId === chainId);
    if (!config) throw `Cannot find configuration for the network with chain id: ${chainId}`;

    if (!AddressPattern.test(orderbookAddress)) throw "invalid orderbook contract address";
    if (!AddressPattern.test(arbAddress)) throw "invalid arb contract address";

    config.rpc = rpcUrl;
    config.signer = signer;
    config.orderbookAddress = orderbookAddress;
    config.arbAddress = arbAddress;
    config.lps = options?.liquidityProviders;
    config.apiKey = options?.zeroExApiKey;
    config.monthlyRatelimit = !!options?.monthlyRatelimit;
    return config;
};

/**
 * Method to clear orders against a liquidity provider
 *
 * @param {string} mode - The mode for clearing, either "0x" or "curve" or "router"
 * @param {object} config - The configuration object
 * @param {any[]} ordersDetails - The order details queried from subgraph
 * @param {clearOptions} options - The options for clear, 'slippage',' gasCoveragePercentage' and 'prioritization'
 * @returns The report of details of cleared orders
 */
const clear = async(
    mode,
    config,
    ordersDetails,
    options = clearOptions
) => {
    const slippage = options.slippage ? options.slippage : clearOptions.slippage;
    const prioritization = options.prioritization
        ? options.prioritization
        : clearOptions.prioritization;
    const gasCoveragePercentage = options.gasCoveragePercentage
        ? options.gasCoveragePercentage
        : clearOptions.gasCoveragePercentage;
    if (mode.toLowerCase() === "0x") return await zeroExClear(
        config,
        ordersDetails,
        slippage,
        gasCoveragePercentage,
        prioritization
    );
    else if (mode.toLowerCase() === "curve") return await curveClear(
        config,
        ordersDetails,
        slippage,
        gasCoveragePercentage,
        prioritization
    );
    else if (mode.toLowerCase() === "router") return await routerClear(
        config,
        ordersDetails,
        slippage,
        gasCoveragePercentage,
        prioritization
    );
    else throw "unknown mode, must be '0x' or 'curve' or 'router'";
};

module.exports = {
    getOrderDetails,
    getConfig,
    clear
};