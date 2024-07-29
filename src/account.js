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
    let mainAccount;
    const accounts = [];
    let isMnemonic = false;
    if (/^(0x)?[a-fA-F0-9]{64}$/.test(mnemonicOrPrivateKey)) {
        mainAccount = new ethers.Wallet(mnemonicOrPrivateKey, provider);
    } else {
        isMnemonic = true;
        mainAccount = ethers.Wallet
            .fromMnemonic(mnemonicOrPrivateKey, BasePath + MainAccountDerivationIndex)
            .connect(provider);
    }

    // if the provided key is mnemonic, generate new accounts
    if (isMnemonic) {
        for (let derivationIndex = 1; derivationIndex <= count; derivationIndex++) {
            accounts.push(
                ethers.Wallet.fromMnemonic(mnemonicOrPrivateKey, BasePath + derivationIndex)
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
            if (topupAmountBn.sub(balances[i]).gte(0)) {
                cumulativeTopupAmount = cumulativeTopupAmount.add(
                    topupAmountBn.sub(balances[i])
                );
            }
        }

        if (cumulativeTopupAmount.gt(balances[0])) {
            throw "low on funds to topup excess wallets";
        } else {
            for (let i = 0; i < accounts.length; i++) {
                accounts[i].BOUNTY = [];
                accounts[i].BALANCE = balances[i + 1];

                // only topup those accounts that have lower than expected funds
                const transferAmount = topupAmountBn.sub(balances[i + 1]);
                if (transferAmount.gte(0)) {
                    try {
                        const tx = await mainAccount.sendTransaction({
                            to: accounts[i].address,
                            value: transferAmount
                        });
                        await tx.wait();
                        accounts[i].BALANCE = topupAmountBn;
                        mainAccount.BALANCE = mainAccount.BALANCE.sub(transferAmount);
                    } catch (error) {
                        return Promise.reject(`failed to toptup wallets, reason: ${error.reason}`);
                    }
                }
            }
        }
    }
    return { mainAccount, accounts };
}

/**
 * Manages accounts by removing the ones that are out of gas from circulation
 * and replaces them with new ones while topping them up with x6 of avg gas cost
 * of the arb() transactions, returns the last index used for new wallets.
 * @param {string} mnemonic - The mnemonic phrase
 * @param {ethers.Wallet} mainAccount - Other wallets
 * @param {ethers.Wallet[]} accounts - Other wallets
 * @param {ethers.providers.Provider} provider - The ethers provider
 * @param {number} lastIndex - The last index used for wallets
 * @param {ethers.BigNumber} avgGasCost - Avg gas cost of arb txs
 */
async function manageAccounts(mnemonic, mainAccount ,accounts, provider, lastIndex, avgGasCost) {
    let accountsToAdd = 0;
    for (let i = accounts.length - 1; i >= 0; i--) {
        if (accounts[i].BALANCE.lt(avgGasCost)) {
            accountsToAdd++;
            accounts.splice(i, 1);
        }
    }
    for (let i = 0; i < accountsToAdd; i++) {
        const acc = ethers.Wallet.fromMnemonic(mnemonic, BasePath + (++lastIndex))
            .connect(provider);
        try {
            const tx = await mainAccount.sendTransaction({
                to: acc.address,
                value: avgGasCost.mul(6)
            });
            await tx.wait();
            acc.BALANCE = avgGasCost.mul(6);
            mainAccount.BALANCE = mainAccount.BALANCE.sub(avgGasCost.mul(6));
        } catch (error) {
            if (error.code === ethers.errors.INSUFFICIENT_FUNDS) {
                throw "low on funds to top up new wallets";
            } else {
                throw `failed to top up new wallet, reason: ${error.reason ?? error.message}`;
            }
        }
        accounts.push(acc);
    }
    return lastIndex;
}

/**
 * Rotates the providers rpcs for viem and ethers clients
 * @param {any} config - The config object
 */
function rotateProviders(config) {
    shuffleArray(config.rpc);
    const allProviders = config.rpc.map(v => { return new ethers.providers.JsonRpcProvider(v); });
    const provider = new ethers.providers.FallbackProvider(allProviders);
    const viemClient = createViemClient(config.chain.id, config.rpc, false);
    const dataFetcher = getDataFetcher(viemClient, config.lps, false);

    config.provider = provider;
    config.viemClient = viemClient;
    config.dataFetcher = dataFetcher;
    config.mainAccount = config.mainAccount.connect(provider);
    for (let i = 0; i < config.accounts.length; i++) {
        config.accounts[i] = config.accounts[i].connect(provider);
    }
}

/**
 * Rotates accounts by putting the first one in last place
 * @param {ethers.Wallet[]} accounts - Array of accounts to rotate
 */
function rotateAccounts(accounts) {
    if (accounts && Array.isArray(accounts) && accounts.length > 1) {
        accounts.push(...accounts.splice(0, 1));
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
    await tx.wait();
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