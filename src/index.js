const fs = require("fs");
const axios = require("axios");
const { ethers } = require("ethers");
const CONFIG = require("../config.json");
const { curveClear } = require("./curve");
const { DefaultQuery } = require("./query");
const { zeroExClear } = require("./zeroex");
const { routerClear } = require("./router");
const { getOrderDetailsFromJson, hideSensitiveData } = require("./utils");


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
    monthlyRatelimit: true,
    /**
     * Hides sensitive data such as rpc url and wallet private key from apearing in logs
     */
    hideSensitiveData: true
};

/**
 * Options for clear()
 */
const clearOptions = {
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
 * Get the order details from a source, i.e array of subgraphs and/or a local json file
 *
 * @param {string[]} sgs - The subgraph endpoint URL(s) to query for orders' details
 * @param {string} json - Path to a json file containing orders structs
 * @param {ethers.signer} signer - The ethers signer
 * @returns An array of order details
 */
const getOrderDetails = async(sgs, json, signer) => {
    const ordersDetails = [];
    const isInvalidJson = !json?.endsWith(".json");
    const isInvalidSg = !Array.isArray(sgs) || sgs.length === 0;
    // const isInvalidSg = !sg?.startsWith("https://api.thegraph.com/subgraphs/name/");

    if (isInvalidSg && isInvalidJson) throw "provided sources are invalid";
    else {
        let type = "sg";
        const promises = [];
        if (!isInvalidJson) {
            try {
                const content = fs.readFileSync(json).toString();
                promises.push(getOrderDetailsFromJson(content, signer));
                type = "json";
            }
            catch (error) {
                console.log(error);
            }
        }
        if (!isInvalidSg) {
            sgs.forEach(v => {
                if (v?.startsWith("https://api.thegraph.com/subgraphs/name/")) {
                    promises.push(axios.post(
                        sgs,
                        { query: DefaultQuery },
                        { headers: { "Content-Type": "application/json" } }
                    ));
                }
            });
        }

        const responses = await Promise.allSettled(promises);
        if (responses.every(v => v.status === "rejected")) {
            throw "could not read anything from provided sources";
        }
        else {
            for (let i = 0; i < responses.length; i++) {
                if (i === 0) {
                    if (responses[0].status === "fulfilled") {
                        if (type === "json") ordersDetails.push(...responses[0].value);
                        else ordersDetails.push(...responses[0].value.data.data.orders);
                    }
                    else {
                        if (type === "json") console.log(responses[0].reason);
                        else console.log("Cannot get order details from subgraph");
                    }
                }
                else {
                    if (responses[i].status === "fulfilled") {
                        ordersDetails.push(...responses[i].value.data.data.orders);
                    }
                    else console.log("Cannot get order details from subgraph");
                }
            }
        }
    }
    return ordersDetails;
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
    if (options.hideSensitiveData) hideSensitiveData(
        rpcUrl,
        walletPrivateKey,
        options?.zeroExApiKey
    );

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
    const prioritization = options.prioritization !== undefined
        ? options.prioritization
        : clearOptions.prioritization;
    const gasCoveragePercentage = options.gasCoveragePercentage
        ? options.gasCoveragePercentage
        : clearOptions.gasCoveragePercentage;
    if (mode.toLowerCase() === "0x") return await zeroExClear(
        config,
        ordersDetails,
        gasCoveragePercentage,
        prioritization
    );
    else if (mode.toLowerCase() === "curve") return await curveClear(
        config,
        ordersDetails,
        gasCoveragePercentage,
        prioritization
    );
    else if (mode.toLowerCase() === "router") return await routerClear(
        config,
        ordersDetails,
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