const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { ethers } = require("ethers");
const { getQuery } = require("./query");
const { versions } = require("process");
const CONFIG = require("../config.json");
const { curveClear } = require("./modes/curve");
const { routerClear } = require("./modes/router");
const { crouterClear } = require("./modes/crouter");
const { srouterClear } = require("./modes/srouter");
const { getOrderDetailsFromJson, getSpanException } = require("./utils");
const { SpanStatusCode } = require("@opentelemetry/api");


/**
 * Options for getConfig()
 */
const configOptions = {
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
     * Maximize profit for "srouter" mode, comes at the cost of RPC calls
     */
    maxProfit: false,
    /**
     * Maximize maxIORatio for "srouter" mode
     */
    maxRatio: false,
    /**
     * Option for operating with interpreter v2
     */
    interpreterv2: false,
    /**
     * Flag for not bundling orders based on pairs and clear each order individually
     */
    bundle: true,
    /**
     * The amount of hops of binary search for sorouter mode
     */
    hops: 11,
    /**
     * The amount of retries for the same order in sorouter mode
     */
    retries: 1,
    /**
     * Option to use sushi RouteProcessorv3.2, default is v3
     */
    rp32: false
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
};

/**
 * Get the order details from a source, i.e array of subgraphs and/or a local json file
 *
 * @param {string[]} sgs - The subgraph endpoint URL(s) to query for orders' details
 * @param {string} json - Path to a json file containing orders structs
 * @param {ethers.signer} signer - The ethers signer
 * @param {any} sgFilters - The filters for subgraph query
 * @param {import("@opentelemetry/sdk-trace-base").Tracer} tracer
 * @param {import("@opentelemetry/api").Context} ctx
 * @returns An array of order details
 */
const getOrderDetails = async(sgs, json, signer, sgFilters, tracer, ctx) => {
    const ordersDetails = [];
    const isInvalidJson = typeof json !== "string" || !json;
    const isInvalidSg = !Array.isArray(sgs) || sgs.length === 0;

    if (isInvalidSg && isInvalidJson) throw "type of provided sources are invalid";
    else {
        hasjson = false;
        const promises = [];
        if (!isInvalidJson) {
            await tracer.startActiveSpan("read-json-orders", {}, ctx, async (span) => {
                try {
                    const content = fs.readFileSync(path.resolve(json)).toString();
                    const orders = await getOrderDetailsFromJson(content, signer);
                    ordersDetails.push(...orders);
                    hasjson = true;
                    span.setStatus({code: SpanStatusCode.OK});
                }
                catch (error) {
                    span.setStatus({code: SpanStatusCode.ERROR});
                    span.recordException(getSpanException(error));
                }
                span.end();
            });
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
        if (responses.every((v) => v.status === "rejected")) {
            responses.forEach((v, i) => {
                tracer.startActiveSpan("read-sg-orders", {}, ctx, async (span) => {
                    span.setAttribute("details.sgUrl", sgs[i]);
                    span.recordException(getSpanException(v.reason));
                    span.setStatus({code: SpanStatusCode.ERROR});
                    span.end();
                });
            });
            if (!hasjson) throw "could not read anything from provided sources";
        }
        else {
            for (let i = 0; i < responses.length; i++) {
                tracer.startActiveSpan("read-sg-orders", {}, ctx, async (span) => {
                    span.setAttribute("details.sgUrl", sgs[i]);
                    if (responses[i].status === "fulfilled" && responses[i]?.value?.data?.data?.orders) {
                        ordersDetails.push(
                            ...responses[i].value.data.data.orders
                        );
                        span.setStatus({code: SpanStatusCode.OK});
                    }
                    else {
                        span.setStatus({code: SpanStatusCode.ERROR});
                        span.recordException(getSpanException(
                            responses[i].status === "fulfilled"
                                ? "bad url"
                                : responses[i].reason
                        ));
                    }
                    span.end();
                });
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
 * @param {configOptions} options - (optional) Optional parameters, liquidity providers
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

    config.bundle = true;
    if (options?.bundle !== undefined) config.bundle = !!options.bundle;

    let hops = 11;
    if (options.hops) {
        if (typeof options.hops === "number") {
            hops = options.hops;
            if (hops === 0) throw "invalid hops value, must be an integer greater than 0";
        }
        else if (typeof options.hops === "string" && /^\d+$/.test(options.hops)) {
            hops = Number(options.hops);
            if (hops === 0) throw "invalid hops value, must be an integer greater than 0";
        }
        else throw "invalid hops value, must be an integer greater than 0";
    }
    let retries = 1;
    if (options.retries) {
        if (typeof options.retries === "number") {
            retries = options.retries;
            if (retries < 1 || retries > 3) throw "invalid retries value, must be an integer between 1 - 3";
        }
        else if (typeof options.retries === "string" && /^\d+$/.test(options.retries)) {
            retries = Number(options.retries);
            if (retries < 1 || retries > 3) throw "invalid retries value, must be an integer between 1 - 3";
        }
        else throw "invalid retries value, must be an integer between 1 - 3";
    }

    config.rpc              = rpcUrl;
    config.signer           = signer;
    config.orderbookAddress = orderbookAddress;
    config.arbAddress       = arbAddress;
    config.arbType          = arbType?.toLowerCase();
    config.lps              = options?.liquidityProviders;
    config.timeout          = options?.timeout;
    config.flashbotRpc      = options?.flashbotRpc;
    config.maxProfit        = !!options?.maxProfit;
    config.maxRatio         = !!options?.maxRatio;
    config.interpreterv2    = !!options?.interpreterv2;
    config.hops             = hops;
    config.retries          = retries;
    config.rp32             = !!options?.rp32;

    return config;
};

/**
 * Method to find and take arbitrage trades for Rain Orderbook orders against some liquidity providers
 *
 * @param {string} mode - The mode for clearing, either "curve" or "router" or "crouter" or "srouter"
 * @param {object} config - The configuration object
 * @param {any[]} ordersDetails - The order details queried from subgraph
 * @param {clearOptions} options - The options for clear, such as 'gasCoveragePercentage''
 * @param {import("@opentelemetry/sdk-trace-base").Tracer} tracer
 * @param {import("@opentelemetry/api").Context} ctx
 * @returns The report of details of cleared orders
 */
const clear = async(
    mode,
    config,
    ordersDetails,
    options = clearOptions,
    tracer,
    ctx
) => {
    const _mode = mode.toLowerCase();
    const version = versions.node;
    const majorVersion = Number(version.slice(0, version.indexOf(".")));
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

    if (_mode === "curve") {
        if (majorVersion >= 18) return await curveClear(
            config,
            ordersDetails,
            gasCoveragePercentage,
            tracer,
            ctx
        );
        else throw `NodeJS v18 or higher is required for running the app in "curve" mode, current version: ${version}`;
    }
    else if (_mode === "router") {
        if (majorVersion >= 18) return await routerClear(
            config,
            ordersDetails,
            gasCoveragePercentage,
            tracer,
            ctx
        );
        else throw `NodeJS v18 or higher is required for running the app in "router" mode, current version: ${version}`;
    }
    else if (_mode === "crouter") {
        if (majorVersion >= 18) return await crouterClear(
            config,
            ordersDetails,
            gasCoveragePercentage,
            tracer,
            ctx
        );
        else throw `NodeJS v18 or higher is required for running the app in "router" mode, current version: ${version}`;
    }
    else if (_mode === "srouter") {
        if (majorVersion >= 18) return await srouterClear(
            config,
            ordersDetails,
            gasCoveragePercentage,
            tracer,
            ctx
        );
        else throw `NodeJS v18 or higher is required for running the app in "router" mode, current version: ${version}`;
    }
    else throw "unknown mode, must be either of 'crouter' 'curve' or 'router' or 'srouter'";
};

module.exports = {
    getOrderDetails,
    getConfig,
    clear
};