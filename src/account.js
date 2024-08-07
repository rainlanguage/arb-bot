const { parseAbi } = require("viem");
const { ethers } = require("ethers");
const { erc20Abi, multicall3Abi } = require("./abis");
const { getIncome, shuffleArray } = require("./utils");
const { getDataFetcher, createViemClient } = require("./config");

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
 * @returns Array of ethers Wallets derived from the given menomonic phrase and standard derivation path
 */
async function initAccounts(mnemonicOrPrivateKey, provider, topupAmount, viemClient, count = 0) {
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
    mainAccount.BOUNTY = [];
    mainAccount.BALANCE = balances[0];

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
                accounts[i].BOUNTY = [];
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
                        await tx.wait(6);
                        accounts[i].BALANCE = topupAmountBn;
                        mainAccount.BALANCE = mainAccount.BALANCE.sub(transferAmount);
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
 */
async function manageAccounts(mnemonic, mainAccount, accounts, provider, lastIndex, avgGasCost) {
    let accountsToAdd = 0;
    let gasLimit;
    const gasPrice = await mainAccount.getGasPrice();
    for (let i = accounts.length - 1; i >= 0; i--) {
        if (accounts[i].BALANCE.lt(avgGasCost.mul(2))) {
            try {
                if (!gasLimit) {
                    gasLimit = await accounts[i].estimateGas({
                        to: mainAccount.address,
                        value: "0",
                        gasPrice
                    });
                }
                const transferAmount = accounts[i].BALANCE.sub(
                    gasPrice.mul(gasLimit).mul(101).div(100)
                );
                const tx = await accounts[i].sendTransaction({
                    to: mainAccount.address,
                    value: transferAmount,
                    gasPrice,
                    gasLimit
                });
                await tx.wait();
                mainAccount.BALANCE = mainAccount.BALANCE.add(transferAmount);
                accounts[i].BALANCE = ethers.constants.Zero;
            } catch {
                /**/
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
            if (avgGasCost.mul(11).gt(balance)) {
                const transferAmount = avgGasCost.mul(11).sub(balance);
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
                    await tx.wait(6);
                    acc.BALANCE = avgGasCost.mul(11);
                    mainAccount.BALANCE = mainAccount.BALANCE.sub(transferAmount);
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

module.exports = {
    BasePath,
    MainAccountDerivationIndex,
    initAccounts,
    withdrawBounty,
    manageAccounts,
    getBatchEthBalance,
    getBatchTokenBalanceForAccount,
    rotateAccounts,
    rotateProviders
};