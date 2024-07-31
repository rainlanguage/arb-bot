const { assert } = require("chai");
const { ethers } = require("hardhat");
const { erc20Abi } = require("../src/abis");
const {
    initAccounts,
    manageAccounts,
    withdrawBounty,
    rotateAccounts,
    rotateProviders,
    getBatchEthBalance,
    getBatchTokenBalanceForAccount,
} = require("../src/account");

describe("Test accounts", async function () {
    it("should get batch eth balance", async function () {
        const balances = [10000n, 0n, 0n];
        const viemClient = {
            chain: { id: 137 },
            multicall: async () => balances,
        };
        const result = await getBatchEthBalance([`0x${"0".repeat(64)}`, `0x${"0".repeat(64)}`, `0x${"0".repeat(64)}`], viemClient);
        const expected = balances.map(v => ethers.BigNumber.from(v));
        assert.deepEqual(result, expected);
    });

    it("should get batch token balance for address", async function () {
        const balances = [10000n, 4567n];
        const viemClient = {
            chain: { id: 137 },
            multicall: async () => balances,
        };
        const result = await getBatchTokenBalanceForAccount(`0x${"0".repeat(64)}`, [`0x${"0".repeat(64)}`, `0x${"0".repeat(64)}`], viemClient);
        const expected = balances.map(v => ethers.BigNumber.from(v));
        assert.deepEqual(result, expected);
    });

    it("should withdraw bounty", async function () {
        const viemClient = {
            chain: { id: 137 },
            call: async () => ({ data: 12n }),
        };
        const from = await ethers.getImpersonatedSigner("0xdF906eA18C6537C6379aC83157047F507FB37263");
        await network.provider.send("hardhat_setBalance", [from.address, "0x4563918244F40000"]);
        const token = new ethers.Contract("0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270", erc20Abi, from);
        const to = await ethers.getSigner();

        const toOriginalBalance = await token.balanceOf(to.address);
        await withdrawBounty(from, to, token, {}, viemClient);
        const toNewBalance = await token.balanceOf(to.address);

        assert.equal(toNewBalance.sub(12n).toString(), toOriginalBalance.toString());
    });

    it("should initiate accounts successfully with mnemonic", async function () {
        const viemClient = {
            chain: { id: 137 },
            multicall: async () => [10000n, 0n, 0n],
            getGasPrice: async() => 3000000n
        };
        const provider = (await ethers.getSigner()).provider;
        const mnemonic = "test test test test test test test test test test test junk";
        const { mainAccount, accounts } = await initAccounts(mnemonic, provider, "0.0000000000000001", viemClient, 2);

        const expected = [
            {address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", BALANCE: "9800"},
            {address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", BALANCE: "100"},
            {address: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC", BALANCE: "100"},
        ];
        assert.equal(mainAccount.address, expected[0].address);
        assert.equal(accounts[0].address, expected[1].address);
        assert.equal(accounts[1].address, expected[2].address);

        assert.equal(mainAccount.BALANCE.toString(), expected[0].BALANCE);
        assert.equal(accounts[0].BALANCE.toString(), expected[1].BALANCE);
        assert.equal(accounts[1].BALANCE.toString(), expected[2].BALANCE);
    });

    it("should initiate accounts successfully with private key", async function () {
        const viemClient = {
            chain: { id: 137 },
            multicall: async () => [10000n],
        };
        const provider = (await ethers.getSigner()).provider;
        const key = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
        const { mainAccount, accounts } = await initAccounts(key, provider, "100", viemClient, 2);

        const expected = [
            {address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", BALANCE: "10000"},
        ];
        assert.isEmpty(accounts);
        assert.equal(mainAccount.address, expected[0].address);
        assert.equal(mainAccount.BALANCE.toString(), expected[0].BALANCE);
    });

    it("should manage accounts successfully", async function () {
        const mnemonic = "test test test test test test test test test test test junk";

        const [mainAccount, acc1, acc2] = await ethers.getSigners();
        const provider = acc1.provider;

        mainAccount.BALANCE = ethers.BigNumber.from("10000");
        acc1.BALANCE = ethers.BigNumber.from("10");
        acc2.BALANCE = ethers.BigNumber.from("0");

        const accounts = [acc1, acc2];
        const result = await manageAccounts(mnemonic, mainAccount, accounts, provider, 20, ethers.BigNumber.from("100"));
        const expectedAccounts = [
            {address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", BALANCE: "7800"},
            {address: "0x02484cb50AAC86Eae85610D6f4Bf026f30f6627D", BALANCE: "1100"},
            {address: "0x08135Da0A343E492FA2d4282F2AE34c6c5CC1BbE", BALANCE: "1100"},
        ];

        assert.equal(result, 22);
        assert.equal(mainAccount.address, expectedAccounts[0].address);
        assert.equal(accounts[0].address, expectedAccounts[1].address);
        assert.equal(accounts[1].address, expectedAccounts[2].address);

        assert.equal(mainAccount.BALANCE.toString(), expectedAccounts[0].BALANCE);
        assert.equal(accounts[0].BALANCE.toString(), expectedAccounts[1].BALANCE);
        assert.equal(accounts[1].BALANCE.toString(), expectedAccounts[2].BALANCE);
    });

    it("should rotate providers", async function () {
        const rpcs = [
            "http://localhost:8080/rpc-url1",
            "http://localhost:8080/rpc-url2"
        ];
        const mainAccount = new ethers.Wallet("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
        const accounts = [new ethers.Wallet("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d")];
        const config = {
            rpc: rpcs,
            chain: { id: 137 },
            mainAccount,
            accounts,
        };

        rotateProviders(config, mainAccount);

        assert.exists(config.mainAccount);
        assert.exists(config.accounts);
        assert.exists(config.rpc);
        assert.exists(config.provider);
        assert.exists(config.viemClient);
        assert.exists(config.dataFetcher);
        assert.equal(config.chain.id, 137);
        assert.equal(config.viemClient.transport.transports[0].value.url, config.rpc[0]);
        assert.equal(config.viemClient.transport.transports[1].value.url, config.rpc[1]);
        assert.equal(config.mainAccount.provider, config.provider);
        accounts.forEach(v => {
            assert.equal(v.provider, config.provider);
        });
    });

    it("should rotate accounts", async function () {
        const accounts = ["account1", "account2", "account3"];
        rotateAccounts(accounts);

        const expected = ["account2", "account3", "account1"];
        assert.deepEqual(accounts, expected);
    });
});
