const fs = require("fs");
const path = require("path");
const axios = require("axios");
const ethers = require("ethers");
const { bundleTakeOrders } = require(".");
let { abi: orderbookAbi } = require("./abis/OrderBook.json");
const { abi: erc20Abi } = require("./abis/ERC20Upgradeable.json");
let { abi: interpreterAbi } = require("./abis/IInterpreterV1.json");
let { abi: arbAbi } = require("./abis/ZeroExOrderBookFlashBorrower.json");
const {
    // interpreterEval,
    // getOrderStruct,
    ETHERSCAN_TX_PAGE,
    sleep,
    HEADERS
} = require("./utils");


/**
 * Main function that gets order details from subgraph, bundles the ones that have balance and tries clearing them with curve
 *
 * @param {ethers.Signer} signer - The ethersjs signer constructed from provided private keys and rpc url provider
 * @param {object} config - The configuration object
 * @param {any[]} ordersDetails - The order details queried from subgraph
 * @param {string} slippage - (optional) The slippage for clearing orders, default is 0.01 i.e. 1 percent
 * @param {boolean} prioritization - (optional) Prioritize better deals to get cleared first, default is true
 * @returns The report of details of cleared orders
 */
exports.curveClear = async(signer, config, ordersDetails, slippage = "0.01", prioritization = true) => {
    let hits = 0;
    const api = config.apiUrl;
    const chainId = config.chainId;
    const arbAddress = config.arbAddress;
    const orderbookAddress = config.orderbookAddress;
    const nativeToken = config.nativeToken.address;
    const intAbiPath = config.interpreterAbi;
    const arbAbiPath = config.arbAbi;
    const orderbookAbiPath = config.orderbookAbi;

    // set the api key in headers
    if (config.apiKey) HEADERS.headers["0x-api-key"] = config.apiKey;

    // get the abis if path is provided for them
    if (intAbiPath) interpreterAbi = (JSON.parse(
        fs.readFileSync(path.resolve(__dirname, intAbiPath)).toString())
    )?.abi;
    if (arbAbiPath) arbAbi = JSON.parse(
        fs.readFileSync(path.resolve(__dirname, arbAbiPath)).toString()
    )?.abi;
    if (orderbookAbiPath) orderbookAbi = JSON.parse(
        fs.readFileSync(path.resolve(__dirname, orderbookAbiPath)).toString()
    )?.abi;

    // instantiating arb contract
    const arb = new ethers.Contract(arbAddress, arbAbi, signer);

    // instantiating orderbook contract
    const orderbook = new ethers.Contract(orderbookAddress, orderbookAbi, signer);

    console.log(
        "------------------------- Starting Clearing Process -------------------------",
        "\n"
    );
    console.log(Date());
    console.log("Arb Contract Address: " , arbAddress);
    console.log("OrderBook Contract Address: " , orderbookAddress, "\n");

    console.log(
        "------------------------- Fetching Order Details From Subgraph -------------------------",
        "\n"
    );

    let bundledOrders = [];
    if (ordersDetails.length) {
        console.log(
            "------------------------- Bundling Orders -------------------------", "\n"
        );
        bundledOrders = await bundleTakeOrders(ordersDetails, orderbook, interpreterAbi);
    }
    else {
        console.log("No orders found, exiting...", "\n");
        return;
    }

    if (!bundledOrders.length) {
        console.log("Could not find any order with sufficient balance, exiting...", "\n");
        return;
    }

    console.log(
        "------------------------- Getting Best Deals From Curve.fi -------------------------",
        "\n"
    );
};