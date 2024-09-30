require("dotenv").config();
const { ethers } = require("ethers");
const { Command } = require("commander");
const { version } = require("./package.json");
const { Resource } = require("@opentelemetry/resources");
const { sleep, getOrdersTokens } = require("./src/utils");
const { getOrderDetails, clear, getConfig } = require("./src");
const { ErrorSeverity, errorSnapshot } = require("./src/error");
const { getMetaInfo, getDataFetcher } = require("./src/config");
const { ProcessPairReportStatus } = require("./src/processOrders");
const { OTLPTraceExporter } = require("@opentelemetry/exporter-trace-otlp-http");
const { SEMRESATTRS_SERVICE_NAME } = require("@opentelemetry/semantic-conventions");
const { manageAccounts, rotateProviders, sweepToMainWallet, sweepToEth } = require("./src/account");
const { diag, trace, context, SpanStatusCode, DiagConsoleLogger, DiagLogLevel } = require("@opentelemetry/api");
const { BasicTracerProvider, BatchSpanProcessor, ConsoleSpanExporter, SimpleSpanProcessor } = require("@opentelemetry/sdk-trace-base");

/**
 * @import { Tracer } from "@opentelemetry/sdk-trace-base"
 * @import { Context } from "@opentelemetry/api"
 * @import { BotConfig, CliOptions } from "./src/types"
 */

/**
 * Options specified in env variables
 */
const ENV_OPTIONS = {
    key                 : process?.env?.BOT_WALLET_PRIVATEKEY,
    mnemonic            : process?.env?.MNEMONIC,
    arbAddress          : process?.env?.ARB_ADDRESS,
    genericArbAddress   : process?.env?.GENERIC_ARB_ADDRESS,
    orderbookAddress    : process?.env?.ORDERBOOK_ADDRESS,
    orders              : process?.env?.ORDERS,
    lps                 : process?.env?.LIQUIDITY_PROVIDERS,
    gasCoverage         : process?.env?.GAS_COVER || "100",
    orderHash           : process?.env?.ORDER_HASH,
    orderOwner          : process?.env?.ORDER_OWNER,
    sleep               : process?.env?.SLEEP,
    maxRatio            : process?.env?.MAX_RATIO?.toLowerCase() === "true" ? true : false,
    bundle              : process?.env?.NO_BUNDLE?.toLowerCase() === "true" ? false : true,
    timeout             : process?.env?.TIMEOUT,
    flashbotRpc         : process?.env?.FLASHBOT_RPC,
    hops                : process?.env?.HOPS,
    retries             : process?.env?.RETRIES,
    poolUpdateInterval  : process?.env?.POOL_UPDATE_INTERVAL || "15",
    walletCount         : process?.env?.WALLET_COUNT,
    topupAmount         : process?.env?.TOPUP_AMOUNT,
    botMinBalance       : process?.env?.BOT_MIN_BALANCE,
    selfFundOrders      : process?.env?.SELF_FUND_ORDERS,
    rpc                 : process?.env?.RPC_URL
        ? Array.from(process?.env?.RPC_URL.matchAll(/[^,\s]+/g)).map(v => v[0])
        : undefined,
    subgraph            : process?.env?.SUBGRAPH
        ? Array.from(process?.env?.SUBGRAPH.matchAll(/[^,\s]+/g)).map(v => v[0])
        : undefined,
};

/**
 * @param {any} argv
 * @returns {Promise<CliOptions>}
 */
const getOptions = async argv => {
    const cmdOptions = new Command("node arb-bot")
        .option("-k, --key <private-key>", "Private key of wallet that performs the transactions, one of this or --mnemonic should be specified. Will override the 'BOT_WALLET_PRIVATEKEY' in env variables")
        .option("-m, --mnemonic <mnemonic-phrase>", "Mnemonic phrase of wallet that performs the transactions, one of this or --key should be specified, requires '--wallet-count' and '--topup-amount'. Will override the 'MNEMONIC' in env variables")
        .option("-r, --rpc <url...>", "RPC URL(s) that will be provider for interacting with evm, use different providers if more than 1 is specified to prevent banning. Will override the 'RPC_URL' in env variables")
        .option("-o, --orders <path>", "The path to a local json file containing an array of the encoded orders bytes as hex string, can be used in combination with --subgraph, Will override the 'ORDERS' in env variables")
        .option("-s, --subgraph <url...>", "Subgraph URL(s) to read orders details from, can be used in combination with --orders, Will override the 'SUBGRAPH' in env variables")
        .option("--orderbook-address <address>", "Option to filter the subgraph query results with address of the deployed orderbook contract, Will override the 'ORDERBOOK_ADDRESS' in env variables")
        .option("--arb-address <address>", "Address of the deployed arb contract, Will override the 'ARB_ADDRESS' in env variables")
        .option("--generic-arb-address <address>", "Address of the deployed generic arb contract to perform inter-orderbook clears, Will override the 'GENERIC_ARB_ADDRESS' in env variables")
        .option("-l, --lps <string>", "List of liquidity providers (dex) to use by the router as one quoted string seperated by a comma for each, example: 'SushiSwapV2,UniswapV3', Will override the 'LIQUIDITY_PROVIDERS' in env variables, if unset will use all available liquidty providers")
        .option("-g, --gas-coverage <integer>", "The percentage of gas to cover to be considered profitable for the transaction to be submitted, an integer greater than equal 0, default is 100 meaning full coverage, Will override the 'GAS_COVER' in env variables")
        .option("--order-hash <hash>", "Option to filter the subgraph query results with a specific order hash, Will override the 'ORDER_HASH' in env variables")
        .option("--order-owner <address>", "Option to filter the subgraph query results with a specific order owner address, Will override the 'ORDER_OWNER' in env variables")
        .option("--sleep <integer>", "Seconds to wait between each arb round, default is 10, Will override the 'SLEPP' in env variables")
        .option("--flashbot-rpc <url>", "Optional flashbot rpc url to submit transaction to, Will override the 'FLASHBOT_RPC' in env variables")
        .option("--timeout <integer>", "Optional seconds to wait for the transaction to mine before disregarding it, Will override the 'TIMEOUT' in env variables")
        .option("--max-ratio", "Option to maximize maxIORatio, Will override the 'MAX_RATIO' in env variables")
        .option("--no-bundle", "Flag for not bundling orders based on pairs and clear each order individually. Will override the 'NO_BUNDLE' in env variables")
        .option("--hops <integer>", "Option to specify how many hops the binary search should do, default is 1 if left unspecified, Will override the 'HOPS' in env variables")
        .option("--retries <integer>", "Option to specify how many retries should be done for the same order, max value is 3, default is 1 if left unspecified, Will override the 'RETRIES' in env variables")
        .option("--pool-update-interval <integer>", "Option to specify time (in minutes) between pools updates, default is 7 minutes, Will override the 'POOL_UPDATE_INTERVAL' in env variables")
        .option("-w, --wallet-count <integer>", "Number of wallet to submit transactions with, requires '--mnemonic'. Will override the 'WALLET_COUNT' in env variables")
        .option("-t, --topup-amount <number>", "The initial topup amount of excess wallets, requires '--mnemonic'. Will override the 'TOPUP_AMOUNT' in env variables")
        .option("--bot-min-balance <number>", "The minimum gas token balance the bot wallet must have. Will override the 'BOT_MIN_BALANCE' in env variables")
        .option("--self-fund-orders <string>", "Specifies owned order to get funded once their vault goes below the specified threshold, example: token,vaultId,threshold,toptupamount;token,vaultId,threshold,toptupamount;... . Will override the 'SELF_FUND_ORDERS' in env variables")
        .description([
            "A NodeJS app to find and take arbitrage trades for Rain Orderbook orders against some DeFi liquidity providers, requires NodeJS v18 or higher.",
            "- Use \"node arb-bot [options]\" command alias for running the app from its repository workspace",
            "- Use \"arb-bot [options]\" command alias when this app is installed as a dependency in another project"
        ].join("\n"))
        .alias("arb-bot")
        .version(version)
        .parse(argv)
        .opts();

    // assigning specified options from cli/env
    cmdOptions.key                = cmdOptions.key                || ENV_OPTIONS.key;
    cmdOptions.mnemonic           = cmdOptions.mnemonic           || ENV_OPTIONS.mnemonic;
    cmdOptions.rpc                = cmdOptions.rpc                || ENV_OPTIONS.rpc;
    cmdOptions.arbAddress         = cmdOptions.arbAddress         || ENV_OPTIONS.arbAddress;
    cmdOptions.genericArbAddress  = cmdOptions.genericArbAddress  || ENV_OPTIONS.genericArbAddress;
    cmdOptions.orderbookAddress   = cmdOptions.orderbookAddress   || ENV_OPTIONS.orderbookAddress;
    cmdOptions.orders             = cmdOptions.orders             || ENV_OPTIONS.orders;
    cmdOptions.subgraph           = cmdOptions.subgraph           || ENV_OPTIONS.subgraph;
    cmdOptions.lps                = cmdOptions.lps                || ENV_OPTIONS.lps;
    cmdOptions.gasCoverage        = cmdOptions.gasCoverage        || ENV_OPTIONS.gasCoverage;
    cmdOptions.orderHash          = cmdOptions.orderHash          || ENV_OPTIONS.orderHash;
    cmdOptions.orderOwner         = cmdOptions.orderOwner         || ENV_OPTIONS.orderOwner;
    cmdOptions.sleep              = cmdOptions.sleep              || ENV_OPTIONS.sleep;
    cmdOptions.maxRatio           = cmdOptions.maxRatio           || ENV_OPTIONS.maxRatio;
    cmdOptions.flashbotRpc        = cmdOptions.flashbotRpc        || ENV_OPTIONS.flashbotRpc;
    cmdOptions.timeout            = cmdOptions.timeout            || ENV_OPTIONS.timeout;
    cmdOptions.hops               = cmdOptions.hops               || ENV_OPTIONS.hops;
    cmdOptions.retries            = cmdOptions.retries            || ENV_OPTIONS.retries;
    cmdOptions.poolUpdateInterval = cmdOptions.poolUpdateInterval || ENV_OPTIONS.poolUpdateInterval;
    cmdOptions.walletCount        = cmdOptions.walletCount        || ENV_OPTIONS.walletCount;
    cmdOptions.topupAmount        = cmdOptions.topupAmount        || ENV_OPTIONS.topupAmount;
    cmdOptions.selfFundOrders     = cmdOptions.selfFundOrders     || ENV_OPTIONS.selfFundOrders;
    cmdOptions.botMinBalance      = cmdOptions.botMinBalance    || ENV_OPTIONS.botMinBalance;
    cmdOptions.bundle             = cmdOptions.bundle ? ENV_OPTIONS.bundle : false;
    if (cmdOptions.selfFundOrders) {
        cmdOptions.selfFundOrders = Array
            .from(process?.env?.SELF_FUND_ORDERS.matchAll(/[^;]+/g))
            .map(v => {
                const matches = Array.from(v[0].matchAll(/[^,]+/g)).map(e => e[0]);
                return {
                    token: matches[0].toLowerCase(),
                    vaultId: matches[1],
                    threshold: matches[2],
                    topupAmount: matches[3],
                };
            });
    }
    return cmdOptions;
};

/**
 * @param {Tracer} tracer
 * @param {Context} roundCtx
 * @param {CliOptions} options
 * @param {BotConfig} config
 */
const arbRound = async (tracer, roundCtx, options, config) => {
    return await tracer.startActiveSpan("process-orders", {}, roundCtx, async (span) => {
        let ordersCheck = false;
        const ctx = trace.setSpan(context.active(), span);
        try {
            const ordersDetails = await getOrderDetails(
                options.subgraph,
                options.orders,
                config.mainAccount,
                {
                    orderHash: options.orderHash,
                    orderOwner: options.orderOwner,
                    orderbook: options.orderbookAddress,
                },
                span
            );
            ordersCheck = true;
            if (!ordersDetails.length) {
                span.setStatus({ code: SpanStatusCode.OK, message: "found no orders" });
                span.end();
                return { txs: [], foundOpp: false, avgGasCost: undefined };
            }

            let txs;
            let foundOpp = false;
            const { reports, avgGasCost } = await clear(
                config,
                ordersDetails,
                tracer,
                ctx,
            );
            if (reports && reports.length) {
                txs = reports.map(v => v.txUrl).filter(v => !!v);
                if (txs.length) {
                    foundOpp = true;
                    span.setAttribute("txUrls", txs);
                    span.setAttribute("didClear", true);
                    span.setAttribute("foundOpp", true);
                } else if (reports.some(
                    v => v.status === ProcessPairReportStatus.FoundOpportunity
                )) {
                    foundOpp = true;
                    span.setAttribute("foundOpp", true);
                }
            } else {
                span.setAttribute("didClear", false);
            }
            if (avgGasCost) {
                span.setAttribute("avgGasCost", avgGasCost.toString());
            }
            span.setStatus({ code: SpanStatusCode.OK });
            span.end();
            return { txs, foundOpp, avgGasCost };
        } catch(e) {
            const snapshot = errorSnapshot("", e);
            if (ordersCheck) {
                span.setAttribute("severity", ErrorSeverity.HIGH);
            }
            span.setAttribute("didClear", false);
            span.setAttribute("foundOpp", false);
            span.setStatus({ code: SpanStatusCode.ERROR, message: snapshot });
            span.recordException(e);
            span.end();
            return { txs: [], foundOpp: false, avgGasCost: undefined };
        }
    });
};

/**
 * CLI startup function
 * @param {*} argv - cli args
 */
async function startup(argv) {
    let roundGap = 10000;
    let _poolUpdateInterval = 5;

    const options = await getOptions(argv);

    if (
        (!options.key && !options.mnemonic)
        || (options.key && options.mnemonic)
    ) {
        throw "undefined wallet, only one of key or mnemonic should be specified";
    }
    if (options.mnemonic) {
        if ((!options.walletCount || !options.topupAmount)) {
            throw "--wallet-count and --toptup-amount are required when using mnemonic option";
        }
        if (!/^[0-9]+$/.test(options.walletCount)) {
            throw "invalid --wallet-count, it should be an integer greater than equal 0";
        } else {
            options.walletCount = Number(options.walletCount);
        }
        if (!/^[0-9]+(.[0-9]+)?$/.test(options.topupAmount)) {
            throw "invalid --topup-amount, it should be an number greater than equal 0";
        }
    }
    if (options.key) {
        if (!/^(0x)?[a-fA-F0-9]{64}$/.test(options.key)) throw "invalid wallet private key";
    }
    if (!options.rpc) throw "undefined RPC URL";
    if (!options.arbAddress) throw "undefined arb contract address";
    if (options.sleep) {
        if (/^[0-9]+$/.test(options.sleep)) roundGap = Number(options.sleep) * 1000;
        else throw "invalid sleep value, must be an integer greater than equal 0";
    }
    if (options.poolUpdateInterval) {
        if (typeof options.poolUpdateInterval === "number") {
            _poolUpdateInterval = options.poolUpdateInterval;
            if (_poolUpdateInterval === 0 || !Number.isInteger(_poolUpdateInterval))
                throw "invalid poolUpdateInterval value, must be an integer greater than zero";
        }
        else if (typeof options.poolUpdateInterval === "string" && /^[0-9]+$/.test(options.poolUpdateInterval)) {
            _poolUpdateInterval = Number(options.poolUpdateInterval);
            if (_poolUpdateInterval === 0) throw "invalid poolUpdateInterval value, must be an integer greater than zero";
        }
        else throw "invalid poolUpdateInterval value, must be an integer greater than zero";
    }
    if (!options.botMinBalance || !/^[0-9]+(.[0-9]+)?$/.test(options.botMinBalance)) {
        throw "expected a valid value for --bot-min-balance, it should be an number greater than 0";
    }
    const poolUpdateInterval = _poolUpdateInterval * 60 * 1000;
    let ordersDetails = [];
    if (!process?.env?.TEST) for (let i = 0; i < 20; i++) {
        try {
            ordersDetails = await getOrderDetails(
                options.subgraph,
                options.orders,
                undefined,
                {
                    orderHash: options.orderHash,
                    orderOwner: options.orderOwner,
                    orderbook: options.orderbookAddress,
                },
            );
            break;
        } catch(e) {
            if (i != 19) await sleep(10000 * (i + 1));
            else throw e;
        }
    }
    const tokens = getOrdersTokens(ordersDetails);

    // get config
    const config = await getConfig(
        options.rpc,
        options.key ?? options.mnemonic,
        options.arbAddress,
        {
            tokens,
            maxRatio             : options.maxRatio,
            flashbotRpc          : options.flashbotRpc,
            timeout              : options.timeout,
            bundle               : options.bundle,
            hops                 : options.hops,
            retries              : options.retries,
            poolUpdateInterval   : options.poolUpdateInterval,
            gasCoveragePercentage: options.gasCoverage,
            topupAmount          : options.topupAmount,
            walletCount          : options.walletCount,
            genericArbAddress    : options.genericArbAddress,
            liquidityProviders   : options.lps
                ? Array.from(options.lps.matchAll(/[^,\s]+/g)).map(v => v[0])
                : undefined,
        }
    );

    return {
        roundGap,
        options,
        poolUpdateInterval,
        config,
    };
}

const main = async argv => {
    // startup otel to collect span, logs, etc
    // diag otel
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ERROR);

    const exporter = new OTLPTraceExporter((
        process?.env?.HYPERDX_API_KEY
            ? {
                url: "https://in-otel.hyperdx.io/v1/traces",
                headers: {
                    authorization: process?.env?.HYPERDX_API_KEY,
                },
                compression: "gzip",
            }
            : {
                compression: "gzip",
            }
    ));
    const provider = new BasicTracerProvider({
        resource: new Resource({
            [SEMRESATTRS_SERVICE_NAME]: process?.env?.TRACER_SERVICE_NAME ?? "arb-bot"
        }),
    });
    provider.addSpanProcessor(new BatchSpanProcessor(exporter));

    // console spans in case hyperdx api is not defined
    if (!process?.env?.HYPERDX_API_KEY) {
        const consoleExporter = new ConsoleSpanExporter();
        provider.addSpanProcessor(new SimpleSpanProcessor(consoleExporter));
    }

    provider.register();
    const tracer = provider.getTracer("arb-bot-tracer");

    // parse cli args and startup bot configuration
    const {
        roundGap,
        options,
        poolUpdateInterval,
        config,
    } = await tracer.startActiveSpan("startup", async (startupSpan) => {
        try {
            const result = await startup(argv);
            startupSpan.setStatus({ code: SpanStatusCode.OK });
            startupSpan.end();
            return result;
        } catch (e) {
            const snapshot = errorSnapshot("", e);
            startupSpan.setAttribute("severity", ErrorSeverity.HIGH);
            startupSpan.setStatus({ code: SpanStatusCode.ERROR, message: snapshot });
            startupSpan.recordException(e);

            // end this span and wait for it to finish
            startupSpan.end();
            await sleep(20000);

            // flush and close the otel connection.
            await exporter.shutdown();
            await sleep(10000);

            // reject the promise that makes the cli process to exit with error
            return Promise.reject(e);
        }
    });

    let lastInterval = Date.now() + poolUpdateInterval;
    let lastUsedAccountIndex = config.accounts.length;
    let avgGasCost;
    let counter = 1;
    const wgc = [];
    const wgcBuffer = [];
    const botMinBalance = ethers.utils.parseUnits(options.botMinBalance);

    // run bot's processing orders in a loop
    // eslint-disable-next-line no-constant-condition
    while (true) {
        await tracer.startActiveSpan(`round-${counter}`, async (roundSpan) => {
            const roundCtx = trace.setSpan(context.active(), roundSpan);
            roundSpan.setAttributes({
                ...await getMetaInfo(config, options.subgraph),
                "meta.mainAccount": config.mainAccount.account.address,
                "meta.gitCommitHash": process?.env?.GIT_COMMIT ?? "N/A",
                "meta.dockerTag": process?.env?.DOCKER_TAG ?? "N/A"
            });
            const botGasBalance = await config.viemClient.getBalance({
                address: config.mainAccount.account.address
            });
            if (botMinBalance.gt(botGasBalance)) {
                roundSpan.setStatus({
                    code: SpanStatusCode.ERROR,
                    message: `bot is low on gas, expected at least: ${
                        options.botMinBalance
                    }, current balance: ${
                        ethers.utils.formatUnits(ethers.BigNumber.from(botGasBalance))
                    }`
                });
                roundSpan.setAttribute("severity", ErrorSeverity.HIGH);
                roundSpan.end();
                // wait 2 mins before trying again
                await sleep(120000);
                return;
            }
            // remove pool memoizer cache on each interval
            let update = false;
            const now = Date.now();
            if (lastInterval <= now) {
                lastInterval = now + poolUpdateInterval;
                update = true;
            }
            try {
                await rotateProviders(config, update);
                const roundResult = await arbRound(tracer, roundCtx, options, config);
                let txs, foundOpp, roundAvgGasCost;
                if (roundResult) {
                    txs = roundResult.txs;
                    foundOpp = roundResult.foundOpp;
                    roundAvgGasCost = roundResult.avgGasCost;
                }
                if (txs && txs.length) {
                    roundSpan.setAttribute("txUrls", txs);
                    roundSpan.setAttribute("didClear", true);
                    roundSpan.setAttribute("foundOpp", true);
                } else if (foundOpp) {
                    roundSpan.setAttribute("foundOpp", true);
                    roundSpan.setAttribute("didClear", false);
                } else {
                    roundSpan.setAttribute("foundOpp", false);
                    roundSpan.setAttribute("didClear", false);
                }

                // keep avg gas cost
                if (roundAvgGasCost) {
                    if (avgGasCost) {
                        avgGasCost = avgGasCost.add(roundAvgGasCost).div(2);
                    } else {
                        avgGasCost = roundAvgGasCost;
                    }
                }
                if (avgGasCost && config.accounts.length) {
                    // manage account by removing those that have ran out of gas
                    // and issuing a new one into circulation
                    lastUsedAccountIndex = await manageAccounts(
                        config,
                        options,
                        avgGasCost,
                        lastUsedAccountIndex,
                        wgc,
                    );
                }

                // sweep tokens and wallets every 100 rounds
                if ((counter % 100) === 0) {
                    let gasPrice;
                    try {
                        gasPrice = ethers.BigNumber.from(await config.viemClient.getGasPrice());
                    } catch { /**/ }
                    // try to sweep wallets that still have non transfered tokens to main wallet
                    if (wgc.length && gasPrice) {
                        for (let k = wgc.length - 1; k >= 0; k--) {
                            await sweepToMainWallet(
                                wgc[k],
                                config.mainAccount,
                                gasPrice,
                            );
                            if (!wgc[k].BOUNTY.length) {
                                const index = wgcBuffer.findIndex(
                                    v => v.address === wgc[k].account.address
                                );
                                if (index > -1) wgcBuffer.splice(index, 1);
                                wgc.splice(k, 1);
                            }
                            else {
                                // retry to sweep garbage wallet 3 times before letting it go
                                const index = wgcBuffer.findIndex(
                                    v => v.address === wgc[k].account.address
                                );
                                if (index > -1) {
                                    wgcBuffer[index].count++;
                                    if (wgcBuffer[index].count >= 2) {
                                        wgcBuffer.splice(index, 1);
                                        wgc.splice(k, 1);
                                    }
                                } else {
                                    wgcBuffer.push({ address: wgc[k].account.address, count: 0 });
                                }
                            }
                        }
                    }
                    // try to sweep main wallet's tokens back to eth
                    try { await sweepToEth(config); } catch { /**/ }
                }
                roundSpan.setStatus({ code: SpanStatusCode.OK });
            }
            catch (error) {
                const snapshot = errorSnapshot("", error);
                roundSpan.setAttribute("severity", ErrorSeverity.HIGH);
                roundSpan.setAttribute("didClear", false);
                roundSpan.recordException(error);
                roundSpan.setStatus({ code: SpanStatusCode.ERROR, message: snapshot });
            }
            if (config.accounts.length) {
                roundSpan.setAttribute("circulatingAccounts", config.accounts.map(v => v.account.address));
            }
            if (avgGasCost) {
                roundSpan.setAttribute("avgGasCost", ethers.utils.formatUnits(avgGasCost));
            }
            // eslint-disable-next-line no-console
            console.log(`Starting next round in ${roundGap / 1000} seconds...`, "\n");
            roundSpan.end();
            await sleep(roundGap);
            // give otel some time to export
            await sleep(3000);
        });
        counter++;
    }

    // flush and close the connection.
    // eslint-disable-next-line no-unreachable
    await exporter.shutdown();
    await sleep(10000);
};

module.exports = {
    arbRound,
    startup,
    main,
};
