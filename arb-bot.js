#!/usr/bin/env node

require("dotenv").config();
const ethers = require("ethers");
const CONFIG = require("./config.json");
const { Command } = require("commander");
const { query, clear } = require("./src");
const { version } = require("./package.json");


/**
 * Default CLI arguments
 */
const DEFAULT_OPTIONS = {
    key: process?.env?.BOT_WALLET_PRIVATEKEY,
    rpc: process?.env?.RPC_URL,
    apiKey: process?.env?.API_KEY,
    mode: "router",
    slippage: "0.001",    // 0.1%
    gasCoverage: "100",
    subgraphUrl: "https://api.thegraph.com/subgraphs/name/siddharth2207/slsohysubgraph"
};

const getOptions = async argv => {
    const commandOptions = new Command("node arb-bot")
        .option("-k, --key <private-key>", "Private key of wallet that performs the transactions. Will override the 'BOT_WALLET_PRIVATEKEY' in '.env' file")
        .option("-r, --rpc <url>", "RPC URL that will be provider for interacting with evm. Will override the 'RPC_URL' in '.env' file")
        .option("-m, --mode <string>", "Running mode of the bot, must be one of: `0x` or `curve` or `router`, default is `router`")
        .option("-l, --lps <string>", "List of liquidity providers (dex) to use by the router as one quoted string seperated by a comma for each, example: 'SushiSwapV2,UniswapV3'")
        .option("-s, --slippage <number>", "Sets the slippage percentage for the clearing orders, default is 0.001 which is 0.1%")
        .option("-a, --api-key <key>", "0x API key, can be set in env variables, Will override the API_KEY env variable")
        .option("-g, --gas-coverage <number>", "The percentage of gas to cover to be considered profitable for the transaction to be submitted, between 0 - 100, default is 100 meaning full coverage")
        .option("--orderbook-address <address>", "Address of the deployed orderbook contract.")
        .option("--arb-address <address>", "Address of the deployed arb contract.")
        .option("--subgraph-url <url>", "The subgraph endpoint url used to fetch order details from")
        // .option("--interpreter-abi <path>", "Path to the IInterpreter contract ABI, should be absolute path, default is the ABI in the './src/abis' folder")
        // .option("--arb-abi <path>", "Path to the Arb (ZeroExOrderBookFlashBorrower) contract ABI, should be absolute path, default is the ABI in the './src/abis' folder")
        // .option("--orderbook-abi <path>", "Path to the Orderbook contract ABI, should be absolute path, default is the ABI in the './src/abis' folder")
        .option("--no-monthly-ratelimit", "Option to make the app respect 200k 0x API calls per month rate limit, mainly used when not running this app on a bash loop")
        .version(version)
        .parse(argv)
        .opts();

    commandOptions.key = commandOptions.key || DEFAULT_OPTIONS.key;
    commandOptions.rpc = commandOptions.rpc || DEFAULT_OPTIONS.rpc;
    commandOptions.mode = commandOptions.mode || DEFAULT_OPTIONS.mode;
    commandOptions.apiKey = commandOptions.apiKey || DEFAULT_OPTIONS.apiKey;
    commandOptions.slippage = commandOptions.slippage || DEFAULT_OPTIONS.slippage;
    commandOptions.gasCoverage = commandOptions.gasCoverage || DEFAULT_OPTIONS.gasCoverage;
    commandOptions.subgraphUrl = commandOptions.subgraphUrl || DEFAULT_OPTIONS.subgraphUrl;

    return commandOptions;
};

const main = async argv => {
    const AddressPattern = /^0x[a-fA-F0-9]{40}$/;
    const options = await getOptions(argv);

    if (!options.mode.match(/^0x$|^curve$|^router$/)) throw "invalid mode, must be one of '0x', 'curve', 'router'";
    if (!options.key) throw "undefined wallet private key";
    if (!/^(0x)?[a-fA-F0-9]{64}$/.test(options.key)) throw "invalid wallet private key";
    if (!options.rpc) throw "undefined RPC URL";
    if (!/^\d+(\.\d+)?$/.test(options.slippage)) throw "invalid slippage value";
    if (!options.subgraphUrl.startsWith("https://api.thegraph.com/subgraphs/name/")) throw "invalid subgraph endpoint URL";
    if (
        options.gasCoverage < 0 ||
        options.gasCoverage > 100 ||
        !Number.isInteger(Number(options.gasCoverage))
    ) throw "invalid gas coverage percentage, must be an integer between 0 - 100";

    const provider = new ethers.providers.JsonRpcProvider(options.rpc);
    const signer = new ethers.Wallet(options.key, provider);
    const chainId = await signer.getChainId();
    const config = CONFIG.find(v => v.chainId === chainId);

    if (!config) throw `Cannot find configuration for the network with chain id: ${chainId}`;
    else {
        if (options.orderbookAddress && AddressPattern.test(options.orderbookAddress)) {
            config.orderbookAddress = options.orderbookAddress;
        }
        else throw "invalid orderbook contract address";
        if (options.arbAddress && AddressPattern.test(options.arbAddress)) {
            config.arbAddress = options.arbAddress;
        }
        else throw "invalid arb contract address";
    }
    config.rpc = options.rpc;
    config.apiKey = options.apiKey;
    config.monthlyRatelimit = options.monthlyRatelimit;
    if (options.lps) config.lsp = Array.from(options.lps.matchAll(/[^,\s]+/g)).map(v => v[0]);

    const queryResults = await query(options.subgraphUrl);
    await clear(
        options.mode,
        signer,
        config,
        queryResults,
        options.slippage,
        options.gasCoverage
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