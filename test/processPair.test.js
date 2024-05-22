const { assert } = require("chai");
const { ethers, viem, network } = require("hardhat");
const ERC20Artifact = require("./abis/ERC20Upgradeable.json");
const { bundleOrders, getDataFetcher, getChainConfig } = require("../src/utils");
const { deployOrderBookNPE2 } = require("./deploy/orderbookDeploy");
const { rainterpreterExpressionDeployerNPE2Deploy } = require("./deploy/expressionDeployer");
const { rainterpreterNPE2Deploy, rainterpreterStoreNPE2Deploy, rainterpreterParserNPE2Deploy } = require("./deploy/rainterpreterDeploy");
const { mockSgFromEvent, getEventArgs, encodeMeta, generateEvaluableConfig } = require("./utils");
const { processPair, ProcessPairReportStatus, ProcessPairHaltReason } = require("../src/modes/srouter");
const { LiquidityProviders } = require("sushi");
const { arbDeploy } = require("./deploy/arbDeploy");
const { orderbookAbi } = require("../src/abis");

describe("Test process pair", async function () {
    let signers,
        config,
        viemClient,
        usdt,
        usdtContract,
        wmatic,
        wmaticContract,
        owner,
        orderbook,
        arb,
        orderPairObject,
        dataFetcher,
        wmaticHolder,
        expressionDeployer;

    // usdt
    const validInputs = [{
        token: "0xc2132d05d31c914a87c6611c10748aeb04b58e8f",
        decimals: 6,
        vaultId: "0xdce98e3a7ee4b8b7ec1def4542b220083f8c3f0d569f142752cdc5bad6e14092"
    }];
    // wmatic
    const validOutputs = [{
        token: "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270",
        decimals: 18,
        vaultId: "0xdce98e3a7ee4b8b7ec1def4542b220083f8c3f0d569f142752cdc5bad6e14092"}];

    before(async () => {
        config = getChainConfig(137);
        signers = await ethers.getSigners();
        viemClient = await viem.getPublicClient();

        usdt = {
            address: validInputs[0].token,
            decimals: validInputs[0].decimals,
            symbol: "USDT",
            addressWithBalance: "0xF977814e90dA44bFA03b6295A0616a897441aceC",
        };
        usdtContract = await ethers.getContractAt(
            ERC20Artifact.abi,
            usdt.address
        );
        wmatic = {
            address: validOutputs[0].token,
            decimals: validOutputs[0].decimals,
            symbol: "WMATIC",
            addressWithBalance: "0xdF906eA18C6537C6379aC83157047F507FB37263",
        };
        wmaticContract = await ethers.getContractAt(
            ERC20Artifact.abi,
            wmatic.address
        );

        // impersonate owner
        owner = await ethers.getImpersonatedSigner("0x0f47a0c7f86a615606ca315ad83c3e302b474bd6");

        // deploy contracts
        const interpreter = await rainterpreterNPE2Deploy();
        const store = await rainterpreterStoreNPE2Deploy();
        const parser = await rainterpreterParserNPE2Deploy();
        expressionDeployer = await rainterpreterExpressionDeployerNPE2Deploy(
            interpreter,
            store,
            parser
        );
        orderbook = await deployOrderBookNPE2(expressionDeployer);
        arb = await arbDeploy(
            expressionDeployer,
            orderbook.address,
            generateEvaluableConfig(
                expressionDeployer,
                {
                    constants: [],
                    bytecode: "0x01000000000000"
                }
            ),
            config.routeProcessors["3.2"],
        );

        // set the rest of config
        config.isTest = true;
        config.rpc = process?.env?.TEST_POLYGON_RPC;
        config.shuffle = false;
        config.hops = 2;
        config.bundle = false;
        config.retries = 1;
        config.lps = [LiquidityProviders.SushiSwapV2];
        config.arbAddress = arb.address;
        config.orderbookAddress = orderbook.address;
        config.testViemClient = viemClient;

        // get a DataFetcher
        dataFetcher = getDataFetcher(config, config.lps, false);

        // impersonate addresses with large token balances to fund the owner
        wmaticHolder = await ethers.getImpersonatedSigner(wmatic.addressWithBalance);

        // fund token holders and owners with eth for tx gas cost
        await network.provider.send("hardhat_setBalance", [wmaticHolder.address, "0x4563918244F40000"]);
        await network.provider.send("hardhat_setBalance", [owner.address, "0x4563918244F40000"]);

        // send some wmatic to owner
        await wmaticContract.connect(wmaticHolder).transfer(owner.address, "50" + "0".repeat(wmatic.decimals));

        const orderTx = await orderbook.connect(owner).addOrder({
            validInputs,
            validOutputs,
            evaluableConfig: generateEvaluableConfig(
                expressionDeployer,
                {
                    constants: [
                        ethers.constants.MaxUint256.toHexString(),
                        ethers.constants.MaxUint256.toHexString(),
                    ],
                    bytecode: "0x020000000c02020002010000000100000100000000"
                }
            ),
            meta: encodeMeta("owner_order"),
        });
        const order = await mockSgFromEvent(
            await getEventArgs(
                orderTx,
                "AddOrder",
                orderbook
            ),
            orderbook,
            [usdtContract, wmaticContract]
        );
        orderPairObject = bundleOrders([order], false, false)[0];
    });

    it("should return empty vault", async function () {
        try {
            const result = await processPair({
                config,
                orderPairObject,
                viemClient,
                dataFetcher,
                signer: signers[0],
                undefined,
                arb,
                orderbook,
                pair: "USDT/WMATIC",
                gasCoveragePercentage: "100",
            });
            assert.equal(result.report.status, ProcessPairReportStatus.EmptyVault);
        } catch (error) {
            assert.fail("expected to resolve, but rejected");
        }
    });

    it("should return no oppoortunity", async function () {
        const ownerWmaticDepositAmount = ethers.BigNumber.from("10" + "0".repeat(wmatic.decimals));
        const depositConfigStructOwner = {
            token: wmaticContract.address,
            vaultId: validOutputs[0].vaultId,
            amount: ownerWmaticDepositAmount,
        };
        await wmaticContract
            .connect(owner)
            .approve(orderbook.address, depositConfigStructOwner.amount);
        await orderbook
            .connect(owner)
            .deposit(
                depositConfigStructOwner.token,
                depositConfigStructOwner.vaultId,
                depositConfigStructOwner.amount
            );
        try {
            const result = await processPair({
                config,
                orderPairObject,
                viemClient,
                dataFetcher,
                signer: signers[0],
                undefined,
                arb,
                orderbook,
                pair: "USDT/WMATIC",
                gasCoveragePercentage: "100",
            });
            assert.equal(result.report.status, ProcessPairReportStatus.NoOpportunity);
        } catch (error) {
            assert.fail("expected to resolve, but rejected");
        }
    });

    it("should return no wallet fund", async function () {
        config.testType = "no-fund";
        try {
            await processPair({
                config,
                orderPairObject,
                viemClient,
                dataFetcher,
                signer: signers[0],
                undefined,
                arb,
                orderbook,
                pair: "USDT/WMATIC",
                gasCoveragePercentage: "100",
            });
            assert.fail("expected to reject, but resolved");
        } catch (error) {
            assert.equal(error.reason, ProcessPairHaltReason.NoWalletFund);
        }
    });

    it("should return failed to get eth price", async function () {
        // set the buy token to some unknown address, so router cannot find a price for
        const _orderPairObject = Object.assign({}, orderPairObject);
        _orderPairObject.buyToken = "0x140D8d3649Ec605CF69018C627fB44cCC76eC89f";
        try {
            await processPair({
                config,
                orderPairObject: _orderPairObject,
                viemClient,
                dataFetcher,
                signer: signers[0],
                undefined,
                arb,
                orderbook,
                pair: "USDT/WMATIC",
                gasCoveragePercentage: "100",
            });
            assert.fail("expected to reject, but resolved");
        } catch (error) {
            assert.equal(error.reason, ProcessPairHaltReason.FailedToGetEthPrice);
        }
    });

    it("should return failed to get vault balance", async function () {
        // set the orderbook to some unknown address, so reading vault balance errors
        const _orderbook = await ethers.getContractAt(orderbookAbi, "0x140D8d3649Ec605CF69018C627fB44cCC76eC89f");
        try {
            await processPair({
                config,
                orderPairObject,
                viemClient,
                dataFetcher,
                signer: signers[0],
                undefined,
                arb,
                orderbook: _orderbook,
                pair: "USDT/WMATIC",
                gasCoveragePercentage: "100",
            });
            assert.fail("expected to reject, but resolved");
        } catch (error) {
            assert.equal(error.reason, ProcessPairHaltReason.FailedToGetVaultBalance);
        }
    });

    it("should return failed to get gas price", async function () {
        config.testType = "gas-price";
        try {
            await processPair({
                config,
                orderPairObject,
                viemClient,
                dataFetcher,
                signer: signers[0],
                undefined,
                arb,
                orderbook,
                pair: "USDT/WMATIC",
                gasCoveragePercentage: "100",
            });
            assert.fail("expected to reject, but resolved");
        } catch (error) {
            assert.equal(error.reason, ProcessPairHaltReason.FailedToGetGasPrice);
        }
    });

    it("should return failed to get pools", async function () {
        config.testType = "pools";
        try {
            await processPair({
                config,
                orderPairObject,
                viemClient,
                dataFetcher,
                signer: signers[0],
                undefined,
                arb,
                orderbook,
                pair: "USDT/WMATIC",
                gasCoveragePercentage: "100",
            });
            assert.fail("expected to reject, but resolved");
        } catch (error) {
            assert.equal(error.reason, ProcessPairHaltReason.FailedToGetPools);
        }
    });

    it("should return no route, tx failed and tx mine failed", async function () {
        const orderTx = await orderbook.connect(owner).addOrder({
            validInputs,
            validOutputs,
            evaluableConfig: generateEvaluableConfig(
                expressionDeployer,
                {
                    constants: [
                        ethers.constants.MaxUint256.toHexString(),
                        "0",
                    ],
                    bytecode: "0x020000000c02020002010000000100000100000000"
                }
            ),
            meta: encodeMeta("owner_order"),
        });
        const order = await mockSgFromEvent(
            await getEventArgs(
                orderTx,
                "AddOrder",
                orderbook
            ),
            orderbook,
            [usdtContract, wmaticContract]
        );
        const _orderPairObject = bundleOrders([order], false, false)[0];

        // set the test type to no route
        config.testType = "no-route";
        try {
            await processPair({
                config,
                orderPairObject: _orderPairObject,
                viemClient,
                dataFetcher,
                signer: signers[0],
                undefined,
                arb,
                orderbook,
                pair: "USDT/WMATIC",
                gasCoveragePercentage: "100",
            });
            assert.fail("expected to reject, but resolved");
        } catch (error) {
            assert.equal(error.reason, ProcessPairHaltReason.NoRoute);
        }

        // set the test type to tx fail
        config.testType = "tx-fail";
        try {
            await processPair({
                config,
                orderPairObject: _orderPairObject,
                viemClient,
                dataFetcher,
                signer: signers[0],
                undefined,
                arb,
                orderbook,
                pair: "USDT/WMATIC",
                gasCoveragePercentage: "0",
            });
            assert.fail("expected to reject, but resolved");
        } catch (error) {
            assert.equal(error.reason, ProcessPairHaltReason.TxFailed);
        }

        // set the test type to tx mine fail
        config.testType = "tx-mine-fail";
        try {
            await processPair({
                config,
                orderPairObject: _orderPairObject,
                viemClient,
                dataFetcher,
                signer: signers[0],
                undefined,
                arb,
                orderbook,
                pair: "USDT/WMATIC",
                gasCoveragePercentage: "0",
            });
            assert.fail("expected to reject, but resolved");
        } catch (error) {
            assert.equal(error.reason, ProcessPairHaltReason.TxMineFailed);
        }
    });
});