#!/usr/bin/env node

require("dotenv").config();
const { Command } = require("commander");
const { version } = require("./package.json");
const { sleep, appGlobalLogger } = require("./src/utils");
const { getOrderDetails, clear, getConfig } = require("./src");


/**
 * Default CLI arguments
 */
const DEFAULT_OPTIONS = {
    key                 : process?.env?.BOT_WALLET_PRIVATEKEY,
    mode                : process?.env?.MODE,
    arbAddress          : process?.env?.ARB_ADDRESS,
    arbType             : process?.env?.ARB_TYPE,
    orderbookAddress    : process?.env?.ORDERBOOK_ADDRESS,
    orders              : process?.env?.ORDERS,
    apiKey              : process?.env?.API_KEY,
    lps                 : process?.env?.LIQUIDITY_PROVIDERS,
    gasCoverage         : process?.env?.GAS_COVER || "100",
    repetitions         : process?.env?.REPETITIONS,
    orderHash           : process?.env?.ORDER_HASH,
    orderOwner          : process?.env?.ORDER_OWNER,
    orderInterpreter    : process?.env?.ORDER_INTERPRETER,
    monthlyRatelimit    : process?.env?.MONTHLY_RATELIMIT,
    sleep               : process?.env?.SLEEP,
    maxProfit           : process?.env?.MAX_PROFIT?.toLowerCase() === "true" ? true : false,
    maxRatio            : process?.env?.MAX_RATIO?.toLowerCase() === "true" ? true : false,
    usePublicRpcs       : process?.env?.USE_PUBLIC_RPCS?.toLowerCase() === "true" ? true : false,
    timeout             : process?.env?.TIMEOUT,
    flashbotRpc         : process?.env?.FLASHBOT_RPC,
    rpc                 : process?.env?.RPC_URL
        ? Array.from(process?.env?.RPC_URL.matchAll(/[^,\s]+/g)).map(v => v[0])
        : undefined,
    subgraph            : process?.env?.SUBGRAPH
        ? Array.from(process?.env?.SUBGRAPH.matchAll(/[^,\s]+/g)).map(v => v[0])
        : undefined
};

const getOptions = async argv => {
    const cmdOptions = new Command("node arb-bot")
        .option("-k, --key <private-key>", "Private key of wallet that performs the transactions. Will override the 'BOT_WALLET_PRIVATEKEY' in env variables")
        .option("-r, --rpc <url...>", "RPC URL(s) that will be provider for interacting with evm, use different providers if more than 1 is specified to prevent banning. Will override the 'RPC_URL' in env variables")
        .option("-m, --mode <string>", "Running mode of the bot, must be one of: `0x` or `curve` or `router` or `crouter` or `srouter`, Will override the 'MODE' in env variables")
        .option("-o, --orders <path>", "The path to a local json file containing the orders details, can be used in combination with --subgraph, Will override the 'ORDERS' in env variables")
        .option("-s, --subgraph <url...>", "Subgraph URL(s) to read orders details from, can be used in combination with --orders, Will override the 'SUBGRAPH' in env variables")
        .option("--orderbook-address <address>", "Address of the deployed orderbook contract, Will override the 'ORDERBOOK_ADDRESS' in env variables")
        .option("--arb-address <address>", "Address of the deployed arb contract, Will override the 'ARB_ADDRESS' in env variables")
        .option("--arb-contract-type <string>", "Type of the Arb contract, can be either of `flash-loan-v2` or `flash-loan-v3` or `order-taker`, not availabe for `srouter` mode since it is a specialized mode, Will override the 'ARB_TYPE' in env variables")
        .option("-l, --lps <string>", "List of liquidity providers (dex) to use by the router as one quoted string seperated by a comma for each, example: 'SushiSwapV2,UniswapV3', Will override the 'LIQUIDITY_PROVIDERS' in env variables, if unset will use all available liquidty providers")
        .option("-a, --api-key <key>", "0x API key, can be set in env variables, Will override the 'API_KEY' env variable")
        .option("-g, --gas-coverage <integer>", "The percentage of gas to cover to be considered profitable for the transaction to be submitted, an integer greater than equal 0, default is 100 meaning full coverage, Will override the 'GAS_COVER' in env variables")
        .option("--repetitions <integer>", "Option to run `number` of times, if unset will run for infinte number of times")
        .option("--order-hash <hash>", "Option to filter the subgraph query results with a specific order hash, Will override the 'ORDER_HASH' in env variables")
        .option("--order-owner <address>", "Option to filter the subgraph query results with a specific order owner address, Will override the 'ORDER_OWNER' in env variables")
        .option("--order-interpreter <address>", "Option to filter the subgraph query results with a specific order's interpreter address, Will override the 'ORDER_INTERPRETER' in env variables")
        .option("--monthly-ratelimit <integer>", "0x monthly rate limit, if not specified will not respect any 0x monthly ratelimit, Will override the 'MONTHLY_RATELIMIT' in env variables")
        .option("--sleep <integer>", "Seconds to wait between each arb round, default is 10, Will override the 'SLEPP' in env variables")
        .option("--flashbot-rpc <url>", "Optional flashbot rpc url to submit transaction to, Will override the 'FLASHBOT_RPC' in env variables")
        .option("--timeout <integer>", "Optional seconds to wait for the transaction to mine before disregarding it, Will override the 'TIMEOUT' in env variables")
        .option("--max-profit", "Option to maximize profit for 'srouter' mode, comes at the cost of more RPC calls, Will override the 'MAX_PROFIT' in env variables")
        .option("--max-ratio", "Option to maximize maxIORatio for 'srouter' mode, Will override the 'MAX_RATIO' in env variables")
        .option("--use-public-rpcs", "Option to use public rpcs as fallback option for 'srouter' and 'router' mode, Will override the 'USE_PUBLIC_RPCS' in env variables")
        .description([
            "A NodeJS app to find and take arbitrage trades for Rain Orderbook orders against some DeFi liquidity providers, requires NodeJS v18 or higher.",
            "- Use \"node arb-bot [options]\" command alias for running the app from its repository workspace",
            "- Use \"arb-bot [options]\" command alias when this app is installed as a dependency in another project"
        ].join("\n"))
        .alias("arb-bot")
        .version(version)
        .parse(argv)
        .opts();

    cmdOptions.key              = cmdOptions.key                || DEFAULT_OPTIONS.key;
    cmdOptions.rpc              = cmdOptions.rpc                || DEFAULT_OPTIONS.rpc;
    cmdOptions.mode             = cmdOptions.mode               || DEFAULT_OPTIONS.mode;
    cmdOptions.arbAddress       = cmdOptions.arbAddress         || DEFAULT_OPTIONS.arbAddress;
    cmdOptions.arbType          = cmdOptions.arbType            || DEFAULT_OPTIONS.arbType;
    cmdOptions.orderbookAddress = cmdOptions.orderbookAddress   || DEFAULT_OPTIONS.orderbookAddress;
    cmdOptions.orders           = cmdOptions.orders             || DEFAULT_OPTIONS.orders;
    cmdOptions.subgraph         = cmdOptions.subgraph           || DEFAULT_OPTIONS.subgraph;
    cmdOptions.apiKey           = cmdOptions.apiKey             || DEFAULT_OPTIONS.apiKey;
    cmdOptions.lps              = cmdOptions.lps                || DEFAULT_OPTIONS.lps;
    cmdOptions.gasCoverage      = cmdOptions.gasCoverage        || DEFAULT_OPTIONS.gasCoverage;
    cmdOptions.repetitions      = cmdOptions.repetitions        || DEFAULT_OPTIONS.repetitions;
    cmdOptions.orderHash        = cmdOptions.orderHash          || DEFAULT_OPTIONS.orderHash;
    cmdOptions.orderOwner       = cmdOptions.orderOwner         || DEFAULT_OPTIONS.orderOwner;
    cmdOptions.sleep            = cmdOptions.sleep              || DEFAULT_OPTIONS.sleep;
    cmdOptions.orderInterpreter = cmdOptions.orderInterpreter   || DEFAULT_OPTIONS.orderInterpreter;
    cmdOptions.monthlyRatelimit = cmdOptions.monthlyRatelimit   || DEFAULT_OPTIONS.monthlyRatelimit;
    cmdOptions.maxProfit        = cmdOptions.maxProfit          || DEFAULT_OPTIONS.maxProfit;
    cmdOptions.maxRatio         = cmdOptions.maxRatio           || DEFAULT_OPTIONS.maxRatio;
    cmdOptions.usePublicRpcs    = cmdOptions.usePublicRpcs      || DEFAULT_OPTIONS.usePublicRpcs;
    cmdOptions.flashbotRpc      = cmdOptions.flashbotRpc        || DEFAULT_OPTIONS.flashbotRpc;
    cmdOptions.timeout          = cmdOptions.timeout            || DEFAULT_OPTIONS.timeout;


    return cmdOptions;
};

const arbRound = async options => {

    if (!options.key)               throw "undefined wallet private key";
    if (!options.rpc)               throw "undefined RPC URL";
    if (!options.arbAddress)        throw "undefined arb contract address";
    if (!options.orderbookAddress)  throw "undefined orderbook contract address";
    if (!options.mode)              throw "undefined operating mode";

    const config = await getConfig(
        options.rpc,
        options.key,
        options.orderbookAddress,
        options.arbAddress,
        options.arbType,
        {
            zeroExApiKey        : options.apiKey,
            monthlyRatelimit    : options.monthlyRatelimit,
            maxProfit           : options.maxProfit,
            maxRatio            : options.maxRatio,
            usePublicRpcs       : options.usePublicRpcs,
            flashbotRpc         : options.flashbotRpc,
            hideSensitiveData   : false,
            shortenLargeLogs    : false,
            timeout             : options.timeout,
            liquidityProviders  : options.lps
                ? Array.from(options.lps.matchAll(/[^,\s]+/g)).map(v => v[0])
                : undefined,
        }
    );
    const ordersDetails = await getOrderDetails(
        options.subgraph,
        options.orders,
        config.signer,
        {
            orderHash       : options.orderHash,
            orderOwner      : options.orderOwner,
            orderInterpreter: options.orderInterpreter
        }
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
    if (!options.rpc) throw "undefined RPC URL";
    const rpcs = [...options.rpc];
    let roundGap = 10000;
    let rpcTurn = 0;

    if (options.repetitions) {
        if (/^\d+$/.test(options.repetitions)) repetitions = Number(options.repetitions);
        else throw "invalid repetitions, must be an integer greater than equal 0";
    }
    if (options.sleep) {
        if (/^\d+$/.test(options.sleep)) roundGap = Number(options.sleep) * 1000;
        else throw "invalid sleep value, must be an integer greater than equal 0";
    }

    appGlobalLogger(
        true,
        ...rpcs,
        options.key,
        options.apiKey
    );

    // eslint-disable-next-line no-constant-condition
    if (repetitions === -1) while (true) {
        options.rpc = rpcs[rpcTurn];
        try {
            await arbRound(options);
            console.log("\x1b[32m%s\x1b[0m", "Round finished successfully!");
            console.log(`Starting next round in ${roundGap / 1000} seconds...`, "\n");
        }
        catch (error) {
            console.log("\x1b[31m%s\x1b[0m", "An error occured during the round: ");
            console.log(error);
        }
        if (rpcTurn === rpcs.length - 1) rpcTurn = 0;
        else rpcTurn++;
        await sleep(roundGap);
    }
    else for (let i = 1; i <= repetitions; i++) {
        options.rpc = rpcs[rpcTurn];
        try {
            await arbRound(options);
            console.log("\x1b[32m%s\x1b[0m", `Round ${i} finished successfully!`);
            if (i !== repetitions) console.log(
                `Starting round ${i + 1} in ${roundGap / 1000} seconds...`, "\n"
            );
        }
        catch (error) {
            console.log("\x1b[31m%s\x1b[0m", `An error occured during round ${i}:`);
            console.log(error);
        }
        if (rpcTurn === rpcs.length - 1) rpcTurn = 0;
        else rpcTurn++;
        await sleep(roundGap);
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