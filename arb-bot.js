#!/usr/bin/env node

require("dotenv").config();
const ethers = require("ethers");
const CONFIG = require("./config.json");
const { sleep } = require("./src/utils");
const { Command } = require("commander");
const { clear, query } = require("./src");
const { version } = require("./package.json");


const RateLimit = 0.075;    // rate limit per second per month
const DEFAULT_OPTIONS = {
    key: process?.env?.BOT_WALLET_PRIVATEKEY,
    rpc: process?.env?.RPC_URL,
    apiKey: process?.env?.API_KEY,
    slippage: "0.001",    // 0.1%
    subgraphUrl: "https://api.thegraph.com/subgraphs/name/siddharth2207/sidarbbot",
    orderHash: process?.env?.ORDER_HASH
};

const getOptions = async argv => {
    const commandOptions = new Command("node arb-bot")
        .option("-k, --key <private-key>", "Private key of wallet that performs the transactions. Will override the 'BOT_WALLET_PRIVATEKEY' in '.env' file")
        .option("-r, --rpc <url>", "RPC URL that will be provider for interacting with evm. Will override the 'RPC_URL' in '.env' file")
        .option("-s, --slippage <number>", "Sets the slippage percentage for the clearing orders, default is 0.001 which is 0.1%")
        .option("-a, --api-key <key>", "0x API key, can be set in env variables, Will override the API_KEY env variable if a value passed in CLI")
        .option("--subgraph-url <url>", "The subgraph endpoint url used to fetch order details from")
        .option("--orderbook-address <address>", "Address of the deployed orderbook contract. Will override 'orderbookAddress' field in './config.json' file")
        .option("--arb-address <address>", "Address of the deployed arb contract. Will override 'arbAddress' field in './config.json' file")
        .option("--interpreter-abi <path>", "Path to the IInterpreter contract ABI, should be absolute path, default is the ABI in the './src/abis' folder")
        .option("--arb-abi <path>", "Path to the Arb (ZeroExOrderBookFlashBorrower) contract ABI, should be absolute path, default is the ABI in the './src/abis' folder")
        .option("--orderbook-abi <path>", "Path to the Orderbook contract ABI, should be absolute path, default is the ABI in the './src/abis' folder")
        .option("--no-monthly-ratelimit", "Pass to make the app respect 200k 0x API calls per month rate limit, mainly used when not running this app on a bash loop")
        .option("--order-hash <hash>", "Pass to lock the bot onto a particular order")
        .version(version)
        .parse(argv)
        .opts();

    commandOptions.key = commandOptions.key || DEFAULT_OPTIONS.key;
    commandOptions.rpc = commandOptions.rpc || DEFAULT_OPTIONS.rpc;
    commandOptions.apiKey = commandOptions.apiKey || DEFAULT_OPTIONS.apiKey;
    commandOptions.slippage = commandOptions.slippage || DEFAULT_OPTIONS.slippage;
    commandOptions.subgraphUrl = commandOptions.subgraphUrl || DEFAULT_OPTIONS.subgraphUrl;
    commandOptions.orderHash = commandOptions.orderHash || DEFAULT_OPTIONS.orderHash;
    

    return commandOptions;
};

const main = async argv => {
    const start = Date.now();
    const AddressPattern = /^0x[a-fA-F0-9]{40}$/;
    const options = await getOptions(argv);

    if (!options.key) throw "undefined wallet private key";
    if (!/^(0x)?[a-fA-F0-9]{64}$/.test(options.key)) throw "invalid wallet private key";
    if (!options.rpc) throw "undefined RPC URL";
    if (!/^\d+(\.\d+)?$/.test(options.slippage)) throw "invalid slippage value";
    if (!options.subgraphUrl.startsWith("https://api.thegraph.com/subgraphs/name/")) throw "invalid subgraph endpoint URL";

    const provider = new ethers.providers.JsonRpcProvider(options.rpc);
    const signer = new ethers.Wallet(options.key, provider);
    const chainId = await signer.getChainId();
    const config = CONFIG.find(v => v.chainId === chainId);

    if (!config) throw `Cannot find configuration for the network with chain id: ${chainId}`;
    else {
        if (options.orderbookAddress && AddressPattern.test(options.orderbookAddress)) {
            config.orderbookAddress = options.orderbookAddress;
        }
        if (options.arbAddress && AddressPattern.test(options.arbAddress)) {
            config.arbAddress = options.arbAddress;
        }
    }

    if (!config.orderbookAddress) throw "undfined orderbook contract address";
    if (!AddressPattern.test(config.orderbookAddress)) throw "invalid orderbook contract address";

    if (!config.arbAddress) throw "undefined arb contract address";
    if (!AddressPattern.test(config.arbAddress)) throw "invalid arb contract address";

    if (options.interpreterAbi) config.interpreterAbi = options.interpreterAbi;
    if (options.arbAbi) config.arbAbi = options.arbAbi;
    if (options.orderbookAbi) config.orderbookAbi = options.orderbookAbi;
    if (options.apiKey) config.apiKey = options.apiKey;
    if (options.orderHash) config.orderHash = options.orderHash;



    const reports = await clear(
        signer,
        config,
        await query(options.subgraphUrl,config.orderHash),
        options.slippage
    );

    // wait to stay within montly ratelimit
    if (options.monthlyRatelimit) {
        const rateLimitDuration = Number((((reports.hits / RateLimit) * 1000) + 1).toFixed());
        const duration = Date.now() - start;
        console.log(`Executed in ${duration} miliseconds with ${reports.hits} 0x api calls`);
        const msToWait = rateLimitDuration - duration;
        if (msToWait > 0) {
            console.log(`Waiting ${msToWait} more miliseconds to stay within monthly rate limit...`);
            await sleep(msToWait);
        }
    }
};

main(
    process.argv
).then(
    () => console.log("Rain orderbook arbitrage clearing process finished successfully!")
).catch(
    v => console.log(v)
);