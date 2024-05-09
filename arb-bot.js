#!/usr/bin/env node

require("dotenv").config();
const fs = require("fs");
const { Command } = require("commander");
const { version } = require("./package.json");
const { sleep, getSpanException } = require("./src/utils");
const { getOrderDetails, clear, getConfig } = require("./src");
const { Resource } = require("@opentelemetry/resources");
const { OTLPTraceExporter } = require("@opentelemetry/exporter-trace-otlp-http");
const { SEMRESATTRS_SERVICE_NAME } = require("@opentelemetry/semantic-conventions");
const { BasicTracerProvider, BatchSpanProcessor, ConsoleSpanExporter, SimpleSpanProcessor } = require("@opentelemetry/sdk-trace-base");
const { diag, trace, context, SpanStatusCode, DiagConsoleLogger, DiagLogLevel } = require("@opentelemetry/api");


/**
 * Options specified in env variables
 */
const ENV_OPTIONS = {
    key                 : process?.env?.BOT_WALLET_PRIVATEKEY,
    arbAddress          : process?.env?.ARB_ADDRESS,
    orderbookAddress    : process?.env?.ORDERBOOK_ADDRESS,
    orders              : process?.env?.ORDERS,
    lps                 : process?.env?.LIQUIDITY_PROVIDERS,
    gasCoverage         : process?.env?.GAS_COVER || "100",
    repetitions         : process?.env?.REPETITIONS,
    orderHash           : process?.env?.ORDER_HASH,
    orderOwner          : process?.env?.ORDER_OWNER,
    orderInterpreter    : process?.env?.ORDER_INTERPRETER,
    sleep               : process?.env?.SLEEP,
    maxProfit           : process?.env?.MAX_PROFIT?.toLowerCase() === "true" ? true : false,
    maxRatio            : process?.env?.MAX_RATIO?.toLowerCase() === "true" ? true : false,
    bundle              : process?.env?.NO_BUNDLE?.toLowerCase() === "true" ? false : true,
    timeout             : process?.env?.TIMEOUT,
    flashbotRpc         : process?.env?.FLASHBOT_RPC,
    hops                : process?.env?.HOPS,
    retries             : process?.env?.RETRIES,
    poolUpdateInterval  : process?.env?.POOL_UPDATE_INTERVAL || "15",
    rpVersion           : process?.env?.RP_VERSION,
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
        .option("-o, --orders <path>", "The path to a local json file containing the orders details, can be used in combination with --subgraph, Will override the 'ORDERS' in env variables")
        .option("-s, --subgraph <url...>", "Subgraph URL(s) to read orders details from, can be used in combination with --orders, Will override the 'SUBGRAPH' in env variables")
        .option("--orderbook-address <address>", "Address of the deployed orderbook contract, Will override the 'ORDERBOOK_ADDRESS' in env variables")
        .option("--arb-address <address>", "Address of the deployed arb contract, Will override the 'ARB_ADDRESS' in env variables")
        .option("-l, --lps <string>", "List of liquidity providers (dex) to use by the router as one quoted string seperated by a comma for each, example: 'SushiSwapV2,UniswapV3', Will override the 'LIQUIDITY_PROVIDERS' in env variables, if unset will use all available liquidty providers")
        .option("-g, --gas-coverage <integer>", "The percentage of gas to cover to be considered profitable for the transaction to be submitted, an integer greater than equal 0, default is 100 meaning full coverage, Will override the 'GAS_COVER' in env variables")
        .option("--repetitions <integer>", "Option to run `number` of times, if unset will run for infinte number of times")
        .option("--order-hash <hash>", "Option to filter the subgraph query results with a specific order hash, Will override the 'ORDER_HASH' in env variables")
        .option("--order-owner <address>", "Option to filter the subgraph query results with a specific order owner address, Will override the 'ORDER_OWNER' in env variables")
        .option("--order-interpreter <address>", "Option to filter the subgraph query results with a specific order's interpreter address, Will override the 'ORDER_INTERPRETER' in env variables")
        .option("--sleep <integer>", "Seconds to wait between each arb round, default is 10, Will override the 'SLEPP' in env variables")
        .option("--flashbot-rpc <url>", "Optional flashbot rpc url to submit transaction to, Will override the 'FLASHBOT_RPC' in env variables")
        .option("--timeout <integer>", "Optional seconds to wait for the transaction to mine before disregarding it, Will override the 'TIMEOUT' in env variables")
        .option("--max-profit", "Option to maximize profit, comes at the cost of more RPC calls, Will override the 'MAX_PROFIT' in env variables")
        .option("--max-ratio", "Option to maximize maxIORatio, Will override the 'MAX_RATIO' in env variables")
        .option("--no-bundle", "Flag for not bundling orders based on pairs and clear each order individually. Will override the 'NO_BUNDLE' in env variables")
        .option("--hops <integer>", "Option to specify how many hops the binary search should do, default is 11 if left unspecified, Will override the 'HOPS' in env variables")
        .option("--rp-version", "Option to use sushi RouteProcessor given version, possible version are: 3, 3.1, 3.2, 4, defaults to v3 if not passed, Will override the 'RP_VERSION' in env variables")
        .option("--retries <integer>", "Option to specify how many retries should be done for the same order, max value is 3, default is 1 if left unspecified, Will override the 'RETRIES' in env variables")
        .option("--pool-update-interval <integer>", "Option to specify time (in minutes) between pools updates, default is 15 minutes, Will override the 'POOL_UPDATE_INTERVAL' in env variables")
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
    cmdOptions.key              = cmdOptions.key                || ENV_OPTIONS.key;
    cmdOptions.rpc              = cmdOptions.rpc                || ENV_OPTIONS.rpc;
    cmdOptions.arbAddress       = cmdOptions.arbAddress         || ENV_OPTIONS.arbAddress;
    cmdOptions.orderbookAddress = cmdOptions.orderbookAddress   || ENV_OPTIONS.orderbookAddress;
    cmdOptions.orders           = cmdOptions.orders             || ENV_OPTIONS.orders;
    cmdOptions.subgraph         = cmdOptions.subgraph           || ENV_OPTIONS.subgraph;
    cmdOptions.lps              = cmdOptions.lps                || ENV_OPTIONS.lps;
    cmdOptions.gasCoverage      = cmdOptions.gasCoverage        || ENV_OPTIONS.gasCoverage;
    cmdOptions.repetitions      = cmdOptions.repetitions        || ENV_OPTIONS.repetitions;
    cmdOptions.orderHash        = cmdOptions.orderHash          || ENV_OPTIONS.orderHash;
    cmdOptions.orderOwner       = cmdOptions.orderOwner         || ENV_OPTIONS.orderOwner;
    cmdOptions.sleep            = cmdOptions.sleep              || ENV_OPTIONS.sleep;
    cmdOptions.orderInterpreter = cmdOptions.orderInterpreter   || ENV_OPTIONS.orderInterpreter;
    cmdOptions.maxProfit        = cmdOptions.maxProfit          || ENV_OPTIONS.maxProfit;
    cmdOptions.maxRatio         = cmdOptions.maxRatio           || ENV_OPTIONS.maxRatio;
    cmdOptions.flashbotRpc      = cmdOptions.flashbotRpc        || ENV_OPTIONS.flashbotRpc;
    cmdOptions.timeout          = cmdOptions.timeout            || ENV_OPTIONS.timeout;
    cmdOptions.hops             = cmdOptions.hops               || ENV_OPTIONS.hops;
    cmdOptions.retries          = cmdOptions.retries            || ENV_OPTIONS.retries;
    cmdOptions.rpVersion        = cmdOptions.rpVersion          || ENV_OPTIONS.rpVersion;
    cmdOptions.bundle           = cmdOptions.bundle ? ENV_OPTIONS.bundle : false;
    cmdOptions.poolUpdateInterval = cmdOptions.poolUpdateInterval || ENV_OPTIONS.poolUpdateInterval;

    return cmdOptions;
};

/**
 * @param {import("@opentelemetry/sdk-trace-base").Tracer} tracer
 * @param {import("@opentelemetry/api").Context} roundCtx
 * @param {*} options
 */
const arbRound = async (tracer, roundCtx, options, lastError) => {

    if (!options.key)               throw "undefined wallet private key";
    if (!options.rpc)               throw "undefined RPC URL";
    if (!options.arbAddress)        throw "undefined arb contract address";
    if (!options.orderbookAddress)  throw "undefined orderbook contract address";

    const config = await tracer.startActiveSpan("get-config", {}, roundCtx, async (span) => {
        try {
            const result = await getConfig(
                options.rpc,
                options.key,
                options.orderbookAddress,
                options.arbAddress,
                {
                    maxProfit           : options.maxProfit,
                    maxRatio            : options.maxRatio,
                    flashbotRpc         : options.flashbotRpc,
                    timeout             : options.timeout,
                    bundle              : options.bundle,
                    hops                : options.hops,
                    retries             : options.retries,
                    poolUpdateInterval  : options.poolUpdateInterval,
                    rpVersion           : options.rpVersion,
                    liquidityProviders  : options.lps
                        ? Array.from(options.lps.matchAll(/[^,\s]+/g)).map(v => v[0])
                        : undefined,
                }
            );
            span.setStatus({ code: SpanStatusCode.OK });
            span.end();
            return result;
        } catch(e) {
            span.setStatus({ code: SpanStatusCode.ERROR });
            const error = getSpanException(e);
            if (lastError && lastError === error) {
                span.recordException("same as previous round, see parent span links");
            } else {
                span.recordException(error);
            }
            span.end();
            return Promise.reject(e);
        }
    });

    const ordersDetails = await tracer.startActiveSpan("get-order-details", {}, roundCtx, async (span) => {
        try {
            const result = await getOrderDetails(
                options.subgraph,
                options.orders,
                config.signer,
                {
                    orderHash       : options.orderHash,
                    orderOwner      : options.orderOwner,
                    orderInterpreter: options.orderInterpreter
                },
                tracer,
                trace.setSpan(context.active(), span)
            );
            if (result.length) {
                span.setAttribute("details.orders.ids", result.map(v => v.id));
                span.setStatus({ code: SpanStatusCode.OK });
            }
            else {
                span.setStatus({ code: SpanStatusCode.OK, message: "found no orders"});
            }
            span.end();
            return result;
        } catch(e) {
            span.setStatus({ code: SpanStatusCode.ERROR });
            span.recordException(getSpanException(e));
            span.end();
            return Promise.reject(e);
        }
    });

    if (!ordersDetails.length) return;

    return await tracer.startActiveSpan("take-orders", {}, roundCtx, async (span) => {
        span.setAttributes({
            "details.config.chainid": options.chainId,
            "details.config.network": options.network,
            "details.config.gasCoveragePercentage": options.gasCoverage ?? "100",
            "details.config.rpcUrl": config.rpc,
            "details.config.orderbookAddress": config.orderbookAddress,
            "details.config.arbAddress": config.arbAddress,
            "details.config.maxProfit": config.maxProfit,
            "details.config.maxRatio": config.maxRatio,
            "details.config.usesFlashbots": config.flashbotRpc ? true : false,
            "details.config.sushiRouteProcessorVersion": config.rpVersion,
            "details.config.amountDiscoveryHops": config.hops
        });
        const ctx = trace.setSpan(context.active(), span);
        try {
            let txs;
            const reports = await clear(
                config,
                ordersDetails,
                {
                    gasCoveragePercentage: options.gasCoverage
                },
                tracer,
                ctx
            );
            if (reports && reports.length) {
                txs = reports.map(v => v.txUrl).filter(v => !!v);
                if (txs.length) {
                    span.setAttribute("details.txUrls", txs);
                    span.setAttribute("details.didClear", true);
                }
            }
            else {
                span.setAttribute("details.didClear", false);
            }
            span.setStatus({ code: SpanStatusCode.OK });
            span.end();
            return txs;
        } catch(e) {
            span.setAttribute("details.didClear", false);
            span.setStatus({ code: SpanStatusCode.ERROR });
            const error = getSpanException(e);
            if (lastError && lastError === error) {
                span.recordException("same as previous round, see parent span links");
            } else {
                span.recordException(error);
            }
            span.end();
            return Promise.reject(e);
        }
    });
};

const main = async argv => {
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
    let _poolUpdateInterval = 15;
    if (options.poolUpdateInterval) {
        if (typeof options.poolUpdateInterval === "number") {
            _poolUpdateInterval = options.poolUpdateInterval;
            if (_poolUpdateInterval === 0 || !Number.isInteger(_poolUpdateInterval))
                throw "invalid poolUpdateInterval value, must be an integer greater than zero";
        }
        else if (typeof options.poolUpdateInterval === "string" && /^\d+$/.test(options.poolUpdateInterval)) {
            _poolUpdateInterval = Number(options.poolUpdateInterval);
            if (_poolUpdateInterval === 0) throw "invalid poolUpdateInterval value, must be an integer greater than zero";
        }
        else throw "invalid poolUpdateInterval value, must be an integer greater than zero";
    }
    const poolUpdateInterval = _poolUpdateInterval * 60 * 1000;
    let lastInterval = Date.now() + poolUpdateInterval;

    let counter = 0;
    let lastError;
    let lastSpanContext;
    // eslint-disable-next-line no-constant-condition
    if (repetitions === -1) while (true) {
        await tracer.startActiveSpan(`round-${counter}`, async (roundSpan) => {
            // remove pool memoizer cache on each interval
            const now = Date.now();
            if (lastInterval <= now) {
                lastInterval = now + poolUpdateInterval;
                try {
                    fs.rmSync("./mem-cache", { recursive: true });
                    fs.mkdirSync("./mem-cache", { recursive: true });
                } catch {
                    /**/
                }
            }
            const roundCtx = trace.setSpan(context.active(), roundSpan);
            options.rpc = rpcs[rpcTurn];
            try {
                const txs = await arbRound(tracer, roundCtx, options, lastError);
                if (txs && txs.length) {
                    roundSpan.setAttribute("details.txUrls", txs);
                    roundSpan.setAttribute("didClear", true);
                    roundSpan.setStatus({ code: SpanStatusCode.OK });
                }
                else {
                    roundSpan.setAttribute("didClear", false);
                    roundSpan.setStatus({ code: SpanStatusCode.OK });
                }
                lastError = undefined;
                lastSpanContext = undefined;
            }
            catch (error) {
                const newError = getSpanException(error);
                if (!lastError || newError !== lastError) {
                    lastSpanContext = roundSpan.spanContext();
                    lastError = newError;
                } else {
                    if (!lastSpanContext) lastSpanContext = roundSpan.spanContext();
                    else roundSpan.links = [{ context: lastSpanContext }];
                }
                roundSpan.setAttribute("didClear", false);
                roundSpan.setStatus({ code: SpanStatusCode.ERROR });
            }
            console.log(`Starting next round in ${roundGap / 1000} seconds...`, "\n");
            if (rpcTurn === rpcs.length - 1) rpcTurn = 0;
            else rpcTurn++;
            roundSpan.end();
            await sleep(roundGap);
            // give otel some time to export
            await sleep(3000);
        });
        counter++;
    }
    else for (let i = 1; i <= repetitions; i++) {
        await tracer.startActiveSpan(`round-${i}`, async (roundSpan) => {
            // remove pool memoizer cache on each interval
            const now = Date.now();
            if (lastInterval <= now) {
                lastInterval = now + poolUpdateInterval;
                try {
                    fs.rmSync("./mem-cache", { recursive: true });
                    fs.mkdirSync("./mem-cache", { recursive: true });
                } catch {
                    /**/
                }
            }
            const roundCtx = trace.setSpan(context.active(), roundSpan);
            options.rpc = rpcs[rpcTurn];
            try {
                const txs = await arbRound(tracer, roundCtx, options, lastError);
                if (txs && txs.length) {
                    roundSpan.setAttribute("details.txUrls", txs);
                    roundSpan.setAttribute("didClear", true);
                    roundSpan.setStatus({ code: SpanStatusCode.OK });
                }
                else {
                    roundSpan.setAttribute("didClear", false);
                    roundSpan.setStatus({ code: SpanStatusCode.OK });
                }
                lastError = undefined;
                lastSpanContext = undefined;
            }
            catch (error) {
                const newError = getSpanException(error);
                if (!lastError || newError !== lastError) {
                    lastSpanContext = roundSpan.spanContext();
                    lastError = newError;
                } else {
                    if (!lastSpanContext) lastSpanContext = roundSpan.spanContext();
                    else roundSpan.links = [{ context: lastSpanContext }];
                }
                roundSpan.setAttribute("didClear", false);
                roundSpan.setStatus({ code: SpanStatusCode.ERROR });
            }
            if (i !== repetitions) console.log(
                `Starting round ${i + 1} in ${roundGap / 1000} seconds...`, "\n"
            );
            if (rpcTurn === rpcs.length - 1) rpcTurn = 0;
            else rpcTurn++;
            roundSpan.end();
            await sleep(roundGap);
            // give otel some time to export
            await sleep(3000);
        });
    }

    // flush and close the connection.
    await exporter.shutdown();
    await sleep(10000);
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