#!/usr/bin/env node

require("dotenv").config();
const { Command } = require("commander");
const { version } = require("./package.json");
const { sleep, appGlobalLogger, getSpanException } = require("./src/utils");
const { getOrderDetails, clear, getConfig } = require("./src");
const { Resource } = require("@opentelemetry/resources");
const { OTLPTraceExporter } = require("@opentelemetry/exporter-trace-otlp-http");
const { SEMRESATTRS_SERVICE_NAME } = require("@opentelemetry/semantic-conventions");
const { BasicTracerProvider, BatchSpanProcessor } = require("@opentelemetry/sdk-trace-base");
const { diag, trace, context, SpanStatusCode, DiagConsoleLogger, DiagLogLevel } = require("@opentelemetry/api");


/**
 * Options specified in env variables
 */
const ENV_OPTIONS = {
    key                 : process?.env?.BOT_WALLET_PRIVATEKEY,
    mode                : process?.env?.MODE ?? "srouter",
    arbAddress          : process?.env?.ARB_ADDRESS,
    arbType             : process?.env?.ARB_TYPE,
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
    interpreterv2       : process?.env?.INTERPRETERV2?.toLowerCase() === "true" ? true : false,
    bundle              : process?.env?.NO_BUNDLE?.toLowerCase() === "true" ? false : true,
    timeout             : process?.env?.TIMEOUT,
    flashbotRpc         : process?.env?.FLASHBOT_RPC,
    hops                : process?.env?.HOPS,
    rp32                : process?.env?.RP3_2?.toLowerCase() === "true" ? true : false,
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
        .option("-m, --mode <string>", "Running mode of the bot, must be one of: `curve` or `router` or `crouter` or `srouter`, Will override the 'MODE' in env variables")
        .option("-o, --orders <path>", "The path to a local json file containing the orders details, can be used in combination with --subgraph, Will override the 'ORDERS' in env variables")
        .option("-s, --subgraph <url...>", "Subgraph URL(s) to read orders details from, can be used in combination with --orders, Will override the 'SUBGRAPH' in env variables")
        .option("--orderbook-address <address>", "Address of the deployed orderbook contract, Will override the 'ORDERBOOK_ADDRESS' in env variables")
        .option("--arb-address <address>", "Address of the deployed arb contract, Will override the 'ARB_ADDRESS' in env variables")
        .option("--arb-contract-type <string>", "Type of the Arb contract, can be either of `flash-loan-v2` or `flash-loan-v3` or `order-taker`, not availabe for `srouter` mode since it is a specialized mode, Will override the 'ARB_TYPE' in env variables")
        .option("-l, --lps <string>", "List of liquidity providers (dex) to use by the router as one quoted string seperated by a comma for each, example: 'SushiSwapV2,UniswapV3', Will override the 'LIQUIDITY_PROVIDERS' in env variables, if unset will use all available liquidty providers")
        .option("-g, --gas-coverage <integer>", "The percentage of gas to cover to be considered profitable for the transaction to be submitted, an integer greater than equal 0, default is 100 meaning full coverage, Will override the 'GAS_COVER' in env variables")
        .option("--repetitions <integer>", "Option to run `number` of times, if unset will run for infinte number of times")
        .option("--order-hash <hash>", "Option to filter the subgraph query results with a specific order hash, Will override the 'ORDER_HASH' in env variables")
        .option("--order-owner <address>", "Option to filter the subgraph query results with a specific order owner address, Will override the 'ORDER_OWNER' in env variables")
        .option("--order-interpreter <address>", "Option to filter the subgraph query results with a specific order's interpreter address, Will override the 'ORDER_INTERPRETER' in env variables")
        .option("--sleep <integer>", "Seconds to wait between each arb round, default is 10, Will override the 'SLEPP' in env variables")
        .option("--flashbot-rpc <url>", "Optional flashbot rpc url to submit transaction to, Will override the 'FLASHBOT_RPC' in env variables")
        .option("--timeout <integer>", "Optional seconds to wait for the transaction to mine before disregarding it, Will override the 'TIMEOUT' in env variables")
        .option("--max-profit", "Option to maximize profit for 'srouter' mode, comes at the cost of more RPC calls, Will override the 'MAX_PROFIT' in env variables")
        .option("--max-ratio", "Option to maximize maxIORatio for 'srouter' mode, Will override the 'MAX_RATIO' in env variables")
        .option("--interpreter-v2", "Flag for operating with interpreter V2, note that 'flash-loan-v2' is NOT compatible with interpreter v2. Will override the 'INTERPRETERV2' in env variables")
        .option("--no-bundle", "Flag for not bundling orders based on pairs and clear each order individually. Will override the 'NO_BUNDLE' in env variables")
        .option("--hops <integer>", "Option to specify how many hops the binary search should do in srouter mode, default is 11 if left unspecified, Will override the 'HOPS' in env variables")
        .option("--rp32", "Option to use sushi RouteProcessor v3.2, defaults to v3 if not passed, Will override the 'RP3_2' in env variables")
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
    cmdOptions.mode             = cmdOptions.mode               || ENV_OPTIONS.mode;
    cmdOptions.arbAddress       = cmdOptions.arbAddress         || ENV_OPTIONS.arbAddress;
    cmdOptions.arbType          = cmdOptions.arbType            || ENV_OPTIONS.arbType;
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
    cmdOptions.interpreterv2    = cmdOptions.interpreterv2      || ENV_OPTIONS.interpreterv2;
    cmdOptions.hops             = cmdOptions.hops               || ENV_OPTIONS.hops;
    cmdOptions.rp32             = cmdOptions.rp32               || ENV_OPTIONS.rp32;
    cmdOptions.bundle           = cmdOptions.bundle ? ENV_OPTIONS.bundle : false;

    return cmdOptions;
};

/**
 * @param {import("@opentelemetry/sdk-trace-base").Tracer} tracer
 * @param {import("@opentelemetry/sdk-trace-base").Span} roundSpan
 * @param {import("@opentelemetry/api").Context} roundCtx
 * @param {*} options
 */
const arbRound = async (tracer, roundCtx, options) => {

    if (!options.key)               throw "undefined wallet private key";
    if (!options.rpc)               throw "undefined RPC URL";
    if (!options.arbAddress)        throw "undefined arb contract address";
    if (!options.orderbookAddress)  throw "undefined orderbook contract address";
    if (!options.mode)              throw "undefined operating mode";

    const config = await tracer.startActiveSpan("get-config", {}, roundCtx, async (span) => {
        try {
            const result = await getConfig(
                options.rpc,
                options.key,
                options.orderbookAddress,
                options.arbAddress,
                options.arbType,
                {
                    maxProfit           : options.maxProfit,
                    maxRatio            : options.maxRatio,
                    flashbotRpc         : options.flashbotRpc,
                    hideSensitiveData   : false,
                    shortenLargeLogs    : false,
                    timeout             : options.timeout,
                    interpreterv2       : options.interpreterv2,
                    bundle              : options.bundle,
                    hops                : options.hops,
                    rp32                : options.rp32,
                    liquidityProviders  : options.lps
                        ? Array.from(options.lps.matchAll(/[^,\s]+/g)).map(v => v[0])
                        : undefined,
                }
            );
            span.setStatus({code: SpanStatusCode.OK});
            span.end();
            return result;
        } catch(e) {
            span.setStatus({code: SpanStatusCode.ERROR });
            span.recordException(getSpanException(e));
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
                }
            );
            if (result.length) {
                span.setAttribute("details.orders.json", JSON.stringify(result));
                span.setStatus({code: SpanStatusCode.OK});
            }
            else {
                span.setStatus({code: SpanStatusCode.OK, message: "found no orders"});
            }
            span.end();
            return result;
        } catch(e) {
            span.setStatus({code: SpanStatusCode.ERROR });
            span.recordException(getSpanException(e));
            span.end();
            return Promise.reject(e);
        }
    });

    if (!ordersDetails.length) return;

    await tracer.startActiveSpan("take-orders", {}, roundCtx, async (span) => {
        span.setAttributes({
            "details.config.chainid": options.chainId,
            "details.config.network": options.network,
            "details.config.mode": options.mode,
            "details.config.gasCoveragePercentage": options.gasCoverage ?? "100",
            "details.config.rpcUrl": config.rpc,
            "details.config.orderbookAddress": config.orderbookAddress,
            "details.config.arbAddress": config.arbAddress,
            "details.config.arbType": config.arbType,
            "details.config.maxProfit": config.maxProfit,
            "details.config.maxRatio": config.maxRatio,
            "details.config.interpreterV2": config.interpreterv2,
            "details.config.usesFlashbots": config.flashbotRpc ? true : false,
        });
        if (config.mode !== "curve") {
            span.setAttribute("details.config.sushiRouteProcessorVersion", config.rp32 ? "3.2" : "3.0");
        }
        if (config.mode === "srouter") {
            span.setAttribute("details.config.amountDiscoveryHops", config.hops);
        }
        const ctx = trace.setSpan(context.active(), span);
        try {
            await clear(
                options.mode,
                config,
                ordersDetails,
                {
                    gasCoveragePercentage: options.gasCoverage
                },
                tracer,
                ctx
            );
            span.end();
            return;
        } catch(e) {
            span.setStatus({code: SpanStatusCode.ERROR});
            span.recordException(getSpanException(e));
            span.end();
            return Promise.reject(e);
        }
    });
};

const main = async argv => {
    // diag otel
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ALL);

    const exporter = new OTLPTraceExporter((
        process?.env?.HYPERDX_API_KEY
            ? {
                url: "https://in-otel.hyperdx.io/v1/traces",
                headers: {
                    authorization: process?.env?.HYPERDX_API_KEY,
                }
            }
            : {}
    ));
    const provider = new BasicTracerProvider({
        resource: new Resource({
            [SEMRESATTRS_SERVICE_NAME]: process?.env?.TRACER_SERVICE_NAME ?? "arb-bot"
        }),
    });
    provider.addSpanProcessor(new BatchSpanProcessor(exporter));
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

    appGlobalLogger(
        true,
        // ...rpcs,
        options.key
    );

    let counter = 0;
    // eslint-disable-next-line no-constant-condition
    if (repetitions === -1) while (true) {
        await tracer.startActiveSpan(`round-${counter}`, async (roundSpan) => {
            const roundCtx = trace.setSpan(context.active(), roundSpan);
            options.rpc = rpcs[rpcTurn];
            try {
                await arbRound(tracer, roundCtx, options);
                roundSpan.setStatus({code: SpanStatusCode.OK, message: "Round finished successfully!"});
                console.log("\x1b[32m%s\x1b[0m", "Round finished successfully!");
                console.log(`Starting next round in ${roundGap / 1000} seconds...`, "\n");
            }
            catch (error) {
                roundSpan.setStatus({code: SpanStatusCode.ERROR });
                console.log("\x1b[31m%s\x1b[0m", "An error occured during the round: ");
                console.log(error);
            }
            if (rpcTurn === rpcs.length - 1) rpcTurn = 0;
            else rpcTurn++;
            roundSpan.end();
            await sleep(roundGap);
            await sleep(2000);
        });
        counter++;
    }
    else for (let i = 1; i <= repetitions; i++) {
        await tracer.startActiveSpan(`round-${i}`, async (roundSpan) => {
            const roundCtx = trace.setSpan(context.active(), roundSpan);
            options.rpc = rpcs[rpcTurn];
            try {
                await arbRound(tracer, roundCtx, options);
                roundSpan.setStatus({code: SpanStatusCode.OK, message: "Round finished successfully!"});
                console.log("\x1b[32m%s\x1b[0m", `Round ${i} finished successfully!`);
                if (i !== repetitions) console.log(
                    `Starting round ${i + 1} in ${roundGap / 1000} seconds...`, "\n"
                );
            }
            catch (error) {
                roundSpan.setStatus({code: SpanStatusCode.ERROR });
                console.log("\x1b[31m%s\x1b[0m", `An error occured during round ${i}:`);
                console.log(error);
            }
            if (rpcTurn === rpcs.length - 1) rpcTurn = 0;
            else rpcTurn++;
            roundSpan.end();
            await sleep(roundGap);
            await sleep(2000);
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