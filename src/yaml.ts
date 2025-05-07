import assert from "assert";
import { parse } from "yaml";
import { ethers } from "ethers";
import { readFileSync } from "fs";
import { isBigNumberish } from "./utils";
import { SelfFundOrder, SgFilter } from "./types";

/** Integer pattern */
export const INT_PATTERN = /^[0-9]+$/;

/** Float pattern */
export const FLOAT_PATTERN = /^[0-9]+(\.[0-9]+)?$/;

/** Solidity hash pattern */
export const HASH_PATTERN = /^(0x)?[a-fA-F0-9]{64}$/;

/** Rain Solver app configurations */
export type AppOptions = {
    /** Private key of the bot's wallet, only one of this or mnemonic must be set */
    key?: string;
    /** Mnemonic phrase, only one of this or key must be set */
    mnemonic?: string;
    /** Number of excess wallets for submitting txs, required only when mnemonic option is used */
    walletCount?: number;
    /** Topup amount for excess accounts, required only when mnemonic option is used */
    topupAmount?: string;
    /** List of rpc urls */
    rpc: string[];
    /** List of write rpc urls used explicitly for write transactions */
    writeRpc?: string[];
    /** Arb contract address */
    arbAddress: string;
    /** Dispair contract address */
    dispair: string;
    /** Generic arb contract address */
    genericArbAddress?: string;
    /** List of subgraph urls */
    subgraph: string[];
    /** Option to maximize maxIORatio, default is true */
    maxRatio: boolean;
    /** Only clear orders through RP4, excludes intra and inter orderbook clears, default is true */
    rpOnly: boolean;
    /** list of liquidity providers names, default includes all liquidity providers */
    liquidityProviders?: string[];
    /** Seconds to wait between each arb round, default is 10 */
    sleep: number;
    /** Gas coverage percentage for each transaction to be considered profitable to be submitted, default is 100 */
    gasCoveragePercentage: string;
    /** Optional seconds to wait for the transaction to mine before disregarding it, default is 15 */
    timeout: number;
    /** Number of hops of binary search, if left unspecified will be 1 by default */
    hops: number;
    /** The amount of retries for the same order, maximum allowed 3, minimum allowed 1, default is 1 */
    retries: number;
    /** Option to specify time (in minutes) between pools data resets, default is 0 minutes */
    poolUpdateInterval: number;
    /** Minimum bot's wallet gas token balance required for operating, required */
    botMinBalance: string;
    /** Specifies the routing mode 'multi' or 'single' or 'full', default is 'single' */
    route: "single" | "multi" | undefined;
    /** Option to multiply the gas price fetched from the rpc as percentage, default is 107, ie +7% */
    gasPriceMultiplier: number;
    /** Option to multiply the gas limit estimation from the rpc as percentage, default is 100, ie no change */
    gasLimitMultiplier: number;
    /** Option to set a gas limit for all submitting txs optionally with appended percentage sign to apply as percentage to original gas */
    txGas?: string;
    /** Option to set a static gas limit for quote read calls, default is 1 million */
    quoteGas: bigint;
    /** Optional list of orders to self-fund when vault balance falls below specified threshold */
    selfFundOrders?: SelfFundOrder[];
    /** Option that specifies the owner limit in form of key/value */
    ownerProfile?: Record<string, number>;
    /** Optional filters for inc/exc orders, owner and orderbooks */
    sgFilter?: SgFilter;
};

/** Provides methods to instantiate and validate AppOptions */
export namespace AppOptions {
    /**
     * Instantiates and validates configurations details from the give yaml file
     * @param path - The path to the yaml config file
     */
    export function fromYaml(path: string): AppOptions {
        const content = readFileSync(path, { encoding: "utf8" });
        const obj = parse(content, {
            // parse any number as string for unified validations
            reviver: (_k, v) => (typeof v === "number" || typeof v === "bigint" ? v.toString() : v),
        });
        return AppOptions.tryFrom(obj);
    }

    /**
     * Instantiates and validates configurations details from the give input
     * @param input - The configuration object
     */
    export function tryFrom(input: any): AppOptions {
        return {
            ...AppOptions.resolveWalletKey(input),
            rpc: AppOptions.resolveUrls(
                input.rpc,
                "expected array of rpc urls with at least 1 url",
            ),
            writeRpc: AppOptions.resolveUrls(
                input.writeRpc,
                "expected array of write rpc urls with at least 1 url",
                true,
            ),
            subgraph: AppOptions.resolveUrls(
                input.subgraph,
                "expected array of subgraph urls with at least 1 url",
            ),
            dispair: AppOptions.resolveAddress(input.dispair, "dispair"),
            arbAddress: AppOptions.resolveAddress(input.arbAddress, "arbAddress"),
            genericArbAddress: AppOptions.resolveAddress(
                input.genericArbAddress,
                "genericArbAddress",
                true,
            ),
            liquidityProviders: AppOptions.resolveLiquidityProviders(input.liquidityProviders),
            route: AppOptions.resolveRouteType(input.route),
            ownerProfile: AppOptions.resolveOwnerProfile(input.ownerProfile),
            selfFundOrders: AppOptions.resolveSelfFundOrders(input.selfFundOrders),
            sgFilter: AppOptions.resolveSgFilters(input.sgFilter),
            rpOnly: AppOptions.resolveBool(
                input.rpOnly,
                "expected a boolean value for rpOnly",
                true,
            ),
            maxRatio: AppOptions.resolveBool(
                input.maxRatio,
                "expected a boolean value for maxRatio",
                true,
            ),
            sleep:
                AppOptions.resolveNumericValue(
                    input.sleep,
                    INT_PATTERN,
                    "invalid sleep value, must be an integer greater than equal to 0",
                    "10",
                ) * 1000,
            poolUpdateInterval: AppOptions.resolveNumericValue(
                input.poolUpdateInterval,
                INT_PATTERN,
                "invalid poolUpdateInterval value, must be an integer greater than equal to 0",
                "0",
            ),
            gasCoveragePercentage: AppOptions.resolveNumericValue(
                input.gasCoveragePercentage,
                INT_PATTERN,
                "invalid gas coverage percentage, must be an integer greater than equal to 0", //
                "100",
                true,
            ),
            txGas: AppOptions.resolveNumericValue(
                input.txGas,
                /^[0-9]+%?$/,
                "invalid txGas value, must be an integer greater than zero optionally with appended percentage sign to apply as percentage to original gas", //
                undefined,
                true,
            ),
            quoteGas: BigInt(
                AppOptions.resolveNumericValue(
                    input.quoteGas,
                    INT_PATTERN,
                    "invalid quoteGas value, must be an integer greater than equal to 0",
                    "1000000",
                    true,
                ),
            ),
            botMinBalance: AppOptions.resolveNumericValue(
                input.botMinBalance,
                FLOAT_PATTERN,
                "invalid bot min balance, it should be an number greater than equal to 0",
                undefined,
                true,
                (botMinBalance) =>
                    assert(
                        typeof botMinBalance !== "undefined",
                        "invalid bot min balance, it should be an number greater than equal to 0",
                    ),
            ),
            gasPriceMultiplier: AppOptions.resolveNumericValue(
                input.gasPriceMultiplier,
                INT_PATTERN,
                "invalid gasPriceMultiplier value, must be an integer greater than 0",
                "107",
                undefined,
                (gasPriceMultiplier) =>
                    assert(
                        gasPriceMultiplier > 0,
                        "invalid gasPriceMultiplier value, must be an integer greater than 0",
                    ),
            ),
            gasLimitMultiplier: AppOptions.resolveNumericValue(
                input.gasLimitMultiplier,
                INT_PATTERN,
                "invalid gasLimitMultiplier value, must be an integer greater than 0",
                "100",
                undefined,
                (gasLimitMultiplier) =>
                    assert(
                        gasLimitMultiplier > 0,
                        "invalid gasLimitMultiplier value, must be an integer greater than 0",
                    ),
            ),
            timeout: AppOptions.resolveNumericValue(
                input.timeout,
                INT_PATTERN,
                "invalid timeout, must be an integer greater than 0",
                "15000",
                undefined,
                (timeout) =>
                    assert(timeout > 0, "invalid timeout, must be an integer greater than 0"),
            ),
            hops: AppOptions.resolveNumericValue(
                input.hops,
                INT_PATTERN,
                "invalid hops value, must be an integer greater than 0",
                "1",
                undefined,
                (hops) => assert(hops > 0, "invalid hops value, must be an integer greater than 0"),
            ),
            retries: AppOptions.resolveNumericValue(
                input.retries,
                INT_PATTERN,
                "invalid retries value, must be an integer between 1 - 3",
                "1",
                undefined,
                (retries) =>
                    assert(
                        retries >= 1 && retries <= 3,
                        "invalid retries value, must be an integer between 1 - 3",
                    ),
            ),
        } as AppOptions;
    }

    /** Resolves config's wallet key */
    export function resolveWalletKey(input: any) {
        const key = readValue(input.key).value;
        const mnemonic = readValue(input.mnemonic).value;
        let walletCount = readValue(input.walletCount).value;
        const topupAmount = readValue(input.topupAmount).value;
        if ((!key && !mnemonic) || (key && mnemonic)) {
            throw "only one of key or mnemonic should be specified";
        }
        if (mnemonic) {
            if (!walletCount || !topupAmount) {
                throw "walletCount and topupAmount are required when using mnemonic key";
            }
            assert(
                INT_PATTERN.test(walletCount),
                "invalid walletCount, it should be an integer greater than equal to 0",
            );
            walletCount = Number(walletCount);
            assert(
                FLOAT_PATTERN.test(topupAmount),
                "invalid topupAmount, it should be a number greater than equal to 0",
            );
        }
        if (key) {
            assert(HASH_PATTERN.test(key), "invalid wallet private key");
        }
        return {
            key,
            mnemonic,
            walletCount,
            topupAmount,
        };
    }

    /** Resolves config's urls */
    export function resolveUrls<isOptional extends boolean = false>(
        input: any,
        exception: string,
        isOptional = false as isOptional,
    ): isOptional extends false ? string[] : string[] | undefined {
        const urls = readValue(input);
        if (urls.isEnv) {
            urls.value = tryIntoArray(urls.value);
        }
        if (isOptional && urls.value === undefined) return undefined as any;
        assert(
            urls.value &&
                Array.isArray(urls.value) &&
                urls.value.length > 0 &&
                urls.value.every((v: any) => typeof v === "string"),
            exception,
        );
        return urls.value as any;
    }

    /** Resolves config's list of liquidity providers */
    export function resolveLiquidityProviders(input: any) {
        const lps = readValue(input);
        if (lps.isEnv) {
            lps.value = tryIntoArray(lps.value);
        }
        if (!lps.value) return undefined;
        assert(
            lps.value &&
                Array.isArray(lps.value) &&
                lps.value.length > 0 &&
                lps.value.every((v: any) => typeof v === "string"),
            "expected array of liquidity providers",
        );
        return lps.value;
    }

    /** Resolves config's boolean value */
    export function resolveBool(input: any, exception: string, fallback = false) {
        const bool = readValue(input);
        if (typeof bool.value === "undefined") {
            bool.value = fallback.toString();
        }
        if (bool.isEnv) {
            assert(
                typeof bool.value === "string" && (bool.value === "true" || bool.value === "false"),
                exception,
            );
        }
        if (typeof bool.value === "string") {
            bool.value = bool.value === "true";
        }
        assert(typeof bool.value === "boolean", exception);
        return bool.value;
    }

    /** Resolves config's address */
    export function resolveAddress<isOptional extends boolean = false>(
        input: any,
        addressName: string,
        isOptional = false as isOptional,
    ): isOptional extends false ? string : string | undefined {
        const address = readValue(input).value;
        if (isOptional && address === undefined) return undefined as any;
        assert(
            typeof address === "string" && ethers.utils.isAddress(address),
            `expected valid ${addressName} contract address`,
        );
        return address.toLowerCase() as any;
    }

    /** Resolves config's numeric value */
    export function resolveNumericValue<
        fallback extends string | undefined = undefined,
        returnAsString extends boolean | undefined = false,
    >(
        input: any,
        pattern: RegExp,
        exception: string,
        fallback?: fallback,
        returnAsString = false as returnAsString,
        callback?: (value: any) => void,
    ): fallback extends string
        ? returnAsString extends true
            ? string
            : number
        : (returnAsString extends true ? string : number) | undefined {
        const value = readValue(input).value || fallback;
        if (typeof value === "undefined") {
            callback?.(value);
            return undefined as any;
        } else {
            assert(typeof value === "string", exception);
            assert(pattern.test(value), exception);
            if (returnAsString) {
                callback?.(value);
                return value as any;
            } else {
                const _value = Number(value);
                callback?.(_value);
                return _value as any;
            }
        }
    }

    /** Resolves config's route type */
    export function resolveRouteType(input: any) {
        const route = (readValue(input).value || "single")?.toLowerCase();
        assert(
            typeof route === "string" &&
                (route === "full" || route === "single" || route === "multi"),
            "expected either of full, single or multi",
        );
        if (route === "full") return undefined;
        else return route;
    }

    /** Resolves config's owner profiles */
    export function resolveOwnerProfile(input: any) {
        const ownerProfile = readValue(input);
        const profiles: Record<string, number> = {};
        const validate = (owner: string, limit: string) => {
            assert(ethers.utils.isAddress(owner), `Invalid owner address: ${owner}`);
            assert(
                (INT_PATTERN.test(limit) && Number(limit) > 0) || limit === "max",
                "Invalid owner profile limit, must be an integer gte 0 or 'max' for no limit",
            );
            if (limit === "max") {
                profiles[owner.toLowerCase()] = Number.MAX_SAFE_INTEGER;
            } else {
                profiles[owner.toLowerCase()] = Math.min(Number(limit), Number.MAX_SAFE_INTEGER);
            }
        };
        if (ownerProfile.isEnv) {
            if (typeof ownerProfile.value === "undefined") return;
            ownerProfile.value = tryIntoArray(ownerProfile.value);
            assert(
                Array.isArray(ownerProfile.value) &&
                    ownerProfile.value.every((v: any) => typeof v === "string"),
                "expected array of owner limits in k/v format, example: OWNER=LIMIT",
            );
            ownerProfile.value.forEach((kv: string) => {
                const [owner = undefined, limit = undefined, ...rest] = kv.split("=");
                assert(
                    typeof owner === "string" && typeof limit === "string" && rest.length === 0,
                    "Invalid owner profile, must be in form of 'ownerAddress=limitValue'",
                );
                validate(owner, limit);
            });
        } else if (input) {
            assert(
                Array.isArray(input),
                "expected array of owner limits in k/v format, example: - OWNER: LIMIT",
            );
            input.forEach((ownerProfile) => {
                const kv = Object.entries(ownerProfile);
                assert(kv.length === 1, "Invalid owner profile, must be in form of 'OWNER: LIMIT'");
                kv.forEach(([owner, limit]: [string, any]) => {
                    validate(owner, limit);
                });
            });
        }
        return Object.keys(profiles).length ? profiles : undefined;
    }

    /** Resolves config's bot self funding orders/vaults */
    export function resolveSelfFundOrders(input: any) {
        const selfFundOrders = readValue(input);
        const validate = (details: any) => {
            const {
                token = undefined,
                vaultId = undefined,
                threshold = undefined,
                topupAmount = undefined,
            } = details;
            assert(token && ethers.utils.isAddress(token), "invalid token address");
            assert(vaultId && isBigNumberish(vaultId), "invalid vault id");
            assert(
                threshold && FLOAT_PATTERN.test(threshold),
                "expected a number greater than equal to 0 for threshold",
            );
            assert(
                topupAmount && FLOAT_PATTERN.test(topupAmount),
                "expected a number greater than equal to 0 for topupAmount",
            );
            return true;
        };
        if (selfFundOrders.isEnv) {
            if (typeof selfFundOrders.value === "undefined") return;
            selfFundOrders.value = tryIntoArray(selfFundOrders.value);
            assert(
                Array.isArray(selfFundOrders.value) &&
                    selfFundOrders.value.every((v: any) => typeof v === "string"),
                "expected array of vault funding details in key=value, example: token=0xabc...123,vaultId=0x123...456,threshold=0.5,topupAmount=10",
            );

            // build  array of SelfFundOrder from the inputs
            const result: Record<string, any>[] = [];
            for (const item of selfFundOrders.value) {
                // should contain known keys
                assert(
                    item.startsWith("token=") ||
                        item.startsWith("vaultId=") ||
                        item.startsWith("threshold=") ||
                        item.startsWith("topupAmount="),
                    `unknown key/value: ${item}`,
                );

                // insert empty next
                if (!result.length || Object.keys(result[result.length - 1]).length === 4) {
                    result.push({});
                }

                const [key, value, ...rest]: string[] = item.split("=");
                assert(value, `expected value after ${key}=`);
                assert(rest.length === 0, `unexpected arguments: ${rest}`);
                assert(!(key in result[result.length - 1]), `duplicate ${key}`);

                result[result.length - 1][key as keyof SelfFundOrder] = value;
            }

            // validate built array values
            assert(result.every(validate), "expected array of SelfFundOrder");

            return result as SelfFundOrder[];
        } else if (input) {
            assert(
                Array.isArray(input) && input.every(validate),
                "expected array of SelfFundOrder",
            );
            return input as SelfFundOrder[];
        }
    }

    /** Resolves config's order filters */
    export function resolveSgFilters(input: any) {
        const sgFilter: any = {
            includeOrders: readValue(input?.includeOrders),
            excludeOrders: readValue(input?.excludeOrders),
            includeOwners: readValue(input?.includeOwners),
            excludeOwners: readValue(input?.excludeOwners),
            includeOrderbooks: readValue(input?.includeOrderbooks),
            excludeOrderbooks: readValue(input?.excludeOrderbooks),
        };
        const validate = (
            field: string,
            exceptionMsg: string,
            validator: (value?: unknown) => string,
        ) => {
            if (sgFilter[field].isEnv) {
                const list = tryIntoArray(sgFilter[field].value);
                if (list) {
                    sgFilter[field] = new Set(list.map(validator));
                } else {
                    sgFilter[field] = undefined;
                }
            } else if (sgFilter[field].value) {
                assert(Array.isArray(sgFilter[field].value), exceptionMsg);
                sgFilter[field] = new Set(sgFilter[field].value.map(validator));
            } else {
                sgFilter[field] = undefined;
            }
        };

        // validate inc/exc orders
        validate("includeOrders", "expected an array of orderhashes", validateHash);
        validate("excludeOrders", "expected an array of orderhashes", validateHash);

        // validate inc/exc owners
        validate("includeOwners", "expected an array of owner addresses", validateAddress);
        validate("excludeOwners", "expected an array of owner addresses", validateAddress);

        // validate inc/exc orderbooks
        validate("includeOrderbooks", "expected an array of orderbook addresses", validateAddress);
        validate("excludeOrderbooks", "expected an array of orderbook addresses", validateAddress);

        // include if any of the fields are set
        if (Object.values(sgFilter).some((v) => typeof v !== "undefined")) {
            return sgFilter as SgFilter;
        } else {
            return undefined;
        }
    }
}

/**
 * Reads the env value if the given input points to
 * an envvariable, else returns the value unchanged
 */
export function readValue(value: any) {
    const result = { isEnv: false, value };
    if (typeof value === "string" && value.startsWith("$")) {
        result.isEnv = true;
        const env = process.env[value.slice(1)];
        if (
            env !== undefined &&
            env !== null &&
            typeof env === "string" &&
            env !== "" &&
            !/^\s*$/.test(env)
        ) {
            result.value = env;
        } else {
            result.value = undefined;
        }
        return result;
    }
    return { isEnv: false, value };
}

/**
 * Tries to parse the given string into an array of strings where items are separated by a comma
 */
export function tryIntoArray(value?: string): string[] | undefined {
    return value ? Array.from(value.matchAll(/[^,\s]+/g)).map((v) => v[0]) : undefined;
}

/**
 * Validates if the given input is an address
 */
export function validateAddress(value?: unknown): string {
    if (typeof value !== "string") throw "expected string";
    if (!ethers.utils.isAddress(value)) {
        throw `${value} is not a valid address`;
    }
    return value.toLowerCase();
}

/**
 * Validates if the given input is a solidity hash (32 bytes length hex string)
 */
export function validateHash(value?: unknown): string {
    if (typeof value !== "string") throw "expected string";
    if (!HASH_PATTERN.test(value)) {
        throw `${value} is not a valid hash`;
    }
    return value.toLowerCase();
}
