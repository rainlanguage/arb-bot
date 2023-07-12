#!/usr/bin/env node

require("dotenv").config();
const { sleep } = require("./src/utils");
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
    orders: process?.env?.ORDERS,
    subgraph: process?.env?.SUBGRAPH
        ? Array.from(process?.env?.SUBGRAPH.matchAll(/[^,\s]+/g)).map(v => v[0])
        : undefined,
    apiKey: process?.env?.API_KEY,
    lps: process?.env?.LIQUIDITY_PROVIDERS,
    gasCoverage: process?.env?.GAS_COVER || "100",
    repetitions: process?.env?.REPETITIONS,
    monthlyRatelimit: process?.env?.MONTHLY_RATELIMIT === undefined
        ? true
        : process?.env?.MONTHLY_RATELIMIT.toLowerCase() === "false"
            ? false
            : true,
    useZeroexArb: process?.env?.USE_ZEROEX_ARB?.toLowerCase() === "true"
        ? true
        : false
};

const getOptions = async argv => {
    const cmdOptions = new Command("node arb-bot")
        .description("A NodeJS app to find arbitrage opportunities from liquidity providers and clear Rain Orderbook orders against them")
        .option("-k, --key <private-key>", "Private key of wallet that performs the transactions. Will override the 'BOT_WALLET_PRIVATEKEY' in env variables")
        .option("-r, --rpc <url>", "RPC URL that will be provider for interacting with evm. Will override the 'RPC_URL' in env variables")
        .option("-m, --mode <string>", "Running mode of the bot, must be one of: `0x` or `curve` or `router`, default is `router`, Will override the 'MODE' in env variables")
        .option("-o, --orders <path>", "The ABSOLUTE path to a local json file containing the orders details, can be used in combination with --subgraph, Will override the 'ORDERS' in env variables")
        .option("-s, --subgraph <url...>", "Subgraph URL(s) to read orders details from, can be used in combination with --orders, Will override the 'SUBGRAPH' in env variables")
        .option("--orderbook-address <address>", "Address of the deployed orderbook contract, Will override the 'ORDERBOOK_ADDRESS' in env variables")
        .option("--arb-address <address>", "Address of the deployed arb contract, Will override the 'ARB_ADDRESS' in env variables")
        .option("-l, --lps <string>", "List of liquidity providers (dex) to use by the router as one quoted string seperated by a comma for each, example: 'SushiSwapV2,UniswapV3', Will override the 'LIQUIDITY_PROVIDERS' in env variables")
        .option("-a, --api-key <key>", "0x API key, can be set in env variables, Will override the 'API_KEY' env variable")
        .option("-g, --gas-coverage <integer>", "The percentage of gas to cover to be considered profitable for the transaction to be submitted, an integer greater than equal 0, default is 100 meaning full coverage, Will override the 'GAS_COVER' in env variables")
        .option("--repetitions <integer>", "Option to run `number` of times, if not set will run for infinte number of times")
        .option("--no-monthly-ratelimit", "Option to make the app respect 200k 0x API calls per month rate limit, mainly used when not running this app on a bash loop, Will override the 'MONTHLY_RATELIMIT' in env variables")
        .option("--use-zeroex-arb", "Option to use old version of Arb contract for `0x` mode, i.e dedicated 0x Arb contract, ONLY available for `0x` mode")
        .version(version)
        .parse(argv)
        .opts();

    cmdOptions.key              = cmdOptions.key || DEFAULT_OPTIONS.key;
    cmdOptions.rpc              = cmdOptions.rpc || DEFAULT_OPTIONS.rpc;
    cmdOptions.mode             = cmdOptions.mode || DEFAULT_OPTIONS.mode;
    cmdOptions.arbAddress       = cmdOptions.arbAddress || DEFAULT_OPTIONS.arbAddress;
    cmdOptions.orderbookAddress = cmdOptions.orderbookAddress || DEFAULT_OPTIONS.orderbookAddress;
    cmdOptions.orders           = cmdOptions.orders || DEFAULT_OPTIONS.orders;
    cmdOptions.subgraph         = cmdOptions.subgraph || DEFAULT_OPTIONS.subgraph;
    cmdOptions.apiKey           = cmdOptions.apiKey || DEFAULT_OPTIONS.apiKey;
    cmdOptions.lps              = cmdOptions.lps || DEFAULT_OPTIONS.lps;
    cmdOptions.gasCoverage      = cmdOptions.gasCoverage || DEFAULT_OPTIONS.gasCoverage;
    cmdOptions.monthlyRatelimit = cmdOptions.monthlyRatelimit || DEFAULT_OPTIONS.monthlyRatelimit;
    cmdOptions.useZeroexArb     = cmdOptions.useZeroexArb || DEFAULT_OPTIONS.useZeroexArb;
    cmdOptions.repetitions      = cmdOptions.repetitions || DEFAULT_OPTIONS.repetitions;

    return cmdOptions;
};

const arbRound = async options => {

    if (!options.key) throw "undefined wallet private key";
    if (!options.rpc) throw "undefined RPC URL";
    if (!options.arbAddress) throw "undefined arb contract address";
    if (!options.orderbookAddress) throw "undefined orderbook contract address";
    if (!options.mode) throw "undefined operating mode";

    const config = await getConfig(
        options.rpc,
        options.key,
        options.orderbookAddress,
        options.arbAddress,
        {
            zeroExApiKey: options.apiKey,
            useZeroexArb: options.useZeroexArb,
            liquidityProviders: options.lps
                ? Array.from(options.lps.matchAll(/[^,\s]+/g)).map(v => v[0])
                : undefined,
            monthlyRatelimit: options.monthlyRatelimit,
            hideSensitiveData: true
        }
    );
    const ordersDetails = await getOrderDetails(
        options.subgraph,
        options.orders,
        config.signer
    );
    await clear(
        options.mode,
        config,
        ordersDetails,
        {
            gasCoveragePercentage: options.gasCoverage
        }
    );
};

const main = async argv => {
    let repetitions = -1;
    const options = await getOptions(argv);

    if (options.repetitions) {
        if (/^\d+$/.test(options.repetitions)) repetitions = Number(options.repetitions);
        else throw "invalid repetitions, must be an integer greater than equal 0";
    }

    // eslint-disable-next-line no-constant-condition
    if (repetitions === -1) while (true) {
        try {
            await arbRound(options);
            console.log("\x1b[32m%s\x1b[0m", "Round finished successfully!");
            console.log("Starting next round...", "\n");
        }
        catch (error) {
            console.log("\x1b[31m%s\x1b[0m", "An error occured during the round: ");
            console.log(error);
        }
        await sleep(10000);
    }
    else for (let i = 0; i < repetitions; i++) {
        try {
            await arbRound(options);
            console.log("\x1b[32m%s\x1b[0m", "Round finished successfully!");
            console.log(`Starting round ${i + 1}...`, "\n");
        }
        catch (error) {
            console.log("\x1b[31m%s\x1b[0m", `An error occured during round ${i + 1}:`);
            console.log(error);
        }
        await sleep(10000);
    }
};

main(
    process.argv
).then(
    () => {
        console.log("\x1b[32m%s\x1b[0m", "Rain orderbook arbitrage clearing process finished successfully!");
        process.exit(0);
    }
).catch(
    (v) => {
        console.log("\x1b[31m%s\x1b[0m", "An error occured during execution: ");
        console.log(v);
        process.exit(1);
    }
);