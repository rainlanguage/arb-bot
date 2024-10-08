const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { ethers } = require("ethers");
const { versions } = require("process");
const { processLps } = require("./utils");
const { initAccounts } = require("./account");
const { processOrders } = require("./processOrders");
const { getOrderDetailsFromJson } = require("./utils");
const { getQuery, statusCheckQuery } = require("./query");
const { checkSgStatus, handleSgResults } = require("./sg");
const { getChainConfig, createViemClient, getDataFetcher } = require("./config");

/**
 * @import { Tracer } from "@opentelemetry/sdk-trace-base"
 * @import { Span, Context } from "@opentelemetry/api"
 * @import { BotConfig, CliOptions, ConfigOptions, RoundReport } from "./types"
 */

/**
 * Get the order details from a source, i.e array of subgraphs and/or a local json file
 * @param {string[]} sgs - The subgraph endpoint URL(s) to query for orders' details
 * @param {string} json - Path to a json file containing orders structs
 * @param {ethers.Signer} signer - The ethers signer
 * @param {any} sgFilters - The filters for subgraph query
 * @param {Span} span
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
                span?.setAttribute("details.jsonSourceError", JSON.stringify(error));
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
                            sgFilters?.orderbook
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
 * @param {string[]} rpcUrls - The RPC URL array
 * @param {string} walletKey - The wallet mnemonic phrase or private key
 * @param {string} arbAddress - The Rain Arb contract address deployed on the network
 * @param {CliOptions} options - (optional) Optional parameters, liquidity providers
 * @returns {Promise<BotConfig>} The configuration object
 */
const getConfig = async(
    rpcUrls,
    walletKey,
    arbAddress,
    options
) => {
    const AddressPattern = /^0x[a-fA-F0-9]{40}$/;
    if (!AddressPattern.test(arbAddress)) throw "invalid arb contract address";
    if (options.genericArbAddress && !AddressPattern.test(options.genericArbAddress)) {
        throw "invalid generic arb contract address";
    }

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

    let hops = 1;
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

    const allProviders = rpcUrls.map(v => { return new ethers.providers.JsonRpcProvider(v); });
    const provider = new ethers.providers.FallbackProvider(allProviders, 1);
    const chainId = (await provider.getNetwork()).chainId;
    const config = getChainConfig(chainId);
    const lps = processLps(options?.liquidityProviders);
    const viemClient = await createViemClient(chainId, rpcUrls, false, undefined, options?.timeout);
    const dataFetcher = await getDataFetcher(viemClient, lps, false);
    if (!config) throw `Cannot find configuration for the network with chain id: ${chainId}`;

    config.bundle = true;
    if (options?.bundle !== undefined) config.bundle = !!options.bundle;

    config.rpc                      = rpcUrls;
    config.arbAddress               = arbAddress;
    config.genericArbAddress        = options?.genericArbAddress;
    config.timeout                  = options?.timeout;
    config.flashbotRpc              = options?.flashbotRpc;
    config.maxRatio                 = !!options?.maxRatio;
    config.hops                     = hops;
    config.retries                  = retries;
    config.gasCoveragePercentage    = gasCoveragePercentage;
    config.lps                      = lps;
    config.viemClient               = viemClient;
    config.dataFetcher              = dataFetcher;
    config.watchedTokens            = options?.tokens ?? [];
    config.selfFundOrders           = options?.selfFundOrders;

    // init accounts
    const { mainAccount, accounts } = await initAccounts(
        walletKey,
        config,
        options,
    );
    config.mainAccount = mainAccount;
    config.accounts = accounts;

    return config;
};

/**
 * Method to find and take arbitrage trades for Rain Orderbook orders against some liquidity providers
 * @param {BotConfig} config - The configuration object
 * @param {any[]} ordersDetails - The order details queried from subgraph
 * @param {ConfigOptions} options - The options for clear, such as 'gasCoveragePercentage''
 * @param {Tracer} tracer
 * @param {Context} ctx
 * @returns {Promise<RoundReport>} The report of details of cleared orders
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

module.exports = {
    getOrderDetails,
    getConfig,
    clear,
};