const { parseAbi } = require("viem");
const { ethers } = require("ethers");
const { Native } = require("sushi/currency");
const { ROUTE_PROCESSOR_4_ADDRESS } = require("sushi/config");
const { getIncome, shuffleArray, getRpSwap, sleep } = require("./utils");
const { getDataFetcher, createViemClient } = require("./config");
const { erc20Abi, multicall3Abi, routeProcessor3Abi } = require("./abis");

/** Standard base path for eth accounts */
const BasePath = "m/44'/60'/0'/0/";

/** Main account derivation index */
const MainAccountDerivationIndex = 0;

/**
 * Generates array of accounts from mnemonic phrase and tops them up from main acount
 * @param {string} mnemonicOrPrivateKey - The mnemonic phrase or private key
 * @param {ethers.providers.Provider} provider - The ethers provider
 * @param {string} topupAmount - The top up amount
 * @param {import("viem").PublicClient} viemClient - The viem client
 * @param {number} count - Number of accounts to create
 * @param {any[]} watchedTokens - Array of bounty tokens that are being tracked for sweeping purpose
 * @returns Array of ethers Wallets derived from the given menomonic phrase and standard derivation path
 */
async function initAccounts(
    mnemonicOrPrivateKey,
    provider,
    topupAmount,
    viemClient,
    count = 0,
    watchedTokens = []
) {
    const accounts = [];
    const isMnemonic = !/^(0x)?[a-fA-F0-9]{64}$/.test(mnemonicOrPrivateKey);
    const mainAccount = isMnemonic
        ? ethers.Wallet
            .fromMnemonic(mnemonicOrPrivateKey, BasePath + MainAccountDerivationIndex)
            .connect(provider)
        : new ethers.Wallet(mnemonicOrPrivateKey, provider);

    // if the provided key is mnemonic, generate new accounts
    if (isMnemonic) {
        for (let derivationIndex = 1; derivationIndex <= count; derivationIndex++) {
            accounts.push(
                ethers.Wallet
                    .fromMnemonic(mnemonicOrPrivateKey, BasePath + derivationIndex)
                    .connect(provider)
            );
        }
    }

    // reaed current eth balances of the accounts, this will be
    // tracked on through the bot's process whenever a tx is submitted
    const balances = await getBatchEthBalance(
        [mainAccount.address, ...accounts.map(v => v.address)],
        viemClient
    );
    mainAccount.BALANCE = balances[0];
    await setWatchedTokens(mainAccount, watchedTokens, viemClient);

    // incase of excess accounts, top them up from main account
    if (accounts.length) {
        const topupAmountBn = ethers.utils.parseUnits(topupAmount);
        let cumulativeTopupAmount = ethers.constants.Zero;
        for (let i = 1; i < balances.length; i++) {
            if (topupAmountBn.gt(balances[i])) {
                cumulativeTopupAmount = cumulativeTopupAmount.add(
                    topupAmountBn.sub(balances[i])
                );
            }
        }
        if (cumulativeTopupAmount.gt(balances[0])) {
            throw "low on funds to topup excess wallets with specified initial topup amount";
        } else {
            const gasPrice = ethers.BigNumber.from(await viemClient.getGasPrice());
            for (let i = 0; i < accounts.length; i++) {
                await setWatchedTokens(accounts[i], watchedTokens, viemClient);
                accounts[i].BALANCE = balances[i + 1];

                // only topup those accounts that have lower than expected funds
                const transferAmount = topupAmountBn.sub(balances[i + 1]);
                if (transferAmount.gt(0)) {
                    try {
                        const tx = await mainAccount.sendTransaction({
                            to: accounts[i].address,
                            value: transferAmount,
                            gasPrice,
                        });
                        try {
                            const receipt = await tx.wait(4);
                            const txCost = ethers.BigNumber
                                .from(receipt.effectiveGasPrice)
                                .mul(receipt.gasUsed);
                            accounts[i].BALANCE = topupAmountBn;
                            mainAccount.BALANCE = mainAccount.BALANCE
                                .sub(transferAmount)
                                .sub(txCost);
                        } catch (e) {
                            const txCost = ethers.BigNumber
                                .from(e.receipt.effectiveGasPrice)
                                .mul(e.receipt.gasUsed);
                            mainAccount.BALANCE = mainAccount.BALANCE.sub(txCost);
                            const prefixMsg = "failed to topup wallets, ";
                            if (e instanceof Error) {
                                if (e.reason) {
                                    if (e?.error?.message) {
                                        e.reason = prefixMsg + e.error.message + ", " + e.reason;
                                    } else {
                                        e.reason = prefixMsg + e.reason ;
                                    }
                                } else {
                                    e.message = prefixMsg + e.message;
                                }
                            } else if (typeof e === "string") {
                                return Promise.reject(prefixMsg + e);
                            }
                            return Promise.reject(e);
                        }
                    } catch (e) {
                        const prefixMsg = "failed to topup wallets, ";
                        if (e instanceof Error) {
                            if (e.reason) {
                                if (e?.error?.message) {
                                    e.reason = prefixMsg + e.error.message + ", " + e.reason;
                                } else {
                                    e.reason = prefixMsg + e.reason ;
                                }
                            } else {
                                e.message = prefixMsg + e.message;
                            }
                        } else if (typeof e === "string") {
                            return Promise.reject(prefixMsg + e);
                        }
                        return Promise.reject(e);
                    }
                }
            }
        }
    }
    return { mainAccount, accounts };
}

/**
 * Manages accounts by removing the ones that are out of gas from circulation
 * and replaces them with new ones while topping them up with x11 of avg gas cost
 * of the arb() transactions, returns the last index used for new wallets.
 * @param {string} mnemonic - The mnemonic phrase
 * @param {ethers.Wallet} mainAccount - Other wallets
 * @param {ethers.Wallet[]} accounts - Other wallets
 * @param {ethers.providers.Provider} provider - The ethers provider
 * @param {number} lastIndex - The last index used for wallets
 * @param {ethers.BigNumber} avgGasCost - Avg gas cost of arb txs
 * @param {import("viem").PublicClient} viemClient - The viem client
 * @param {any[]} wgc - wallets garbage collection
 * @param {any[]} watchedTokens - Array of bounty tokens that are being tracked for sweeping purpose
 */
async function manageAccounts(
    mnemonic,
    mainAccount,
    accounts,
    provider,
    lastIndex,
    avgGasCost,
    viemClient,
    wgc,
    watchedTokens = [],
) {
    let accountsToAdd = 0;
    const gasPrice = await mainAccount.getGasPrice();
    for (let i = accounts.length - 1; i >= 0; i--) {
        if (accounts[i].BALANCE.lt(avgGasCost.mul(15))) {
            try {
                await sweepToMainWallet(
                    accounts[i],
                    mainAccount,
                    gasPrice,
                    viemClient
                );
            } catch { /**/ }
            // keep in garbage if there are tokens left to sweep
            if (accounts[i].BOUNTY.length && !wgc.find(
                v => v.address.toLowerCase() === accounts[i].address.toLowerCase()
            )) {
                wgc.unshift(accounts[i]);
            }
            accountsToAdd++;
            accounts.splice(i, 1);
        }
    }
    if (accountsToAdd > 0) {
        for (let i = 0; i < accountsToAdd; i++) {
            const acc = ethers.Wallet.fromMnemonic(mnemonic, BasePath + (++lastIndex))
                .connect(provider);
            const balance = await acc.getBalance();
            acc.BALANCE = balance;
            await setWatchedTokens(acc, watchedTokens, viemClient);

            if (avgGasCost.mul(43).gt(balance)) {
                const transferAmount = avgGasCost.mul(43).sub(balance);
                if (mainAccount.BALANCE.lt(transferAmount)) {
                    throw `main account lacks suffecient funds to topup wallets, current balance: ${
                        ethers.utils.formatUnits(mainAccount.BALANCE)
                    }`;
                }
                try {
                    const tx = await mainAccount.sendTransaction({
                        to: acc.address,
                        value: transferAmount,
                        gasPrice
                    });
                    let txCost = ethers.constants.Zero;
                    try {
                        const receipt = await tx.wait(4);
                        acc.BALANCE = avgGasCost.mul(43);
                        txCost = ethers.BigNumber
                            .from(receipt.effectiveGasPrice)
                            .mul(receipt.gasUsed);
                        mainAccount.BALANCE = mainAccount.BALANCE.sub(transferAmount).sub(txCost);
                    } catch (e) {
                        txCost = ethers.BigNumber
                            .from(e.receipt.effectiveGasPrice)
                            .mul(e.receipt.gasUsed);
                        mainAccount.BALANCE = mainAccount.BALANCE.sub(txCost);
                    }
                } catch {
                    /**/
                }
            }
            accounts.push(acc);
        }
    }
    return lastIndex;
}

/**
 * Rotates the providers rpcs for viem and ethers clients
 * @param {any} config - The config object
 */
function rotateProviders(config) {
    if (config.rpc?.length > 1) {
        shuffleArray(config.rpc);
        const allProviders = config.rpc.map(v => new ethers.providers.JsonRpcProvider(v));
        const provider = new ethers.providers.FallbackProvider(allProviders);
        const viemClient = createViemClient(config.chain.id, config.rpc, false);
        const dataFetcher = getDataFetcher(viemClient, config.lps, false);

        config.provider = provider;
        config.viemClient = viemClient;
        config.dataFetcher = dataFetcher;

        // rotate main account's provider
        const mainAccBalance = config.mainAccount.BALANCE;
        const mainAccBounty = config.mainAccount.BOUNTY;
        const mainAcc = config.mainAccount.connect(provider);
        mainAcc.BALANCE = mainAccBalance;
        mainAcc.BOUNTY = mainAccBounty;
        config.mainAccount = mainAcc;

        // rotate other accounts' provider
        for (let i = 0; i < config.accounts.length; i++) {
            const balance = config.accounts[i].BALANCE;
            const bounty = config.accounts[i].BOUNTY;
            const acc = config.accounts[i].connect(provider);
            acc.BALANCE = balance;
            acc.BOUNTY = bounty;
            config.accounts[i] = acc;
        }
    }
}

/**
 * Rotates accounts by putting the first one in last place
 * @param {ethers.Wallet[]} accounts - Array of accounts to rotate
 */
function rotateAccounts(accounts) {
    if (accounts && Array.isArray(accounts) && accounts.length > 1) {
        accounts.push(accounts.shift());
    }
}

/**
 * Withdraws bot's bounty to another account
 * @param {ethers.Wallet} from - The from wallet
 * @param {ethers.Wallet} to - The to wallet
 * @param {ethers.Contract} token - The token ethers contract
 * @param {any} receipt - The arb tx receipt,
 * @param {import("viem").PublicClient} viemClient - The viem client
 */
async function withdrawBounty(from, to, token, receipt, viemClient) {
    if (from.address.toLowerCase() === to.address.toLowerCase()) return;

    let amount = getIncome(from.address, receipt, token.address);
    if (!amount) {
        amount = ethers.BigNumber.from((await viemClient.call({
            to: token.address,
            data: token.interface.encodeFunctionData("balanceOf", [from.address])
        })).data);
    }
    const tx = await token.connect(from).transfer(to.address, amount);
    await tx.wait(2);
}

/**
 * Get eth balance of multiple accounts using multicall
 * @param {string[]} addresses - The addresses to get their balance
 * @param {import("viem").PublicClient} viemClient - The viem client
 * @param {string} multicallAddressOverride - Override multicall3 address
 */
async function getBatchEthBalance(addresses, viemClient, multicallAddressOverride) {
    return (await viemClient.multicall({
        multicallAddress:
                viemClient.chain?.contracts?.multicall3?.address ?? multicallAddressOverride,
        allowFailure: false,
        contracts: addresses.map(v => ({
            address: viemClient.chain?.contracts?.multicall3?.address ?? multicallAddressOverride,
            allowFailure: false,
            chainId: viemClient.chain.id,
            abi: parseAbi(multicall3Abi),
            functionName: "getEthBalance",
            args: [v]
        })),
    })).map(v => ethers.BigNumber.from(v));
}

/**
 * Get balance of multiple erc20 tokens for an account using multicall3
 * @param {string} address - The address to get its token balances
 * @param {string[]} tokens - The token addresses to get their balance
 * @param {import("viem").PublicClient} viemClient - The viem client
 * @param {string} multicallAddressOverride - Override multicall3 address
 */
async function getBatchTokenBalanceForAccount(
    address,
    tokens,
    viemClient,
    multicallAddressOverride
) {
    return (await viemClient.multicall({
        multicallAddress:
                viemClient.chain?.contracts?.multicall3?.address ?? multicallAddressOverride,
        allowFailure: false,
        contracts: tokens.map(v => ({
            address: v,
            allowFailure: false,
            chainId: viemClient.chain.id,
            abi: parseAbi(erc20Abi),
            functionName: "balanceOf",
            args: [address]
        })),
    })).map(v => ethers.BigNumber.from(v));
}

/**
 * Sweep bot's bounties
 * @param {ethers.Wallet} fromWallet - The from wallet
 * @param {ethers.Wallet} toWallet - The to wallet
 * @param {ethers.BigNumber} gasPrice - Gas price
 * @param {import("viem").PublicClient} viemClient - The viem client
 */
async function sweepToMainWallet(fromWallet, toWallet, gasPrice, viemClient) {
    const erc20 = new ethers.utils.Interface(erc20Abi);
    const txs = [];
    const failedBounties = [];
    let cumulativeGasLimit = ethers.constants.Zero;
    for (let i = 0; i < fromWallet.BOUNTY.length; i++) {
        const bounty = fromWallet.BOUNTY[i];
        try {
            const balance = ethers.BigNumber.from((await viemClient.call({
                to: bounty.address,
                data: erc20.encodeFunctionData("balanceOf", [fromWallet.address])
            })).data);
            const tx = {
                to: bounty.address,
                data: erc20.encodeFunctionData("transfer", [toWallet.address, balance]),
                gasPrice
            };
            const gasLimit = await fromWallet.estimateGas(tx);
            tx.gasLimit = gasLimit.mul(105).div(100);
            txs.push({ tx, bounty });
            cumulativeGasLimit = cumulativeGasLimit.add(gasLimit.mul(105).div(100));
        } catch {
            failedBounties.push(bounty);
        }
    }

    if (cumulativeGasLimit.mul(gasPrice).gt(fromWallet.BALANCE)) {
        try {
            const transferAmount = cumulativeGasLimit.mul(gasPrice).sub(fromWallet.BALANCE);
            const gasTransferTx = await toWallet.sendTransaction({
                to: fromWallet.address,
                value: transferAmount,
                gasPrice,
            });
            try {
                const receipt = await gasTransferTx.wait(2);
                const txGasCost = ethers.BigNumber
                    .from(receipt.effectiveGasPrice)
                    .mul(receipt.gasUsed);
                fromWallet.BALANCE = fromWallet.BALANCE.add(transferAmount);
                toWallet.BALANCE = toWallet.BALANCE.sub(transferAmount).sub(txGasCost);
            } catch (e) {
                const txGasCost = ethers.BigNumber
                    .from(e.receipt.effectiveGasPrice)
                    .mul(e.receipt.gasUsed);
                toWallet.BALANCE = toWallet.BALANCE.sub(txGasCost);
            }
        } catch { /**/ }
    }

    for (let i = 0; i < txs.length; i++) {
        try {
            const tx = await fromWallet.sendTransaction(txs[i].tx);
            let txGasCost = ethers.BigNumber.from(0);
            try {
                const receipt = await tx.wait(2);
                txGasCost = ethers.BigNumber
                    .from(receipt.effectiveGasPrice)
                    .mul(receipt.gasUsed);
                if (!toWallet.BOUNTY.find(v => v.address === txs[i].bounty.address)) {
                    toWallet.BOUNTY.push(txs[i].bounty);
                }
            } catch (e) {
                failedBounties.push(txs[i].bounty);
                txGasCost = ethers.BigNumber
                    .from(e.receipt.effectiveGasPrice)
                    .mul(e.receipt.gasUsed);
            }
            fromWallet.BALANCE = fromWallet.BALANCE.sub(txGasCost);
        } catch (error) {
            failedBounties.push(txs[i].bounty);
        }
    }

    // empty gas if all tokens are swept
    if (!failedBounties.length) {
        try {
            const gasLimit = await fromWallet.estimateGas({
                to: toWallet.address,
                value: "0",
                gasPrice
            });
            const remainingGas = await fromWallet.getBalance();
            const transferAmount = remainingGas.sub(gasLimit.mul(gasPrice));
            if (transferAmount.gt(0)) {
                const remainingGasTransferTx = await fromWallet.sendTransaction({
                    to: toWallet.address,
                    value: transferAmount,
                    gasPrice,
                    gasLimit,
                });
                try {
                    const receipt = await remainingGasTransferTx.wait(2);
                    const txGasCost = ethers.BigNumber
                        .from(receipt.effectiveGasPrice)
                        .mul(receipt.gasUsed);
                    toWallet.BALANCE = toWallet.BALANCE.add(transferAmount);
                    fromWallet.BALANCE = fromWallet.BALANCE.sub(txGasCost).sub(transferAmount);
                } catch (e) {
                    const txGasCost = ethers.BigNumber
                        .from(e.receipt.effectiveGasPrice)
                        .mul(e.receipt.gasUsed);
                    fromWallet.BALANCE = fromWallet.BALANCE.sub(txGasCost);
                }
            }
        } catch {
            /**/
        }
    }
    fromWallet.BOUNTY = failedBounties;
}

/**
 * Sweep bot's bounties to eth
 * @param {*} config - The config obj
 */
async function sweepToEth(config) {
    const skipped = [];
    const rp4Address = ROUTE_PROCESSOR_4_ADDRESS[config.chain.id];
    const rp = new ethers.utils.Interface(routeProcessor3Abi);
    const erc20 = new ethers.utils.Interface(erc20Abi);
    const gasPrice = await config.mainAccount.getGasPrice();
    for (let i = 0; i < config.mainAccount.BOUNTY.length; i++) {
        const bounty = config.mainAccount.BOUNTY[i];
        try {
            const balance = ethers.BigNumber.from((await config.viemClient.call({
                to: bounty.address,
                data: erc20.encodeFunctionData("balanceOf", [config.mainAccount.address])
            })).data);
            if (balance.isZero()) {
                continue;
            }
            const { rpParams } = await getRpSwap(
                config.chain.id,
                balance,
                bounty,
                Native.onChain(config.chain.id),
                config.mainAccount.address,
                rp4Address,
                config.dataFetcher,
                gasPrice
            );
            const amountOutMin = ethers.BigNumber.from(rpParams.amountOutMin);
            const data = rp.encodeFunctionData(
                "processRoute",
                [
                    rpParams.tokenIn,
                    rpParams.amountIn,
                    rpParams.tokenOut,
                    rpParams.amountOutMin,
                    rpParams.to,
                    rpParams.routeCode
                ]
            );
            const allowance = ethers.BigNumber.from((await config.viemClient.call({
                to: bounty.address,
                data: erc20.encodeFunctionData(
                    "allowance",
                    [config.mainAccount.address, rp4Address]
                )
            })).data);
            if (allowance.lt(balance)) {
                const approveTx = await config.mainAccount.sendTransaction({
                    to: bounty.address,
                    data: erc20.encodeFunctionData("approve", [rp4Address, balance])
                });
                await approveTx.wait(2);
            }
            const rawtx = { to: rp4Address, data };
            const gasLimit = await config.mainAccount.estimateGas(rawtx);
            const gasCost = gasPrice.mul(gasLimit.mul(15).div(10));
            if (gasCost.mul(2).gte(amountOutMin)) {
                skipped.push(bounty);
                continue;
            } else {
                rawtx.gasPrice = gasPrice;
                rawtx.gasLimit = gasLimit.mul(15).div(10);
                const tx = await config.mainAccount.sendTransaction(rawtx);
                await tx.wait(2);
            }
        } catch(e) {
            skipped.push(bounty);
        }
        await sleep(10000);
    }
    config.mainAccount.BOUNTY = skipped;
    for (let i = 0; i < 20; i++) {
        try {
            config.mainAccount.BALANCE = await config.mainAccount.getBalance();
            return;
        } catch {
            if (i != 19) await sleep(10000 * (i + 1));
        }
    }
}

async function setWatchedTokens(account, watchedTokens, viemClient) {
    account.BOUNTY = [];
    try {
        if (watchedTokens?.length) {
            account.BOUNTY = (await getBatchTokenBalanceForAccount(
                account.address,
                watchedTokens,
                viemClient
            ))
                .map((v, i) => ({ balance: v, token: watchedTokens[i] }))
                .filter(v => v.balance.gt(0))
                .map(v => v.token);
        }
    } catch {
        account.BOUNTY = [];
    }
}

module.exports = {
    BasePath,
    MainAccountDerivationIndex,
    initAccounts,
    withdrawBounty,
    manageAccounts,
    getBatchEthBalance,
    getBatchTokenBalanceForAccount,
    rotateAccounts,
    rotateProviders,
    sweepToMainWallet,
    sweepToEth,
};
