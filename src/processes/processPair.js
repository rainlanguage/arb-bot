const { Token } = require("sushi/currency");
const { getEthPrice, getVaultBalance } = require("../utils");
const { attemptOppAndClear, AttemptOppAndClearHaltReason } = require("./processOpp");

/**
 * Specifies reason that order process halted
 */
const ProcessPairHaltReason = {
    NoWalletFund: 1,
    EmptyVault: 2,
    FailedToGetVaultBalance: 3,
    FailedToGetGasPrice: 4,
    FailedToGetEthPrice: 5,
    FailedToGetPools: 6,
};

/**
 * Processes an pair order by trying to clear it against an onchain liquidity and reporting the result
 */
async function processPair({
    config,
    orderPairObject,
    viemClient,
    dataFetcher,
    signer,
    flashbotSigner,
    arb,
    orderbook,
    pair,
}) {
    const sharedSpanAttributes = {};
    const result = {
        reports: [],
        reason: undefined,
        error: undefined,
        sharedSpanAttributes,
    };

    sharedSpanAttributes["details.pair"] = pair;
    sharedSpanAttributes["details.output"] = orderPairObject.sellToken;
    sharedSpanAttributes["details.input"] = orderPairObject.buyToken;

    const fromToken = new Token({
        chainId: config.chain.id,
        decimals: orderPairObject.sellTokenDecimals,
        address: orderPairObject.sellToken,
        symbol: orderPairObject.sellTokenSymbol
    });
    const toToken = new Token({
        chainId: config.chain.id,
        decimals: orderPairObject.buyTokenDecimals,
        address: orderPairObject.buyToken,
        symbol: orderPairObject.buyTokenSymbol
    });

    // get vault balance
    try {
        await getVaultBalance(
            orderPairObject,
            orderbook.address,
            // if on test, use test hardhat viem client
            config.isTest ? config.testViemClient : viemClient,
            config.isTest ? "0xcA11bde05977b3631167028862bE2a173976CA11" : undefined
        );
        const filteredOrdersIds = [];
        orderPairObject.takeOrders = orderPairObject.takeOrders.filter(
            v => {
                if (v.vaultBalance.eq(0)) {
                    filteredOrdersIds.push(v.id);
                    return false;
                }
                else return true;
            }
        );
        // reject early if all orders have empty vault
        if (!orderPairObject.takeOrders.length) {
            sharedSpanAttributes["details.orders"] = filteredOrdersIds;
            result.reason = ProcessPairHaltReason.EmptyVault;
            return Promise.reject(result);
        }
    } catch(e) {
        sharedSpanAttributes["details.orders"] = orderPairObject.takeOrders.map(v => v.id);
        result.reason = ProcessPairHaltReason.FailedToGetVaultBalance;
        result.error = e;
        throw result;
    }

    // get gas price
    let gasPrice;
    try {
        gasPrice = await signer.provider.getGasPrice();
        sharedSpanAttributes["details.gasPrice"] = gasPrice.toString();
    } catch(e) {
        sharedSpanAttributes["details.orders"] = orderPairObject.takeOrders.map(v => v.id);
        result.reason = ProcessPairHaltReason.FailedToGetGasPrice;
        result.error = e;
        throw result;
    }

    // get eth price
    let ethPrice;
    if (config.gasCoveragePercentage !== "0") {
        try {
            const options = {
                fetchPoolsTimeout: 10000,
                memoize: true,
            };
            // pin block number for test case
            if (config.isTest && config.testBlockNumber) {
                options.blockNumber = config.testBlockNumber;
            }
            ethPrice = await getEthPrice(
                config,
                orderPairObject.buyToken,
                orderPairObject.buyTokenDecimals,
                gasPrice,
                dataFetcher,
                options
            );
            if (!ethPrice) {
                sharedSpanAttributes["details.orders"] = orderPairObject.takeOrders.map(v => v.id);
                result.reason = ProcessPairHaltReason.FailedToGetEthPrice;
                return Promise.reject(result);
            }
            else sharedSpanAttributes["details.ethPrice"] = ethPrice;
        } catch(e) {
            sharedSpanAttributes["details.orders"] = orderPairObject.takeOrders.map(v => v.id);
            result.reason = ProcessPairHaltReason.FailedToGetEthPrice;
            result.error = e;
            throw result;
        }
    }
    else ethPrice = "0";

    // get pool details
    try {
        const options = {
            fetchPoolsTimeout: 30000,
            memoize: true,
        };
        // pin block number for test case
        if (config.isTest && config.testBlockNumber) {
            options.blockNumber = config.testBlockNumber;
        }
        await dataFetcher.fetchPoolsForToken(
            fromToken,
            toToken,
            undefined,
            options
        );
    } catch(e) {
        sharedSpanAttributes["details.orders"] = orderPairObject.takeOrders.map(v => v.id);
        result.reason = ProcessPairHaltReason.FailedToGetPools;
        result.error = e;
        throw result;
    }

    const attemptsResults = await attemptOppAndClear({
        orderPairObject,
        dataFetcher,
        fromToken,
        toToken,
        signer,
        flashbotSigner,
        gasPrice,
        arb,
        orderbook,
        ethPrice,
        config,
        pair,
    });
    for (let i = 0; i < attemptsResults.length; i++) {
        const spanAttributes = {};
        spanAttributes["details.order"] = attemptsResults[i].order;
        for (attrKey in attemptsResults[i].spanAttributes) {
            spanAttributes["details." + attrKey] = attemptsResults[i].spanAttributes[attrKey];
        }

        if (attemptsResults[i].reason) {
            // collect the reports with error and reason
            result.reports.push({
                ...attemptsResults[i].report,
                spanAttributes,
                order: attemptsResults[i].order,
                error: attemptsResults[i].error,
                reason: attemptsResults[i].reason,
            });

            if (attemptsResults[i].reason === AttemptOppAndClearHaltReason.NoWalletFund) {
                // set status for the whole result as bot wallet lacks funds
                result.reason = ProcessPairHaltReason.NoWalletFund;
            }
        } else {
            // collect the reports
            result.reports.push({
                ...attemptsResults[i].report,
                spanAttributes,
                order: attemptsResults[i].order,
            });
        }
    }
    return result;
}

module.exports = {
    processPair,
    ProcessPairHaltReason,
};