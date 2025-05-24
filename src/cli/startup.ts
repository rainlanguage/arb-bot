import { OtelTracer } from ".";
import { getGasPrice } from "../gas";
import { AppOptions } from "../yaml";
import { getCliOptions } from "./options";
import { getOrderDetails, getConfig } from "../";
import { getOrdersTokens, getOrderbookOwnersProfileMapFromSg } from "../order";
import {
    BotConfig,
    ViemClient,
    TokenDetails,
    OperationState,
    OrderbooksOwnersProfileMap,
} from "../types";

export type CliStartupResult = {
    config: BotConfig;
    options: AppOptions;
    state: OperationState;
    startupTimestamp: number;
    watchedTokens: TokenDetails[];
    orderbooksOwnersProfileMap: OrderbooksOwnersProfileMap;
};

/**
 * Handles Rain Solver startup process executed from cli, that is creating
 * AppOptions from the given path to yaml config, getting initial order details
 * from subgraph, initializing the OperationSate and building owner profile mapping
 * @param argv - CLI args
 * @param version - App version
 * @param otelTracer - Otel tracer and context
 */
export async function startup(
    argv: any,
    version?: string,
    otelTracer?: OtelTracer,
): Promise<CliStartupResult> {
    // get cli options
    const cmdOptions = getCliOptions(argv, version);

    // init AppOptions from the config yaml
    const options = AppOptions.fromYaml(cmdOptions.config);

    // fetch orders at startup
    const ordersDetailsPromise = getOrderDetails(options.subgraph, options.sgFilter);
    const startupTimestamp = Math.floor(Date.now() / 1000);
    const ordersDetails = await ordersDetailsPromise;

    const watchedTokens = getOrdersTokens(ordersDetails);

    // init raw state
    const state = OperationState.init(options.rpc, options.writeRpc);

    // get config
    const config = await getConfig(options, state, otelTracer?.tracer, otelTracer?.ctx);
    config.watchedTokens = watchedTokens;

    // fetch initial gas price on startup
    await getGasPrice(config, state);

    // build owner profile map
    const orderbooksOwnersProfileMap = await getOrderbookOwnersProfileMapFromSg(
        ordersDetails,
        config.viemClient as any as ViemClient,
        watchedTokens,
        options.ownerProfile,
    );

    return {
        state,
        config,
        options,
        watchedTokens,
        startupTimestamp,
        orderbooksOwnersProfileMap,
    };
}
