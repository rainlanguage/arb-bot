const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { ethers } = require("ethers");
const { getQuery } = require("./query");
const { versions } = require("process");
const CONFIG = require("../config.json");
const { curveClear } = require("./curve");
const { zeroExClear } = require("./zeroex");
const { routerClear } = require("./router");
const { crouterClear } = require("./crouter");
const { srouterClear } = require("./srouter");
const { getOrderDetailsFromJson, appGlobalLogger } = require("./utils");


/**
 * Options for getConfig()
 */
const configOptions = {
    /**
     * The 0x API key
     */
    zeroExApiKey: undefined,
    /**
     * Seconds to wait for the transaction to mine before disregarding it
     */
    timeout: undefined,
    /**
     * List of liquidity providers for router contract tomoperate on
     */
    liquidityProviders: undefined,
    /**
     * Flashbot rpc url
     */
    flashbotRpc: undefined,
    /**
     * 0x monthly rate limit number, if not specified will not respect 0x monthly rate limit
     */
    monthlyRatelimit: undefined,
    /**
     * Hides sensitive data such as rpc url and wallet private key from apearing in logs
     */
    hideSensitiveData: true,
    /**
     * Option to shorten large data fields in logs
     */
    shortenLargeLogs: true,
    /**
     * Maximize profit for "srouter" mode, comes at the cost of RPC calls
     */
    maxProfit: false,
    /**
     * Maximize maxIORatio for "srouter" mode
     */
    maxRatio: false,
    /**
     * Option to fallback to public rpcs
     */
    usePublicRpcs: false,
    /**
     * Option for operating with interpreter v2
     */
    interpreterv2: false
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
    // /**
    //  * Prioritize better deals to get cleared first, default is true
    //  */
    // prioritization: true
};

/**
 * Get the order details from a source, i.e array of subgraphs and/or a local json file
 *
 * @param {string[]} sgs - The subgraph endpoint URL(s) to query for orders' details
 * @param {string} json - Path to a json file containing orders structs
 * @param {ethers.signer} signer - The ethers signer
 * @param {any} sgFilters - The filters for subgraph query
 * @returns An array of order details
 */
const getOrderDetails = async(sgs, json, signer, sgFilters) => {
    const ordersDetails = [];
    const isInvalidJson = typeof json !== "string" || !json;
    const isInvalidSg = !Array.isArray(sgs) || sgs.length === 0;

    if (isInvalidSg && isInvalidJson) throw "type of provided sources are invalid";
    else {
        let hasJson = false;
        const promises = [];
        if (!isInvalidJson) {
            try {
                const content = fs.readFileSync(path.resolve(json)).toString();
                promises.push(getOrderDetailsFromJson(content, signer));
                hasJson = true;
            }
            catch (error) {
                console.log(error);
            }
        }
        if (!isInvalidSg) {
            sgs.forEach(v => {
                if (v && typeof v === "string") promises.push(axios.post(
                    v,
                    {
                        query: getQuery(
                            sgFilters?.orderHash,
                            sgFilters?.orderOwner,
                            sgFilters?.orderInterpreter
                        )
                    },
                    { headers: { "Content-Type": "application/json" } }
                ));
            });
        }

        const responses = await Promise.allSettled(promises);
        if (responses.every(v => v.status === "rejected")) {
            responses.forEach(v => console.log(v.reason));
            throw "could not read anything from provided sources";
        }
        else {
            for (let i = 0; i < responses.length; i++) {
                if (i === 0) {
                    if (responses[0].status === "fulfilled") {
                        if (hasJson) ordersDetails.push(...responses[0].value);
                        else ordersDetails.push(...responses[0].value.data.data.orders);
                    }
                    else console.log(responses[0].reason);
                }
                else {
                    if (responses[i].status === "fulfilled") ordersDetails.push(
                        ...responses[i].value.data.data.orders
                    );
                    else console.log(responses[i].reason);
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
 * @param {string} arbType - The type of the Arb contract
 * @param {configOptions} options - (optional) Optional parameters, 0x API key, liquidity providers and monthly ratelimit
 * @returns The configuration object
 */
const getConfig = async(
    rpcUrl,
    walletPrivateKey,
    orderbookAddress,
    arbAddress,
    arbType,
    options = configOptions
) => {

    // applied for API mode
    if (!!options.hideSensitiveData || !!options.shortenLargeLogs) appGlobalLogger(
        !!options.hideSensitiveData,
        rpcUrl,
        walletPrivateKey,
        options?.zeroExApiKey
    );

    const AddressPattern = /^0x[a-fA-F0-9]{40}$/;
    if (!/^(0x)?[a-fA-F0-9]{64}$/.test(walletPrivateKey)) throw "invalid wallet private key";
    if (options.timeout !== undefined){
        if (typeof options.timeout === "number") {
            if (!Number.isInteger(options.timeout) || options.timeout == 0) throw "invalid timeout, must be an integer greater than 0";
            else options.timeout = options.timeout * 1000;
        }
        else if (typeof options.timeout === "string") {
            if (/^\d+$/.test(options.timeout)) options.timeout = Number(options.timeout) * 1000;
            else throw "invalid timeout, must be an integer greater than 0";
            if (options.timeout == 0) throw "invalid timeout, must be an integer greater than 0";
        }
        else throw "invalid timeout, must be an integer greater than 0";
    }

    const provider  = new ethers.providers.JsonRpcProvider(rpcUrl);
    const signer    = new ethers.Wallet(walletPrivateKey, provider);
    const chainId   = await signer.getChainId();
    const config    = CONFIG.find(v => v.chainId === chainId);
    if (!config) throw `Cannot find configuration for the network with chain id: ${chainId}`;

    if (!AddressPattern.test(orderbookAddress)) throw "invalid orderbook contract address";
    if (!AddressPattern.test(arbAddress)) throw "invalid arb contract address";

    config.rpc              = rpcUrl;
    config.signer           = signer;
    config.orderbookAddress = orderbookAddress;
    config.arbAddress       = arbAddress;
    config.arbType          = arbType?.toLowerCase();
    config.lps              = options?.liquidityProviders;
    config.apiKey           = options?.zeroExApiKey;
    config.monthlyRatelimit = options?.monthlyRatelimit;
    config.timeout          = options?.timeout;
    config.flashbotRpc      = options?.flashbotRpc;
    config.maxProfit        = !!options?.maxProfit;
    config.maxRatio         = !!options?.maxRatio;
    config.usePublicRpcs    = !!options?.usePublicRpcs;
    config.interpreterv2    = !!options?.interpreterv2;

    return config;
};

/**
 * Method to find and take arbitrage trades for Rain Orderbook orders against some liquidity providers
 *
 * @param {string} mode - The mode for clearing, either "0x" or "curve" or "router"
 * @param {object} config - The configuration object
 * @param {any[]} ordersDetails - The order details queried from subgraph
 * @param {clearOptions} options - The options for clear, such as 'gasCoveragePercentage''
 * @returns The report of details of cleared orders
 */
const clear = async(
    mode,
    config,
    ordersDetails,
    options = clearOptions
) => {
    const _mode = mode.toLowerCase();
    const version = versions.node;
    const majorVersion = Number(version.slice(0, version.indexOf(".")));
    // const prioritization = options.prioritization !== undefined
    //     ? !!options.prioritization
    //     : clearOptions.prioritization;
    const gasCoveragePercentage = options.gasCoveragePercentage !== undefined
        ? options.gasCoveragePercentage
        : clearOptions.gasCoveragePercentage;

    if (_mode !== "srouter") {
        if (!config.arbType) throw "undefined arb contract type";
        if (!/^flash-loan-v[23]$|^order-taker$/.test(config.arbType)) {
            throw "invalid arb contract type, must be either of: 'flash-loan-v2' or 'flash-loan-v3' or 'order-taker'";
        }
    }
    if (config.arbType === "flash-loan-v2" && config.interpreterv2) throw "interpreter v2 is not compatible with flash-loan-v2";

    if (_mode === "0x") return await zeroExClear(
        config,
        ordersDetails,
        gasCoveragePercentage,
        // prioritization
    );
    else if (_mode === "curve") {
        if (majorVersion >= 18) return await curveClear(
            config,
            ordersDetails,
            gasCoveragePercentage,
            // prioritization
        );
        else throw `NodeJS v18 or higher is required for running the app in "curve" mode, current version: ${version}`;
    }
    else if (_mode === "router") {
        if (majorVersion >= 18) return await routerClear(
            config,
            ordersDetails,
            gasCoveragePercentage,
            // prioritization
        );
        else throw `NodeJS v18 or higher is required for running the app in "router" mode, current version: ${version}`;
    }
    else if (_mode === "crouter") {
        if (majorVersion >= 18) return await crouterClear(
            config,
            ordersDetails,
            gasCoveragePercentage,
            // prioritization
        );
        else throw `NodeJS v18 or higher is required for running the app in "router" mode, current version: ${version}`;
    }
    else if (_mode === "srouter") {
        if (majorVersion >= 18) return await srouterClear(
            config,
            ordersDetails,
            gasCoveragePercentage,
            // prioritization
        );
        else throw `NodeJS v18 or higher is required for running the app in "router" mode, current version: ${version}`;
    }
    else throw "unknown mode, must be either of '0x' or 'curve' or 'router' or 'srouter'";
};

module.exports = {
    getOrderDetails,
    getConfig,
    clear
};