#!/usr/bin/env node

require("dotenv").config();
const { Command } = require("commander");
const { version } = require("./package.json");
const { getOrderDetails, clear, getConfig } = require("./src");


/**
 * Default CLI arguments
 */
const DEFAULT_OPTIONS = {
    key: process?.env?.BOT_WALLET_PRIVATEKEY,
    rpc: process?.env?.RPC_URL,
    mode: process?.env?.MODE || "router",
    arbAddress: process?.env?.ARB_ADDRESS,
    orderbookAddress: process?.env?.ORDERBOOK_ADDRESS,
    ordersSource: process?.env?.ORDERS_SOURCE || "https://api.thegraph.com/subgraphs/name/siddharth2207/slsohysubgraph",
    apiKey: process?.env?.API_KEY,
    lps: process?.env?.LIQUIDITY_PROVIDERS,
    slippage: process?.env?.SLIPPAGE || "0.001",    // 0.1%
    gasCoverage: process?.env?.GAS_COVER || "100",
    monthlyRatelimit: !!process?.env?.MONTHLY_RATELIMIT
};

const getOptions = async argv => {
    const cmdOptions = new Command("node arb-bot")
        .option("-k, --key <private-key>", "Private key of wallet that performs the transactions. Will override the 'BOT_WALLET_PRIVATEKEY' in env variables")
        .option("-r, --rpc <url>", "RPC URL that will be provider for interacting with evm. Will override the 'RPC_URL' in env variables")
        .option("-m, --mode <string>", "Running mode of the bot, must be one of: `0x` or `curve` or `router`, default is `router`, Will override the 'MODE' in env variables")
        .option("--orders-source <url or path>", "The source to read orders details from, either a subgraph URL or an ABSOLUTE path to a local json file, Rain Orderbook's Subgraph is default, Will override the 'ORDERS_SOURCE' in env variables")
        .option("--orderbook-address <address>", "Address of the deployed orderbook contract, Will override the 'ORDERBOOK_ADDRESS' in env variables")
        .option("--arb-address <address>", "Address of the deployed arb contract, Will override the 'ARB_ADDRESS' in env variables")
        .option("-l, --lps <string>", "List of liquidity providers (dex) to use by the router as one quoted string seperated by a comma for each, example: 'SushiSwapV2,UniswapV3', Will override the 'LIQUIDITY_PROVIDERS' in env variables")
        .option("-s, --slippage <number>", "Sets the slippage percentage for the clearing orders, default is 0.001 i.e 0.1%, Will override the 'SLIPPAGE' in env variables")
        .option("-a, --api-key <key>", "0x API key, can be set in env variables, Will override the 'API_KEY' env variable")
        .option("-g, --gas-coverage <number>", "The percentage of gas to cover to be considered profitable for the transaction to be submitted, between 0 - 100, default is 100 meaning full coverage, Will override the 'GAS_COVER' in env variables")
        .option("--no-monthly-ratelimit", "Option to make the app respect 200k 0x API calls per month rate limit, mainly used when not running this app on a bash loop, Will override the 'MONTHLY_RATELIMIT' in env variables")
        .version(version)
        .parse(argv)
        .opts();

    cmdOptions.key              = cmdOptions.key || DEFAULT_OPTIONS.key;
    cmdOptions.rpc              = cmdOptions.rpc || DEFAULT_OPTIONS.rpc;
    cmdOptions.mode             = cmdOptions.mode || DEFAULT_OPTIONS.mode;
    cmdOptions.arbAddress       = cmdOptions.arbAddress || DEFAULT_OPTIONS.arbAddress;
    cmdOptions.orderbookAddress = cmdOptions.orderbookAddress || DEFAULT_OPTIONS.orderbookAddress;
    cmdOptions.ordersSource     = cmdOptions.ordersSource || DEFAULT_OPTIONS.ordersSource;
    cmdOptions.apiKey           = cmdOptions.apiKey || DEFAULT_OPTIONS.apiKey;
    cmdOptions.lps              = cmdOptions.lps || DEFAULT_OPTIONS.lps;
    cmdOptions.slippage         = cmdOptions.slippage || DEFAULT_OPTIONS.slippage;
    cmdOptions.gasCoverage      = cmdOptions.gasCoverage || DEFAULT_OPTIONS.gasCoverage;
    cmdOptions.monthlyRatelimit = cmdOptions.monthlyRatelimit || DEFAULT_OPTIONS.monthlyRatelimit;

    return cmdOptions;
};

const main = async argv => {
    const options = await getOptions(argv);

    if (!options.key) throw "undefined wallet private key";
    if (!options.rpc) throw "undefined RPC URL";
    if (!options.arbAddress) throw "undefined arb contract address";
    if (!options.orderbookAddress) throw "undefined orderbook contract address";
    if (!options.ordersSource) throw "undefined source for orders";
    if (!options.mode) throw "undefined operating mode";

    const config = await getConfig(
        options.rpc,
        options.key,
        options.orderbookAddress,
        options.arbAddress,
        {
            zeroExApiKey: options.apiKey,
            liquidityProviders: options.lps
                ? Array.from(options.lps.matchAll(/[^,\s]+/g)).map(v => v[0])
                : undefined,
            monthlyRatelimit: options.monthlyRatelimit
        }
    );

    const ordersDetails = await getOrderDetails(options.ordersSource, options.signer);
    await clear(
        options.mode,
        config,
        ordersDetails,
        {
            slippage: options.slippage,
            gasCoveragePercentage: options.gasCoverage
        }
    );
};

main(
    process.argv
).then(
    () => {
        console.log("Rain orderbook arbitrage clearing process finished successfully!");
        process.exit(0);
    }
).catch(
    v => {
        console.log(v);
        process.exit(1);
    }
);