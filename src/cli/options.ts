import { Command, OptionValues } from "commander";

/**
 * Parses CLI given options/flags using Commander lib
 * @param argv - The arguments passed to cli
 * @param version - App version
 */
export function getCliOptions(argv: any, version?: string): OptionValues {
    return new Command("node rain-solver")
        .option(
            "-c, --config <path>",
            "Path to config yaml file, can be set in 'CONFIG' env var instead, if none is given, looks for ./config.yaml in curent directory",
            process.env.CONFIG || "./config.yaml",
        )
        .description(
            "Node.js app that solves (clears) Rain Orderbook orders against onchain liquidity (DEXes, other Rain Orderbooks and orders), requires Node.js v22 or higher.",
        )
        .alias("./rain-solver.js")
        .version(version ?? "0.0.0")
        .parse(argv)
        .opts();
}
