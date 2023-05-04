require("dotenv").config();
const ethers = require("ethers");
const { clear } = require("./src");
const CONFIG = require("./config.json");
const { Command } = require("commander");
const { version } = require("./package.json");


const AddressPattern = /^0x[a-fA-F0-9]{40}$/;
const DEFAULT_OPTIONS = {
    key: process?.env?.BOT_WALLET_PRIVATEKEY,
    rpc: process?.env?.RPC_URL,
};

const getOptions = async argv => {
    const commandOptions = new Command("node run.js")
        .option("-k, --key <string>", "Private key of wallet that performs the transactions. Will override the 'WALLET_KEY' in '.env' file")
        .option("-r, --rpc <url>", "RPC URL that will be provider for interacting with evm. Will override the 'RPC_URL' in '.env' file")
        .option("--orderbook-address <string>", "Address of the deployed orderbook contract. Will override 'orderbookAddress' field in './config.json' file")
        .option("--arb-address <string>", "Address of the deployed arb contract. Will override 'arbAddress' field in './config.json' file")
        .version(version)
        .parse(argv)
        .opts();

    commandOptions.key = commandOptions.key || DEFAULT_OPTIONS.key;
    commandOptions.rpc = commandOptions.rpc || DEFAULT_OPTIONS.rpc;

    return commandOptions;
};

const main = async argv => {
    const options = await getOptions(argv);

    if (!options.key) throw "undefined wallet private key";
    if (!/^[a-fA-F0-9]{64}$/.test(options.key)) throw "invalid wallet private key";
    if (!options.rpc) throw "undefined RPC URL";

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

    await clear(signer, config);
};

main(
    process.argv
).then(
    () => console.log("Rain orderbook arbitrage clearing process finished successfully!")
).catch(
    v => console.log(v)
);