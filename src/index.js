const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { ethers } = require("ethers");
const { versions } = require("process");
const { getQuery, statusCheckQuery } = require("./query");
const { processOrders } = require("./processes/processOrders");
const {
    processLps,
    getDataFetcher,
    getChainConfig,
    createViemClient,
    getSpanException,
    getOrderDetailsFromJson,
} = require("./utils");


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
     * Maximize maxIORatio
     */
    maxRatio: false,
    /**
     * Flag for not bundling orders based on pairs and clear each order individually
     */
    bundle: true,
    /**
     * The amount of hops of binary search
     */
    hops: 7,
    /**
     * The amount of retries for the same order
     */
    retries: 1,
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
 * @param {import("@opentelemetry/api").Span} span
 * @returns An array of order details
 */
const getOrderDetails = async(sgs, json, signer, sgFilters, span) => {
    const ordersDetails = [];
    const isInvalidJson = typeof json !== "string" || !json;
    const isInvalidSg = !Array.isArray(sgs) || sgs.length === 0;

    if (isInvalidSg && isInvalidJson) throw "type of provided sources are invalid";
    else {
        let availableSgs = [];
        hasjson = false;
        const promises = [];
        if (!isInvalidJson) {
            try {
                const content = fs.readFileSync(path.resolve(json)).toString();
                const orders = await getOrderDetailsFromJson(content, signer);
                ordersDetails.push(...orders);
                hasjson = true;
            }
            catch (error) {
                span.setAttribute("details.jsonSourceError", JSON.stringify(getSpanException(error)));
            }
        }
        if (!isInvalidSg) {
            const validSgs = [];
            const statusCheckPromises = [];
            sgs.forEach(v => {
                if (v && typeof v === "string") {
                    statusCheckPromises.push(axios.post(
                        v,
                        { query: statusCheckQuery },
                        { headers: { "Content-Type": "application/json" } }
                    ));
                    validSgs.push(v);
                }
            });
            const statusResult = await Promise.allSettled(statusCheckPromises);
            ({ availableSgs } = checkSgStatus(
                validSgs,
                statusResult,
                span,
                hasjson
            ));

            availableSgs.forEach(v => {
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
        ordersDetails.push(...handleSgResults(availableSgs, responses, span, hasjson));
    }
    return ordersDetails;
};

/**
 * Get the general and network configuration required for the bot to operate
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
    options = configOptions
) => {
    const AddressPattern = /^0x[a-fA-F0-9]{40}$/;
    if (!AddressPattern.test(orderbookAddress)) throw "invalid orderbook contract address";
    if (!AddressPattern.test(arbAddress)) throw "invalid arb contract address";

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

    let gasCoveragePercentage = "100";
    if (options.gasCoveragePercentage) {
        if (typeof options.gasCoveragePercentage === "number") {
            if (
                options.gasCoveragePercentage < 0 ||
                !Number.isInteger(options.gasCoveragePercentage)
            ) "invalid gas coverage percentage, must be an integer greater than equal 0";
            gasCoveragePercentage = options.gasCoveragePercentage.toString();
        }
        else if (typeof options.gasCoveragePercentage === "string" && /^[0-9]+$/.test(options.gasCoveragePercentage)) {
            gasCoveragePercentage = options.gasCoveragePercentage;
        }
        else throw "invalid gas coverage percentage, must be an integer greater than equal 0";
    }

    let hops = 7;
    if (options.hops) {
        if (typeof options.hops === "number") {
            hops = options.hops;
            if (hops === 0) throw "invalid hops value, must be an integer greater than 0";
        }
        else if (typeof options.hops === "string" && /^[0-9]+$/.test(options.hops)) {
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
        else if (typeof options.retries === "string" && /^[0-9]+$/.test(options.retries)) {
            retries = Number(options.retries);
            if (retries < 1 || retries > 3) throw "invalid retries value, must be an integer between 1 - 3";
        }
        else throw "invalid retries value, must be an integer between 1 - 3";
    }

    const provider  = new ethers.providers.JsonRpcProvider(rpcUrl);
    const signer    = new ethers.Wallet(walletPrivateKey, provider);
    const chainId   = await signer.getChainId();
    const config    = getChainConfig(chainId);
    if (!config) throw `Cannot find configuration for the network with chain id: ${chainId}`;

    config.bundle = true;
    if (options?.bundle !== undefined) config.bundle = !!options.bundle;

    const lps               = processLps(options?.liquidityProviders);
    const viemClient        = createViemClient(chainId, [rpcUrl], false);
    const dataFetcher       = getDataFetcher(viemClient, lps, false);

    config.rpc                      = rpcUrl;
    config.signer                   = signer;
    config.orderbookAddress         = orderbookAddress;
    config.arbAddress               = arbAddress;
    config.lps                      = options?.liquidityProviders;
    config.timeout                  = options?.timeout;
    config.flashbotRpc              = options?.flashbotRpc;
    config.maxRatio                 = !!options?.maxRatio;
    config.hops                     = hops;
    config.retries                  = retries;
    config.gasCoveragePercentage    = gasCoveragePercentage;
    config.viemClient               = viemClient;
    config.dataFetcher              = dataFetcher;

    return config;
};

/**
 * Method to find and take arbitrage trades for Rain Orderbook orders against some liquidity providers
 *
 * @param {object} config - The configuration object
 * @param {any[]} ordersDetails - The order details queried from subgraph
 * @param {clearOptions} options - The options for clear, such as 'gasCoveragePercentage''
 * @param {import("@opentelemetry/sdk-trace-base").Tracer} tracer
 * @param {import("@opentelemetry/api").Context} ctx
 * @returns The report of details of cleared orders
 */
const clear = async(
    config,
    ordersDetails,
    tracer,
    ctx,
) => {
    const version = versions.node;
    const majorVersion = Number(version.slice(0, version.indexOf(".")));

    if (majorVersion >= 18) return await processOrders(
        config,
        ordersDetails,
        tracer,
        ctx,
    );
    else throw `NodeJS v18 or higher is required for running the app, current version: ${version}`;
};


/**
 * Checks a subgraph health status and records the result in an object or throws
 * error if all given subgraphs are unhealthy
 */
function checkSgStatus(validSgs, statusResult, span, hasjson) {
    const availableSgs = [];
    const reasons = {};
    for (let i = 0; i < statusResult.length; i++) {
        if (statusResult[i].status === "fulfilled") {
            const sgStatus = statusResult[i]?.value?.data?.data?._meta;
            if (sgStatus) {
                if (sgStatus.hasIndexingErrors) {
                    reasons[validSgs[i]] = "subgraph has indexing error";
                } else availableSgs.push(validSgs[i]);
            } else {
                reasons[validSgs[i]] = "did not receive valid status response";
            }
        } else {
            reasons[validSgs[i]] = statusResult[i].reason;
        }
    }
    if (Object.keys(reasons).length) span?.setAttribute("details.sgsStatusCheck", JSON.stringify(reasons));
    if (!hasjson && Object.keys(reasons).length === statusResult.length) throw "unhealthy subgraph";

    return { availableSgs, reasons };
}

/**
 * Handles the result of querying multiple subgraphs, by recording the errors
 * and resolved order details, if all given subgraphs error, it will throw an
 * error else, it will record errors in span attributes and returns the resolved
 * order details.
 */
function handleSgResults(availableSgs, responses, span, hasjson) {
    const reasons = {};
    const ordersDetails = [];
    for (let i = 0; i < responses.length; i++) {
        if (responses[i].status === "fulfilled" && responses[i]?.value?.data?.data?.orders) {
            ordersDetails.push(
                ...responses[i].value.data.data.orders
            );
        }
        else if (responses[i].status === "rejected") {
            reasons[availableSgs[i]] = responses[i].reason;
        }
    }
    if (Object.keys(reasons).length) span?.setAttribute("details.sgSourcesErrors", JSON.stringify(reasons));
    if (!hasjson && Object.keys(reasons).length === responses.length) throw "could not get order details from given sgs";
    return ordersDetails;
}

module.exports = {
    getOrderDetails,
    getConfig,
    clear,
    checkSgStatus,
    handleSgResults,
};