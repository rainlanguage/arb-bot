const { parseAbi } = require("viem");
const { Token } = require("sushi/currency");
const { getDataFetcher } = require("./config");
const { ethers, BigNumber } = require("ethers");
const BlackList = require("./pool-blacklist.json");
const { erc20Abi, orderbookAbi, OrderV3 } = require("./abis");
const { Router, LiquidityProviders } = require("sushi/router");
const { doQuoteTargets } = require("@rainlanguage/orderbook/quote");

/**
 * @import { BundledOrders, TakeOrderDetails, BotError, RawTx, BotConfig, OwnedOrder } from "./types"
 */

function RPoolFilter(pool) {
    return !BlackList.includes(pool.address) && !BlackList.includes(pool.address.toLowerCase());
}

const PoolBlackList = {
    has: (pool) => BlackList.includes(pool) || BlackList.includes(pool.toLowerCase())
};

/**
 * Waits for provided miliseconds
 * @param {number} ms - Miliseconds to wait
 */
const sleep = async(ms, msg = "") => {
    let _timeoutReference;
    return new Promise(
        resolve => _timeoutReference = setTimeout(() => resolve(msg), ms),
    ).finally(
        () => clearTimeout(_timeoutReference)
    );
};

/**
 * Extracts the income (received token value) from transaction receipt
 * @param {string} signerAddress - The signer address
 * @param {any} receipt - The transaction receipt
 * @param {string} token - The token address that was transfered
 * @returns The income value or undefined if cannot find any valid value
 */
const getIncome = (signerAddress, receipt, token) => {
    let result;
    const erc20Interface = new ethers.utils.Interface(erc20Abi);
    try {
        if (receipt.events) result = receipt.events.filter(
            v =>
                (v.address && token ? ethers.BigNumber.from(v.address).eq(token) : true)
                && v.topics[2]
                && ethers.BigNumber.from(v.topics[2]).eq(signerAddress)
        ).map(v => {
            try{
                return erc20Interface.decodeEventLog("Transfer", v.data, v.topics);
            }
            catch {
                return undefined;
            }
        })?.[0]?.value;
        if (!result && receipt.logs) result = receipt.logs.filter(
            v =>
                (v.address && token ? ethers.BigNumber.from(v.address).eq(token) : true)
                && v.topics[2]
                && ethers.BigNumber.from(v.topics[2]).eq(signerAddress)
        ).map(v => {
            try{
                return erc20Interface.decodeEventLog("Transfer", v.data, v.topics);
            }
            catch {
                return undefined;
            }
        })?.[0]?.value;
    } catch {
        /**/
    }
    return result;
};

/**
 * Extracts the actual clear amount (received token value) from transaction receipt
 * @param {string} toAddress - The to address
 * @param {any} receipt - The transaction receipt
 * @returns The actual clear amount
 */
const getActualClearAmount = (toAddress, obAddress, receipt) => {
    if (toAddress.toLowerCase() !== obAddress.toLowerCase()) {
        const erc20Interface = new ethers.utils.Interface(erc20Abi);
        try {
            if (receipt.logs) return receipt.logs.map(v => {
                try{
                    return erc20Interface.decodeEventLog("Transfer", v.data, v.topics);
                }
                catch {
                    return undefined;
                }
            }).filter(v =>
                v !== undefined &&
                BigNumber.from(v.to).eq(toAddress) &&
                BigNumber.from(v.from).eq(obAddress)
            )[0]?.value;
            else if (receipt.events) return receipt.events.map(v => {
                try{
                    return erc20Interface.decodeEventLog("Transfer", v.data, v.topics);
                }
                catch {
                    return undefined;
                }
            }).filter(v =>
                v !== undefined &&
                BigNumber.from(v.to).eq(toAddress) &&
                BigNumber.from(v.from).eq(obAddress)
            )[0]?.value;
            else return undefined;
        } catch {
            return undefined;
        }
    } else {
        const obInterface = new ethers.utils.Interface(orderbookAbi);
        try {
            if (receipt.logs) return receipt.logs.map(v => {
                try{
                    return obInterface.decodeEventLog("AfterClear", v.data, v.topics);
                }
                catch {
                    return undefined;
                }
            }).filter(v => v !== undefined)[0]?.clearStateChange?.aliceOutput;
            else if (receipt.events) return receipt.events.map(v => {
                try{
                    return obInterface.decodeEventLog("AfterClear", v.data, v.topics);
                }
                catch {
                    return undefined;
                }
            }).filter(v => v !== undefined)[0]?.clearStateChange?.aliceOutput;
            else return undefined;
        } catch {
            return undefined;
        }
    }
};

/**
 * Calculates the actual clear price from transactioin event
 * @param {any} receipt - The transaction receipt
 * @param {string} orderbook - The Orderbook contract address
 * @param {string} arb - The Arb contract address
 * @param {string} amount - The clear amount
 * @param {number} buyDecimals - The buy token decimals
 * @returns The actual clear price or undefined if necessary info not found in transaction events
 */
const getActualPrice = (receipt, orderbook, arb, amount, buyDecimals) => {
    const erc20Interface = new ethers.utils.Interface(erc20Abi);
    const eventObj = receipt.events
        ? receipt.events.map(v => {
            try{
                return erc20Interface.decodeEventLog("Transfer", v.data, v.topics);
            }
            catch {
                return undefined;
            }
        }).filter(v => v &&
            !ethers.BigNumber.from(v.from).eq(orderbook) &&
            ethers.BigNumber.from(v.to).eq(arb)
        )
        : receipt.logs?.map(v => {
            try{
                return erc20Interface.decodeEventLog("Transfer", v.data, v.topics);
            }
            catch {
                return undefined;
            }
        }).filter(v => v &&
            !ethers.BigNumber.from(v.from).eq(orderbook) &&
            ethers.BigNumber.from(v.to).eq(arb)
        );
    if (eventObj[0] && eventObj[0]?.value) return ethers.utils.formatUnits(
        eventObj[0].value
            .mul("1" + "0".repeat(36 - buyDecimals))
            .div(amount)
    );
    else return undefined;
};

/**
 * Gets token price against ETH
 * @param {any} config - The network config data
 * @param {string} targetTokenAddress - The token address
 * @param {number} targetTokenDecimals - The token decimals
 * @param {BigNumber} gasPrice - The network gas price
 * @param {import("sushi/router").DataFetcher} dataFetcher - (optional) The DataFetcher instance
 * @param {import("sushi/router").DataFetcherOptions} options - (optional) The DataFetcher options
 */
const getEthPrice = async(
    config,
    targetTokenAddress,
    targetTokenDecimals,
    gasPrice,
    dataFetcher = undefined,
    options = undefined,
    fetchPools = true,
) => {
    if(targetTokenAddress.toLowerCase() == config.nativeWrappedToken.address.toLowerCase()){
        return "1";
    }
    const amountIn = BigNumber.from("1" + "0".repeat(targetTokenDecimals));
    const toToken = new Token({
        chainId: config.chain.id,
        decimals: config.nativeWrappedToken.decimals,
        address: config.nativeWrappedToken.address,
        symbol: config.nativeWrappedToken.symbol
    });
    const fromToken = new Token({
        chainId: config.chain.id,
        decimals: targetTokenDecimals,
        address: targetTokenAddress
    });
    if (!dataFetcher) dataFetcher = await getDataFetcher(config);
    if (fetchPools) await dataFetcher.fetchPoolsForToken(
        fromToken,
        toToken,
        PoolBlackList,
        options
    );
    const pcMap = dataFetcher.getCurrentPoolCodeMap(fromToken, toToken);
    const route = Router.findBestRoute(
        pcMap,
        config.chain.id,
        fromToken,
        amountIn.toBigInt(),
        toToken,
        gasPrice.toNumber(),
        undefined,
        RPoolFilter
        // 30e9,
        // providers,
        // poolFilter
    );
    if (route.status == "NoWay") {
        if (!fetchPools) return await getEthPrice(
            config,
            targetTokenAddress,
            targetTokenDecimals,
            gasPrice,
            dataFetcher,
            options,
            true,
        );
        else return undefined;
    }
    else return ethers.utils.formatUnits(route.amountOutBI);
};

/**
 * Resolves an array of case-insensitive names to LiquidityProviders, ignores the ones that are not valid
 * @param {string[]} liquidityProviders - List of liquidity providers
 */
const processLps = (liquidityProviders) => {
    const LP = Object.values(LiquidityProviders);
    if (
        !liquidityProviders ||
        !Array.isArray(liquidityProviders) ||
        !liquidityProviders.length ||
        !liquidityProviders.every(v => typeof v === "string")
    ) {
        // exclude curve since it is currently in audit, unless it is explicitly specified
        return LP.filter(v => v !== LiquidityProviders.CurveSwap);
    }
    const _lps = [];
    for (let i = 0; i < liquidityProviders.length; i++) {
        const index = LP.findIndex(
            v => v.toLowerCase() === liquidityProviders[i].toLowerCase().trim()
        );
        if (index > -1 && !_lps.includes(LP[index])) _lps.push(LP[index]);
    }
    return _lps.length ? _lps : LP.filter(v => v !== LiquidityProviders.CurveSwap);
};

/**
 * Get order details from an array of order bytes in a .json file and return them as form of sg response
 * @param {string} jsonContent - Content of a JSON file containing orders bytes
 */
const getOrderDetailsFromJson = async(jsonContent, signer) => {
    const ordersBytes = JSON.parse(jsonContent);
    const orderDetails = [];
    for (let i = 0; i < ordersBytes.length; i++) {
        const orderHash = ethers.utils.keccak256(ordersBytes[i]);
        const order = ethers.utils.defaultAbiCoder.decode(
            [OrderV3],
            ordersBytes[i]
        )[0];
        const _inputSymbols = [];
        const _outputSymbols = [];
        for (let j = 0; j < order.validInputs.length; j++) {
            const erc20 = new ethers.Contract(order.validInputs[j].token, erc20Abi, signer);
            const symbol = await erc20.symbol();
            _inputSymbols.push(symbol);
        }
        for (let j = 0; j < order.validOutputs.length; j++) {
            const erc20 = new ethers.Contract(order.validOutputs[j].token, erc20Abi, signer);
            const symbol = await erc20.symbol();
            _outputSymbols.push(symbol);
        }
        orderDetails.push({
            id: orderHash.toLowerCase(),
            owner: order.owner.toLowerCase(),
            orderHash: orderHash.toLowerCase(),
            orderBytes: ordersBytes[i],
            active: true,
            nonce: order.nonce.toLowerCase(),
            inputs: order.validInputs.map((v, i) => ({
                vaultId: v.vaultId,
                token: {
                    address: v.token,
                    decimals: v.decimals,
                    symbol: _inputSymbols[i]
                }
            })),
            outputs: order.validOutputs.map((v, i) => ({
                vaultId: v.vaultId,
                token: {
                    address: v.token,
                    decimals: v.decimals,
                    symbol: _outputSymbols[i]
                }
            })),
        });
    }
    return orderDetails;
};

/**
 * Method to shorten data fields of items that are logged and optionally hide sensitive data
 * @param {boolean} scrub - Option to scrub sensitive data
 * @param {...any} data - The optinnal data to hide
 */
const appGlobalLogger = (scrub, ...data) => {
    // const largeDataPattern = /0x[a-fA-F0-9]{128,}/g;
    const consoleMethods = ["log", "warn", "error", "info", "debug"];

    // Stringifies an object
    const objStringify = (obj) => {
        const keys = Object.getOwnPropertyNames(obj);
        for (let i = 0; i < keys.length; i++) {
            if (
                typeof obj[keys[i]] === "bigint"
                || typeof obj[keys[i]] === "number"
                || typeof obj[keys[i]] === "symbol"
            ) obj[keys[i]] = obj[keys[i]].toString();
            else if (typeof obj[keys[i]] === "object" && obj[keys[i]] !== null) {
                obj[keys[i]] = objStringify(obj[keys[i]]);
            }
        }
        return obj;
    };

    // Replaces a search value with replace value in an object's properties string content
    const objStrReplacer = (logObj, searchee, replacer) => {
        const objKeys = Object.getOwnPropertyNames(logObj);
        for (let i = 0; i < objKeys.length; i++) {
            if (typeof logObj[objKeys[i]] === "string" && logObj[objKeys[i]]) {
                if (typeof searchee === "string") {
                    // while (logObj[objKeys[i]].includes(searchee)) {
                    logObj[objKeys[i]] = logObj[objKeys[i]].replaceAll(searchee, replacer);
                    // }
                }
                else logObj[objKeys[i]] = logObj[objKeys[i]].replace(searchee, replacer);
            }
            else if (typeof logObj[objKeys[i]] === "object" && logObj[objKeys[i]] !== null) {
                logObj[objKeys[i]] = objStrReplacer(logObj[objKeys[i]], searchee, replacer);
            }
        }
        return logObj;
    };

    // filtering unscrubable data
    const _data = data.filter(
        v => v !== undefined && v !== null
    ).map(
        v => {
            try {
                let str;
                if (typeof v !== "string") str = v.toString();
                else str = v;
                if (str) return str;
                else return undefined;
            }
            catch { return undefined; }
        }
    ).filter(
        v => v !== undefined
    );

    // intercepting the console with custom function to scrub and shorten loggings
    consoleMethods.forEach(methodName => {
        // eslint-disable-next-line no-console
        const orgConsole = console[methodName];
        // eslint-disable-next-line no-console
        console[methodName] = function (...params) {
            const modifiedParams = [];
            // const shortenedLogs = [];
            for (let i = 0; i < params.length; i++) {
                let logItem = params[i];
                if (
                    typeof logItem === "number" ||
                    typeof logItem === "bigint" ||
                    typeof logItem === "symbol"
                ) logItem = logItem.toString();

                if (typeof logItem === "string") {
                    if (scrub) for (let j = 0; j < _data.length; j++) {
                        // while (logItem.includes(_data[i]))
                        logItem = logItem.replaceAll(
                            _data[j],
                            "**********"
                        );
                    }
                    // logItem = logItem.replace(
                    //     largeDataPattern,
                    //     largeData => {
                    //         if (!shortenedLogs.includes(largeData)) {
                    //             shortenedLogs.push(largeData);
                    //             return largeData;
                    //         }
                    //         else return largeData.slice(0, 67) + "...";
                    //     }
                    // );
                }
                else if (typeof logItem === "object" && logItem !== null) {
                    logItem = objStringify(logItem);
                    if (scrub) for (let j = 0; j < _data.length; j++) {
                        logItem = objStrReplacer(logItem, _data[j], "**********");
                    }
                    // logItem = objStrReplacer(
                    //     logItem,
                    //     largeDataPattern,
                    //     largeData => {
                    //         if (!shortenedLogs.includes(largeData)) {
                    //             shortenedLogs.push(largeData);
                    //             return largeData;
                    //         }
                    //         else return largeData.slice(0, 67) + "...";
                    //     }
                    // );
                }
                modifiedParams.push(logItem);
            }
            orgConsole.apply(console, modifiedParams);
        };
    });
};

/**
 * Method to put a timeout on a promise, throws the exception if promise is not settled within the time
 * @param {Promise} promise - The Promise to put timeout on
 * @param {number} time - The time in milliseconds
 * @param {string | number | bigint | symbol | boolean} exception - The exception value to reject with if the promise is not settled within time
 * @returns A new promise that gets settled with initial promise settlement or rejected with exception value
 * if the time runs out before the main promise settlement
 */
const promiseTimeout = async(promise, time, exception) => {
    let timer;
    return Promise.race([
        promise,
        new Promise(
            (_res, _rej) => timer = setTimeout(_rej, time, exception)
        )
    ]).finally(
        () => clearTimeout(timer)
    );
};

/**
 * Gets the route for tokens
 * @param {number} chainId - The network chain id
 * @param {string[]} rpcs - The rpcs
 * @param {ethers.BigNumber} sellAmount - The sell amount, should be in onchain token value
 * @param {string} fromTokenAddress - The from token address
 * @param {number} fromTokenDecimals - The from token decimals
 * @param {string} toTokenAddress - The to token address
 * @param {number} toTokenDecimals - The to token decimals
 * @param {string} receiverAddress - The address of the receiver
 * @param {string} routeProcessorAddress - The address of the RouteProcessor contract
 * @param {boolean} abiencoded - If the result should be abi encoded or not
 */
const getRouteForTokens = async(
    chainId,
    rpcs,
    sellAmount,
    fromTokenAddress,
    fromTokenDecimals,
    toTokenAddress,
    toTokenDecimals,
    receiverAddress,
    routeProcessorAddress,
    abiEncoded
) => {
    const amountIn = sellAmount.toBigInt();
    const fromToken = new Token({
        chainId: chainId,
        decimals: fromTokenDecimals,
        address: fromTokenAddress
    });
    const toToken = new Token({
        chainId: chainId,
        decimals: toTokenDecimals,
        address: toTokenAddress
    });
    const dataFetcher = await getDataFetcher({ chain: { id: chainId }, rpc: rpcs });
    await dataFetcher.fetchPoolsForToken(fromToken, toToken);
    const pcMap = dataFetcher.getCurrentPoolCodeMap(fromToken, toToken);
    const route = Router.findBestRoute(
        pcMap,
        chainId,
        fromToken,
        amountIn,
        toToken,
        Number(await dataFetcher.web3Client.getGasPrice()),
        // providers,
        // poolFilter
    );
    if (route.status == "NoWay") throw "NoWay";
    else {
        let routeText = "";
        route.legs.forEach((v, i) => {
            if (i === 0) routeText =
                routeText +
                v.tokenTo.symbol +
                "/" +
                v.tokenFrom.symbol +
                "(" +
                v.poolName +
                ")";
            else routeText =
                routeText +
                " + " +
                v.tokenTo.symbol +
                "/" +
                v.tokenFrom.symbol +
                "(" +
                v.poolName +
                ")";
        });
        // eslint-disable-next-line no-console
        console.log("Route portions: ", routeText, "\n");
        const rpParams = Router.routeProcessor4Params(
            pcMap,
            route,
            fromToken,
            toToken,
            receiverAddress,
            routeProcessorAddress,
            // permits
            // "0.005"
        );
        if (abiEncoded) return ethers.utils.defaultAbiCoder.encode(
            ["bytes"],
            [rpParams.routeCode]
        );
        else return rpParams.routeCode;
    }
};

/**
 * Method to visualize the routes, returns array of route strings sorted from highest to lowest percentage
 * @param {string} fromToken - The from token address
 * @param {string} toToken - The to token address
 * @param {any[]} legs - The legs of the route
 */
const visualizeRoute = (fromToken, toToken, legs) => {
    return [
        ...legs.filter(
            v => v.tokenTo.address.toLowerCase() === toToken.address.toLowerCase() &&
            v.tokenFrom.address.toLowerCase() === fromToken.address.toLowerCase()
        ).map(v => [v]),

        ...legs.filter(
            v => v.tokenFrom.address.toLowerCase() === fromToken.address.toLowerCase() &&
            (
                v.tokenTo.address.toLowerCase() !== toToken.address.toLowerCase()
            )
        ).map(v => {
            const portoin = [v];
            while(
                portoin.at(-1).tokenTo.address.toLowerCase() !== toToken.address.toLowerCase()
            ) {
                portoin.push(
                    legs.find(e =>
                        e.tokenFrom.address.toLowerCase() ===
                        portoin.at(-1).tokenTo.address.toLowerCase()
                    )
                );
            }
            return portoin;
        })

    ].sort(
        (a, b) => b[0].absolutePortion - a[0].absolutePortion
    ).map(
        v => (v[0].absolutePortion * 100).toFixed(2).padStart(5, "0") + "%   --->   " +
        v.map(
            e => (e.tokenTo.symbol ?? (e.tokenTo.address.toLowerCase() === toToken.address.toLowerCase() ? toToken.symbol : "unknownSymbol"))
                + "/"
                + (e.tokenFrom.symbol ?? (e.tokenFrom.address.toLowerCase() === fromToken.address.toLowerCase() ? fromToken.symbol : "unknownSymbol"))
                + " ("
                + e.poolName
                + " "
                + e.poolAddress
                + ")"
        ).join(
            " >> "
        )
    );
};

/**
 * Shuffles an array
 * @param {*} array - The array
 */
const shuffleArray = (array) => {
    let currentIndex = array.length;
    let randomIndex = 0;

    // While there remain elements to shuffle.
    while (currentIndex > 0) {

        // Pick a remaining element.
        randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex--;

        // And swap it with the current element.
        [
            array[currentIndex],
            array[randomIndex]
        ] = [
            array[randomIndex],
            array[currentIndex]
        ];
    }

    return array;
};

/**
 * Prepares an etherjs error for otel span consumption
 * @param {*} error - The ethersjs error
 */
function getSpanException(error) {
    if (error instanceof Error && Object.keys(error).length && error.message.includes("providers/5.7.0")) {
        const parsedError = JSON.parse(JSON.stringify(error));
        error.message = JSON.stringify(parsedError);

        // remove stack since it is already present in message
        error.stack = undefined;
        return error;
    }
    return error;
}

/**
 * Builds and bundles orders which their details are queried from a orderbook subgraph
 * @param {any[]} ordersDetails - Orders details queried from subgraph
 * @param {boolean} _shuffle - To shuffle the bundled order array at the end
 * @param {boolean} _bundle = If orders should be bundled based on token pair
 * @returns {BundledOrders[][]} Array of bundled take orders
 */
const bundleOrders = (
    ordersDetails,
    _shuffle = true,
    _bundle = true,
) => {
    /** @type {{[key: string]: BundledOrders[]}} */
    const bundledOrders = {};
    for (let i = 0; i < ordersDetails.length; i++) {
        const orderDetails = ordersDetails[i];
        const orderbook = orderDetails.orderbook.id;
        const orderStruct = ethers.utils.defaultAbiCoder.decode(
            [OrderV3],
            orderDetails.orderBytes
        )[0];

        for (let j = 0; j < orderStruct.validOutputs.length; j++) {
            const _output = orderStruct.validOutputs[j];
            const _outputSymbol = orderDetails.outputs.find(
                v => v.token.address.toLowerCase() === _output.token.toLowerCase()
            ).token.symbol;

            for (let k = 0; k < orderStruct.validInputs.length; k ++) {
                const _input = orderStruct.validInputs[k];
                const _inputSymbol = orderDetails.inputs.find(
                    v => v.token.address.toLowerCase() === _input.token.toLowerCase()
                ).token.symbol;

                if (_output.token.toLowerCase() !== _input.token.toLowerCase()) {
                    if (!bundledOrders[orderbook]) {
                        bundledOrders[orderbook] = [];
                    }
                    const pair = bundledOrders[orderbook].find(v =>
                        v.sellToken === _output.token.toLowerCase() &&
                        v.buyToken === _input.token.toLowerCase()
                    );
                    if (pair && _bundle) pair.takeOrders.push({
                        id: orderDetails.orderHash,
                        takeOrder: {
                            order: orderStruct,
                            inputIOIndex: k,
                            outputIOIndex: j,
                            signedContext: []
                        }
                    });
                    else bundledOrders[orderbook].push({
                        orderbook,
                        buyToken: _input.token.toLowerCase(),
                        buyTokenSymbol: _inputSymbol,
                        buyTokenDecimals: _input.decimals,
                        sellToken: _output.token.toLowerCase(),
                        sellTokenSymbol: _outputSymbol,
                        sellTokenDecimals: _output.decimals,
                        takeOrders: [{
                            id: orderDetails.orderHash,
                            takeOrder: {
                                order: orderStruct,
                                inputIOIndex: k,
                                outputIOIndex: j,
                                signedContext: []
                            }
                        }]
                    });

                }
            }
        }
    }
    if (_shuffle) {
        // shuffle bundled orders pairs
        if (_bundle) {
            for (const ob in bundledOrders) {
                shuffleArray(bundledOrders[ob]);
            }
        }

        // shuffle orderbooks
        const result = Object.values(bundledOrders);
        shuffleArray(result);

        return result;
    }
    return Object.values(bundledOrders);
};

/**
 * Gets vault balance of an order or combined value of vaults if bundled
 * @param {BundledOrders} orderDetails
 * @param {string} orderbookAddress
 * @param {import("viem").PublicClient} viemClient
 * @param {string=} multicallAddressOverride
 */
async function getVaultBalance(
    orderDetails,
    orderbookAddress,
    viemClient,
    multicallAddressOverride
) {
    const multicallResult = await viemClient.multicall({
        multicallAddress:
            viemClient.chain?.contracts?.multicall3?.address ?? multicallAddressOverride,
        allowFailure: false,
        contracts: orderDetails.takeOrders.map(v => ({
            address: orderbookAddress,
            allowFailure: false,
            chainId: viemClient.chain.id,
            abi: parseAbi(orderbookAbi),
            functionName: "vaultBalance",
            args: [
                // owner
                v.takeOrder.order.owner,
                // token
                v.takeOrder.order.validOutputs[v.takeOrder.outputIOIndex].token,
                // valut id
                v.takeOrder.order.validOutputs[v.takeOrder.outputIOIndex].vaultId,
            ]
        })),
    });

    let result = ethers.BigNumber.from(0);
    for (let i = 0; i < multicallResult.length; i++) {
        result = result.add(multicallResult[i]);
    }
    return result;
}

/**
 * Quotes order details that are already fetched and bundled by bundleOrder()
 * @param {BundledOrders[][]} orderDetails - Order details to quote
 * @param {string[]} rpcs - RPC urls
 * @param {bigint} blockNumber - Optional block number
 * @param {string=} multicallAddressOverride - Optional multicall address
 */
async function quoteOrders(
    orderDetails,
    rpcs,
    blockNumber,
    multicallAddressOverride,
) {
    let quoteResults;
    const targets = orderDetails.flatMap(
        v => v.flatMap(list => list.takeOrders.map(orderConfig => ({
            orderbook: list.orderbook,
            quoteConfig: getQuoteConfig(orderConfig)
        })))
    );
    for (let i = 0; i < rpcs.length; i++) {
        const rpc = rpcs[i];
        try {
            quoteResults = await doQuoteTargets(
                targets,
                rpc,
                blockNumber,
                multicallAddressOverride
            );
            break;
        } catch(e) {
            // throw only after every available rpc has been tried and failed
            if (i === rpcs.length - 1) throw e;
        }
    }

    // map results to the original obj
    for (const orderbookOrders of orderDetails) {
        for (const pair of orderbookOrders) {
            for (const order of pair.takeOrders) {
                const quoteResult = quoteResults.shift();
                if (quoteResult) {
                    if (typeof quoteResult !== "string") {
                        order.quote = {
                            maxOutput: ethers.BigNumber.from(quoteResult.maxOutput),
                            ratio: ethers.BigNumber.from(quoteResult.ratio),
                        };
                    }
                }
            }
        }
    }

    // filter out those that failed quote or have 0 maxoutput
    for (let i = 0; i < orderDetails.length; i++) {
        for (const pair of orderDetails[i]) {
            pair.takeOrders = pair.takeOrders.filter(v => v.quote && v.quote.maxOutput.gt(0));
            if (pair.takeOrders.length) {
                pair.takeOrders.sort((a, b) => a.quote.ratio.lt(b.quote.ratio)
                    ? -1
                    : a.quote.ratio.gt(b.quote.ratio)
                        ? 1
                        : 0
                );
            }
        }
        orderDetails[i] = orderDetails[i].filter(v => v.takeOrders.length > 0);
    }

    return orderDetails;
}

/**
 * Quotes a single order
 * @param {BundledOrders} orderDetails - Order details to quote
 * @param {string[]} rpcs - RPC urls
 * @param {bigint} blockNumber - Optional block number
 * @param {string=} multicallAddressOverride - Optional multicall address
 */
async function quoteSingleOrder(
    orderDetails,
    rpcs,
    blockNumber,
    multicallAddressOverride,
) {
    for (let i = 0; i < rpcs.length; i++) {
        const rpc = rpcs[i];
        try {
            const quoteResult = (await doQuoteTargets(
                [{
                    orderbook: orderDetails.orderbook,
                    quoteConfig: getQuoteConfig(orderDetails.takeOrders[0])
                }],
                rpc,
                blockNumber,
                multicallAddressOverride
            ))[0];
            if (typeof quoteResult !== "string") {
                orderDetails.takeOrders[0].quote = {
                    maxOutput: ethers.BigNumber.from(quoteResult.maxOutput),
                    ratio: ethers.BigNumber.from(quoteResult.ratio),
                };
                return;
            } else {
                return Promise.reject(`failed to quote order, reason: ${quoteResult}`);
            }
        } catch(e) {
            // throw only after every available rpc has been tried and failed
            if (i === rpcs.length - 1) throw e?.message;
        }
    }
}

/**
 * @param {any} orderDetails
 * @returns {TakeOrderDetails}
 */
function getQuoteConfig(orderDetails) {
    return {
        order: {
            owner: orderDetails.takeOrder.order.owner,
            nonce: orderDetails.takeOrder.order.nonce,
            evaluable: {
                interpreter: orderDetails.takeOrder.order.evaluable.interpreter,
                store: orderDetails.takeOrder.order.evaluable.store,
                bytecode: ethers.utils.arrayify(
                    orderDetails.takeOrder.order.evaluable.bytecode
                ),
            },
            validInputs: orderDetails.takeOrder.order.validInputs.map(
                input => ({
                    token: input.token,
                    decimals: input.decimals,
                    vaultId: typeof input.vaultId == "string"
                        ? input.vaultId
                        : input.vaultId.toHexString(),
                })
            ),
            validOutputs: orderDetails.takeOrder.order.validOutputs.map(
                output => ({
                    token: output.token,
                    decimals: output.decimals,
                    vaultId: typeof output.vaultId == "string"
                        ? output.vaultId
                        : output.vaultId.toHexString(),
                })
            ),
        },
        inputIOIndex: orderDetails.takeOrder.inputIOIndex,
        outputIOIndex: orderDetails.takeOrder.outputIOIndex,
        signedContext: orderDetails.takeOrder.signedContext,
    };
}

/**
 * Clones the given object
 * @param {any} obj - Object to clone
 * @returns A new copy of the object
 */
function clone(obj) {
    if (obj instanceof ethers.BigNumber) {
        return ethers.BigNumber.from(obj.toString());
    }
    else if (Array.isArray(obj)) {
        return obj.map((item) => clone(item));
    }
    else if (typeof obj === "object") {
        const result = {};
        for (const key in obj) {
            const value = obj[key];
            result[key] = clone(value);
        }
        return result;
    } else {
        return obj;
    }
}

/**
 * Get total income in native chain's token units
 * @param {ethers.BigNumber | undefined} inputTokenIncome
 * @param {ethers.BigNumber | undefined} outputTokenIncome
 * @param {string} inputTokenPrice
 * @param {string} outputTokenPrice
 * @param {number} inputTokenDecimals
 * @param {number} outputTokenDecimals
 */
function getTotalIncome(
    inputTokenIncome,
    outputTokenIncome,
    inputTokenPrice,
    outputTokenPrice,
    inputTokenDecimals,
    outputTokenDecimals
) {
    if (inputTokenIncome && outputTokenIncome) {
        const inputTokenIncomeInEth = ethers.utils.parseUnits(inputTokenPrice)
            .mul(inputTokenIncome)
            .div("1" + "0".repeat(inputTokenDecimals));
        const outputTokenIncomeInEth = ethers.utils.parseUnits(outputTokenPrice)
            .mul(outputTokenIncome)
            .div("1" + "0".repeat(outputTokenDecimals));
        return inputTokenIncomeInEth.add(outputTokenIncomeInEth);
    } else if (inputTokenIncome && !outputTokenIncome) {
        return ethers.utils.parseUnits(inputTokenPrice)
            .mul(inputTokenIncome)
            .div("1" + "0".repeat(inputTokenDecimals));
    } else if (!inputTokenIncome && outputTokenIncome) {
        return ethers.utils.parseUnits(outputTokenPrice)
            .mul(outputTokenIncome)
            .div("1" + "0".repeat(outputTokenDecimals));
    }
    return undefined;
}

/**
 * Estimates profit for a arb/clear2 tx
 * @param {any} orderPairObject
 * @param {ethers.BigNumber} inputToEthPrice
 * @param {ethers.BigNumber} outputToEthPrice
 * @param {any | undefined} opposingOrders
 * @param {ethers.BigNumber | undefined} marketPrice
 * @param {ethers.BigNumber | undefined} maxInput
 */
function estimateProfit(
    orderPairObject,
    inputToEthPrice,
    outputToEthPrice,
    opposingOrders,
    marketPrice,
    maxInput,
) {
    const One = ethers.utils.parseUnits("1");
    if (marketPrice) {
        const marketAmountOut = maxInput.mul(marketPrice).div(One);
        const orderInput = maxInput.mul(orderPairObject.takeOrders[0].quote.ratio).div(One);
        const estimatedProfit = marketAmountOut.sub(orderInput);
        return estimatedProfit.mul(inputToEthPrice).div(One);
    }
    if (opposingOrders) {
        // inter-orderbook
        if ("orderbook" in opposingOrders) {
            const orderOutput = maxInput;
            const orderInput = maxInput.mul(orderPairObject.takeOrders[0].quote.ratio).div(One);

            let opposingMaxInput = orderPairObject.takeOrders[0].quote.ratio.isZero()
                ? ethers.constants.MaxUint256
                : maxInput.mul(orderPairObject.takeOrders[0].quote.ratio).div(One);
            const opposingMaxIORatio = orderPairObject.takeOrders[0].quote.ratio.isZero()
                ? ethers.constants.MaxUint256
                : One.mul(One).div(orderPairObject.takeOrders[0].quote.ratio);

            let opposingInput = ethers.constants.Zero;
            let opposingOutput = ethers.constants.Zero;
            for (let i = 0; i < opposingOrders.takeOrders.length; i++) {
                const order = opposingOrders.takeOrders[i].quote;
                if (opposingMaxInput.lte(0)) break;
                if (opposingMaxIORatio.gte(order.ratio)) {
                    const maxOut = opposingMaxInput.lt(order.maxOutput)
                        ? opposingMaxInput
                        : order.maxOutput;
                    opposingOutput = opposingOutput.add(maxOut);
                    opposingInput = opposingInput.add(maxOut.mul(order.ratio).div(One));
                    opposingMaxInput = opposingMaxInput.sub(maxOut);
                }
            }
            const outputProfit = orderOutput.sub(opposingInput).mul(outputToEthPrice).div(One);
            const inputProfit = opposingOutput.sub(orderInput).mul(inputToEthPrice).div(One);
            return outputProfit.add(inputProfit);
        }
        // intra orderbook
        else {
            const orderMaxInput = orderPairObject.takeOrders[0].quote.maxOutput
                .mul(orderPairObject.takeOrders[0].quote.ratio).div(One);
            const opposingMaxInput = opposingOrders.quote.maxOutput
                .mul(opposingOrders.quote.ratio)
                .div(One);

            const orderOutput = opposingOrders.quote.ratio.isZero()
                ? orderPairObject.takeOrders[0].quote.maxOutput
                : orderPairObject.takeOrders[0].quote.maxOutput.lte(opposingMaxInput)
                    ? orderPairObject.takeOrders[0].quote.maxOutput
                    : opposingMaxInput;
            const orderInput = orderOutput.mul(orderPairObject.takeOrders[0].quote.ratio).div(One);

            const opposingOutput = opposingOrders.quote.ratio.isZero()
                ? opposingOrders.quote.maxOutput
                : orderMaxInput.lte(opposingOrders.quote.maxOutput)
                    ? orderMaxInput
                    : opposingOrders.quote.maxOutput;
            const opposingInput = opposingOutput.mul(opposingOrders.quote.ratio).div(One);

            let outputProfit = orderOutput.sub(opposingInput);
            if (outputProfit.lt(0)) outputProfit = ethers.constants.Zero;
            outputProfit = outputProfit.mul(outputToEthPrice).div(One);

            let inputProfit = opposingOutput.sub(orderInput);
            if (inputProfit.lt(0)) inputProfit = ethers.constants.Zero;
            inputProfit = inputProfit.mul(inputToEthPrice).div(One);

            return outputProfit.add(inputProfit);
        }
    }
}

/**
 * Gets values for an RP swap transaction
 * @param {number} chainId - The network chain id
 * @param {ethers.BigNumber} sellAmount - The sell amount, should be in onchain token value
 * @param {import("sushi/currency").Type} fromToken - The from token address
 * @param {import("sushi/currency").Type} toToken - The to token address
 * @param {string} receiverAddress - The address of the receiver
 * @param {string} routeProcessorAddress - The address of the RouteProcessor contract
 * @param {import("sushi/router").DataFetcher} dataFetcher - The DataFetcher instance
 * @param {ethers.BigNumber} gasPrice - Gas price
 */
const getRpSwap = async(
    chainId,
    sellAmount,
    fromToken,
    toToken,
    receiverAddress,
    routeProcessorAddress,
    dataFetcher,
    gasPrice,
) => {
    const amountIn = sellAmount.toBigInt();
    const pcMap = dataFetcher.getCurrentPoolCodeMap(fromToken, toToken);
    const route = Router.findBestRoute(
        pcMap,
        chainId,
        fromToken,
        amountIn,
        toToken,
        gasPrice.toNumber(),
        undefined,
        RPoolFilter
    );
    if (route.status == "NoWay") {
        throw "NoWay";
    }
    else {
        const rpParams = Router.routeProcessor4Params(
            pcMap,
            route,
            fromToken,
            toToken,
            receiverAddress,
            routeProcessorAddress,
        );
        return { rpParams, route };
    }
};

function getOrdersTokens(ordersDetails) {
    const tokens = [];
    for (let i = 0; i < ordersDetails.length; i++) {
        const orderDetails = ordersDetails[i];
        const orderStruct = ethers.utils.defaultAbiCoder.decode(
            [OrderV3],
            orderDetails.orderBytes
        )[0];

        for (let j = 0; j < orderStruct.validOutputs.length; j++) {
            const _output = orderStruct.validOutputs[j];
            const _outputSymbol = orderDetails.outputs.find(
                v => v.token.address.toLowerCase() === _output.token.toLowerCase()
            ).token.symbol;
            if (!tokens.find(v => v.address === _output.token.toLowerCase())) {
                tokens.push({
                    address: _output.token.toLowerCase(),
                    decimals: _output.decimals,
                    symbol: _outputSymbol
                });
            }
        }
        for (let k = 0; k < orderStruct.validInputs.length; k ++) {
            const _input = orderStruct.validInputs[k];
            const _inputSymbol = orderDetails.inputs.find(
                v => v.token.address.toLowerCase() === _input.token.toLowerCase()
            ).token.symbol;
            if (!tokens.find(v => v.address === _input.token.toLowerCase())) {
                tokens.push({
                    address: _input.token.toLowerCase(),
                    decimals: _input.decimals,
                    symbol: _inputSymbol
                });
            }
        }
    }
    return tokens;
}

async function routeExists(config, fromToken, toToken, gasPrice) {
    try {
        await getRpSwap(
            config.chain.id,
            ethers.BigNumber.from("1" + "0".repeat(fromToken.decimals)),
            fromToken,
            toToken,
            "0x" + "1".repeat(40),
            "0x" + "2".repeat(40),
            config.dataFetcher,
            gasPrice
        );
        return true;
    } catch {
        return false;
    }
}

function withBigintSerializer(_k, v) {
    if (typeof v == "bigint") {
        return v.toString();
    } else {
        return v;
    }
}

/**
 * Quotes order details that are already fetched and bundled by bundleOrder()
 * @param {BotConfig} config - Config obj
 * @param {BundledOrders[][]} orderDetails - Order details to quote
 * @param {string=} multicallAddressOverride - Optional multicall address
 * @returns {Promise<OwnedOrder[]>}
 */
async function checkOwnedOrders(config, orderDetails, multicallAddressOverride) {
    const ownedOrders = [];
    /** @type {OwnedOrder[]} */
    const result = [];
    orderDetails.flat().forEach(v => {
        v.takeOrders.forEach(order => {
            if (order.takeOrder.order.owner.toLowerCase() ===
                config.mainAccount.account.address.toLowerCase() &&
                !ownedOrders.find(e =>
                    e.orderbook === v.orderbook &&
                    e.outputToken === v.sellToken &&
                    e.order.takeOrder.order.validOutputs[e.order.takeOrder.outputIOIndex] ==
                    order.takeOrder.order.validOutputs[order.takeOrder.outputIOIndex]
                )
            ) {
                ownedOrders.push({
                    order,
                    orderbook: v.orderbook,
                    outputSymbol: v.sellTokenSymbol,
                    outputToken: v.sellToken,
                    outputDecimals: v.sellTokenDecimals,
                });
            }
        });
    });
    if (!ownedOrders.length) return result;
    try {
        const multicallResult = await config.viemClient.multicall({
            multicallAddress:
                multicallAddressOverride ?? config.viemClient.chain?.contracts?.multicall3?.address,
            allowFailure: false,
            contracts: ownedOrders.map(v => ({
                address: v.orderbook,
                allowFailure: false,
                chainId: config.chain.id,
                abi: parseAbi(orderbookAbi),
                functionName: "vaultBalance",
                args: [
                    // owner
                    v.order.takeOrder.order.owner,
                    // token
                    v.order.takeOrder.order.validOutputs[v.order.takeOrder.outputIOIndex].token,
                    // valut id
                    v.order.takeOrder.order.validOutputs[v.order.takeOrder.outputIOIndex].vaultId,
                ]
            })),
        });
        for (let i = 0; i < multicallResult.length; i++) {
            result.push({
                id: ownedOrders[i].order.id,
                vaultId: ownedOrders[i].order.takeOrder.order.validOutputs[
                    ownedOrders[i].order.takeOrder.outputIOIndex
                ].vaultId,
                token: ownedOrders[i].outputToken,
                symbol: ownedOrders[i].outputSymbol,
                decimals: ownedOrders[i].outputDecimals,
                orderbook: ownedOrders[i].orderbook,
                vaultBalance: ethers.BigNumber.from(multicallResult[i])
            });
        }
    } catch(e) { /**/ }
    return result;
}

/**
 * @param {ethers.BigNumber} value
 * @returns {number}
 */
function toNumber(value) {
    const valueString = ethers.utils.formatUnits(value);
    return Number.parseFloat(
        valueString.substring(0, valueString.includes(".") ? 18 : 17)
    );
}

function getMarketQuote(config, fromToken, toToken, gasPrice) {
    const amountIn = ethers.utils.parseUnits("1", fromToken.decimals);
    const amountInFixed = ethers.utils.parseUnits("1");
    const pcMap = config.dataFetcher.getCurrentPoolCodeMap(
        fromToken,
        toToken
    );
    const route = Router.findBestRoute(
        pcMap,
        config.chain.id,
        fromToken,
        amountIn.toBigInt(),
        toToken,
        gasPrice.toNumber(),
        undefined,
        RPoolFilter
    );
    if (route.status == "NoWay") {
        return undefined;
    }
    else {
        const rateFixed = ethers.BigNumber.from(route.amountOutBI).mul(
            "1" + "0".repeat(18 - toToken.decimals)
        );
        const price = rateFixed.mul("1" + "0".repeat(18)).div(amountInFixed);
        return {
            price: ethers.utils.formatUnits(price),
            amountOut: ethers.utils.formatUnits(route.amountOutBI, toToken.decimals)
        };
    }
}

module.exports = {
    sleep,
    getIncome,
    getActualPrice,
    getEthPrice,
    processLps,
    getOrderDetailsFromJson,
    appGlobalLogger,
    promiseTimeout,
    getActualClearAmount,
    getRouteForTokens,
    visualizeRoute,
    shuffleArray,
    getSpanException,
    bundleOrders,
    getVaultBalance,
    PoolBlackList,
    RPoolFilter,
    quoteOrders,
    clone,
    getTotalIncome,
    quoteSingleOrder,
    estimateProfit,
    getRpSwap,
    getOrdersTokens,
    routeExists,
    withBigintSerializer,
    checkOwnedOrders,
    toNumber,
    getMarketQuote,
};
