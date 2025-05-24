import { getGasPrice } from "../gas";
import { AppOptions } from "../yaml";
import { getCliOptions } from "./options";
import { getOrderDetails, getConfig } from "../";
import { Context, Tracer } from "@opentelemetry/api";
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
 * Handles the RainSolver startup process execution by:
 * - Loading `AppOptions` from the specified YAML config file that is read from given path
 * - Fetching initial order details from the subgraph
 * - Setting up the `OperationState`
 * - Constructing the owner profile mapping (owner limits)
 *
 * @param argv - CLI arguments
 * @param version - Optional application version
 * @param tracer - Optional OTEL tracer
 * @param span - Optional parent otel context
 */
export async function startup(
    argv: any,
    version?: string,
    tracer?: Tracer,
    ctx?: Context,
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
    const config = await getConfig(options, state, tracer, ctx);
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
