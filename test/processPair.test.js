const { assert } = require("chai");
const { ethers, viem, network } = require("hardhat");
const ERC20Artifact = require("./abis/ERC20Upgradeable.json");
const { bundleOrders, getDataFetcher, getChainConfig } = require("../src/utils");
const { deployOrderBookNPE2 } = require("./deploy/orderbookDeploy");
const { rainterpreterExpressionDeployerNPE2Deploy } = require("./deploy/expressionDeployer");
const { rainterpreterNPE2Deploy, rainterpreterStoreNPE2Deploy, rainterpreterParserNPE2Deploy } = require("./deploy/rainterpreterDeploy");
const { mockSgFromEvent, getEventArgs, encodeMeta, generateEvaluableConfig } = require("./utils");
const { processPair, ProcessPairReportStatus, ProcessPairHaltReason } = require("../src/processOrders");
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
        config.gasCoveragePercentage = "100";

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
            });

            assert.equal(result.report.status, ProcessPairReportStatus.EmptyVault);

            // check span attributes
            const expectedOtelAttrs = {
                "details.orders": orderPairObject.takeOrders.map(v => v.id),
                "details.pair": "USDT/WMATIC",
            };
            assert.deepEqual(result.spanAttributes, expectedOtelAttrs);

            // check for unexpected keys/values in the spans attrs
            const expectedSpanAttrsKeys = ["details.orders", "details.pair"];
            for (key in result.spanAttributes) {
                if (!expectedSpanAttrsKeys.includes(key)) {
                    assert.fail(`found unexpected key in span atributes: ${key}`);
                }
            }
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
            });

            assert.equal(result.report.status, ProcessPairReportStatus.NoOpportunity);

            // check span attributes
            assert.deepEqual(result.spanAttributes["details.pair"], "USDT/WMATIC");
            assert.exists(result.spanAttributes["details.gasPrice"]);
            assert.isTrue(typeof result.spanAttributes["details.gasPrice"] === "string");
            assert.exists(result.spanAttributes["details.ethPrice"]);
            assert.isTrue(typeof result.spanAttributes["details.ethPrice"] === "string");
            assert.exists(result.spanAttributes["details.hops"]);
            assert.ok(Array.isArray(result.spanAttributes["details.hops"]));
            assert.ok(result.spanAttributes["details.hops"].length === 2);
            assert.deepEqual(
                result.spanAttributes["details.orders"],
                orderPairObject.takeOrders.map(v => v.id)
            );

            // check for unexpected keys/values in the spans attrs
            const expectedSpanAttrsKeys = [
                "details.orders",
                "details.pair",
                "details.gasPrice",
                "details.ethPrice",
                "details.hops"
            ];
            for (key in result.spanAttributes) {
                if (!expectedSpanAttrsKeys.includes(key)) {
                    assert.fail(`found unexpected key in span atributes: ${key}`);
                }
            }

            // check each hop span attributes
            const hop1 = JSON.parse(result.spanAttributes["details.hops"][0]);
            const expectedHop1Keys = ["maxInput", "marketPrice", "blockNumber", "route", "error"];
            assert.equal(hop1["maxInput"], ownerWmaticDepositAmount.toString());
            for (key in hop1) {
                if (!expectedHop1Keys.includes(key)) assert.fail(
                    `found unexpected key in span atributes: ${key}`
                );
            }
            const hop2 = JSON.parse(result.spanAttributes["details.hops"][1]);
            const expectedHop2Keys = ["maxInput", "marketPrice", "blockNumber", "route", "error"];
            assert.equal(hop2["maxInput"], ownerWmaticDepositAmount.div(2).toString());
            for (key in hop2) {
                if (!expectedHop2Keys.includes(key)) assert.fail(
                    `found unexpected key in span atributes: ${key}`
                );
            }
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
            });
            assert.fail("expected to reject, but resolved");
        } catch (error) {
            assert.equal(error.reason, ProcessPairHaltReason.NoWalletFund);

            // check span attributes
            assert.deepEqual(error.spanAttributes["details.pair"], "USDT/WMATIC");
            assert.exists(error.spanAttributes["details.gasPrice"]);
            assert.isTrue(typeof error.spanAttributes["details.gasPrice"] === "string");
            assert.exists(error.spanAttributes["details.ethPrice"]);
            assert.isTrue(typeof error.spanAttributes["details.ethPrice"] === "string");
            assert.deepEqual(
                error.spanAttributes["details.orders"],
                orderPairObject.takeOrders.map(v => v.id)
            );

            // check for unexpected keys/values in the spans attrs
            const expectedSpanAttrsKeys = [
                "details.orders",
                "details.pair",
                "details.gasPrice",
                "details.ethPrice"
            ];
            for (key in error.spanAttributes) {
                if (!expectedSpanAttrsKeys.includes(key)) assert.fail(
                    `found unexpected key in span atributes: ${key}`
                );
            }
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
            });
            assert.fail("expected to reject, but resolved");
        } catch (error) {
            assert.equal(error.reason, ProcessPairHaltReason.FailedToGetEthPrice);

            // check span attributes
            assert.deepEqual(error.spanAttributes["details.pair"], "USDT/WMATIC");
            assert.exists(error.spanAttributes["details.gasPrice"]);
            assert.isTrue(typeof error.spanAttributes["details.gasPrice"] === "string");
            assert.deepEqual(
                error.spanAttributes["details.orders"],
                orderPairObject.takeOrders.map(v => v.id)
            );

            // check for unexpected keys/values in the spans attrs
            const expectedSpanAttrsKeys = ["details.orders", "details.pair", "details.gasPrice"];
            for (key in error.spanAttributes) {
                if (!expectedSpanAttrsKeys.includes(key)) assert.fail(
                    `found unexpected key in span atributes: ${key}`
                );
            }
        }
    });

    it("should return failed to get vault balance", async function () {
        // set the orderbook to some unknown address, so reading vault balance errors
        const _orderbook = await ethers.getContractAt(
            orderbookAbi,
            "0x140D8d3649Ec605CF69018C627fB44cCC76eC89f"
        );
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
            });
            assert.fail("expected to reject, but resolved");
        } catch (error) {
            assert.equal(error.reason, ProcessPairHaltReason.FailedToGetVaultBalance);

            // check span attributes
            assert.deepEqual(error.spanAttributes["details.pair"], "USDT/WMATIC");
            assert.deepEqual(
                error.spanAttributes["details.orders"],
                orderPairObject.takeOrders.map(v => v.id)
            );

            // check for unexpected keys/values in the spans attrs
            const expectedSpanAttrsKeys = ["details.orders", "details.pair"];
            for (key in error.spanAttributes) {
                if (!expectedSpanAttrsKeys.includes(key)) assert.fail(
                    `found unexpected key in span atributes: ${key}`
                );
            }
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
            });
            assert.fail("expected to reject, but resolved");
        } catch (error) {
            assert.equal(error.reason, ProcessPairHaltReason.FailedToGetGasPrice);

            // check span attributes
            assert.deepEqual(error.spanAttributes["details.pair"], "USDT/WMATIC");
            assert.deepEqual(
                error.spanAttributes["details.orders"],
                orderPairObject.takeOrders.map(v => v.id)
            );

            // check for unexpected keys/values in the spans attrs
            const expectedSpanAttrsKeys = ["details.orders", "details.pair"];
            for (key in error.spanAttributes) {
                if (!expectedSpanAttrsKeys.includes(key)) assert.fail(
                    `found unexpected key in span atributes: ${key}`
                );
            }
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
            });
            assert.fail("expected to reject, but resolved");
        } catch (error) {
            assert.equal(error.reason, ProcessPairHaltReason.FailedToGetPools);

            // check span attributes
            assert.deepEqual(error.spanAttributes["details.pair"], "USDT/WMATIC");
            assert.exists(error.spanAttributes["details.gasPrice"]);
            assert.isTrue(typeof error.spanAttributes["details.gasPrice"] === "string");
            assert.exists(error.spanAttributes["details.ethPrice"]);
            assert.isTrue(typeof error.spanAttributes["details.ethPrice"] === "string");
            assert.deepEqual(
                error.spanAttributes["details.orders"],
                orderPairObject.takeOrders.map(v => v.id)
            );

            // check for unexpected keys/values in the spans attrs
            const expectedSpanAttrsKeys = [
                "details.orders",
                "details.pair",
                "details.gasPrice",
                "details.ethPrice"
            ];
            for (key in error.spanAttributes) {
                if (!expectedSpanAttrsKeys.includes(key)) assert.fail(
                    `found unexpected key in span atributes: ${key}`
                );
            }
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
            });
            assert.fail("expected to reject, but resolved");
        } catch (error) {
            assert.equal(error.reason, ProcessPairHaltReason.NoRoute);

            // check span attributes
            assert.deepEqual(error.spanAttributes["details.pair"], "USDT/WMATIC");
            assert.exists(error.spanAttributes["details.gasPrice"]);
            assert.isTrue(typeof error.spanAttributes["details.gasPrice"] === "string");
            assert.exists(error.spanAttributes["details.ethPrice"]);
            assert.isTrue(typeof error.spanAttributes["details.ethPrice"] === "string");
            assert.deepEqual(
                error.spanAttributes["details.orders"],
                _orderPairObject.takeOrders.map(v => v.id)
            );

            // check for unexpected keys/values in the spans attrs
            const expectedSpanAttrsKeys = [
                "details.orders",
                "details.pair",
                "details.gasPrice",
                "details.ethPrice"
            ];
            for (key in error.spanAttributes) {
                if (!expectedSpanAttrsKeys.includes(key)) assert.fail(
                    `found unexpected key in span atributes: ${key}`
                );
            }
        }

        // set the test type to tx fail
        config.testType = "tx-fail";
        config.gasCoveragePercentage = "0";
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
            });
            assert.fail("expected to reject, but resolved");
        } catch (error) {
            assert.equal(error.reason, ProcessPairHaltReason.TxFailed);

            // check span attributes
            assert.deepEqual(error.spanAttributes["details.pair"], "USDT/WMATIC");
            assert.exists(error.spanAttributes["details.gasPrice"]);
            assert.isTrue(typeof error.spanAttributes["details.gasPrice"] === "string");
            assert.deepEqual(
                error.spanAttributes["details.orders"],
                _orderPairObject.takeOrders.map(v => v.id)
            );
            assert.exists(error.spanAttributes["oppBlockNumber"]);
            assert.isTrue(typeof error.spanAttributes["oppBlockNumber"] === "number");
            assert.isTrue(error.spanAttributes["foundOpp"]);
            assert.exists(error.spanAttributes["details.blockNumber"]);
            assert.isTrue(typeof error.spanAttributes["details.blockNumber"] === "number");
            assert.exists(error.spanAttributes["details.route"]);
            assert.isTrue(error.spanAttributes["details.route"].every(v => typeof v === "string"));
            assert.equal(error.spanAttributes["details.maxInput"], "10000000000000000000");
            assert.exists(error.spanAttributes["details.marketPrice"]);
            assert.isTrue(typeof error.spanAttributes["details.marketPrice"] === "string");
            assert.exists(error.spanAttributes["details.gasCostInToken"]);
            assert.isTrue(typeof error.spanAttributes["details.gasCostInToken"] === "string");
            assert.exists(error.spanAttributes["details.rawTx"]);
            assert.exists(typeof error.spanAttributes["details.rawTx"] === "string");


            // check for unexpected keys/values in the spans attrs
            const expectedSpanAttrsKeys = [
                "details.orders",
                "details.pair",
                "details.gasPrice",
                "oppBlockNumber",
                "foundOpp",
                "details.blockNumber",
                "details.route",
                "details.maxInput",
                "details.marketPrice",
                "details.gasCostInToken",
                "details.rawTx",
            ];
            for (key in error.spanAttributes) {
                if (!expectedSpanAttrsKeys.includes(key)) assert.fail(
                    `found unexpected key in span atributes: ${key}`
                );
            }
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
            });
            assert.fail("expected to reject, but resolved");
        } catch (error) {
            assert.equal(error.reason, ProcessPairHaltReason.TxMineFailed);

            // check span attributes
            assert.deepEqual(error.spanAttributes["details.pair"], "USDT/WMATIC");
            assert.exists(error.spanAttributes["details.gasPrice"]);
            assert.isTrue(typeof error.spanAttributes["details.gasPrice"] === "string");
            assert.deepEqual(
                error.spanAttributes["details.orders"],
                _orderPairObject.takeOrders.map(v => v.id)
            );
            assert.exists(error.spanAttributes["oppBlockNumber"]);
            assert.isTrue(typeof error.spanAttributes["oppBlockNumber"] === "number");
            assert.isTrue(error.spanAttributes["foundOpp"]);
            assert.exists(error.spanAttributes["details.blockNumber"]);
            assert.isTrue(typeof error.spanAttributes["details.blockNumber"] === "number");
            assert.exists(error.spanAttributes["details.route"]);
            assert.isTrue(error.spanAttributes["details.route"].every(v => typeof v === "string"));
            assert.equal(error.spanAttributes["details.maxInput"], "10000000000000000000");
            assert.exists(error.spanAttributes["details.marketPrice"]);
            assert.isTrue(typeof error.spanAttributes["details.marketPrice"] === "string");
            assert.exists(error.spanAttributes["details.gasCostInToken"]);
            assert.isTrue(typeof error.spanAttributes["details.gasCostInToken"] === "string");
            assert.exists(error.spanAttributes["details.txUrl"]);
            assert.isTrue(typeof error.spanAttributes["details.txUrl"] === "string");
            assert.exists(error.spanAttributes["details.tx"]);
            assert.isTrue(typeof error.spanAttributes["details.tx"] === "string");

            // check for unexpected keys/values in the spans attrs
            const expectedSpanAttrsKeys = [
                "details.orders",
                "details.pair",
                "details.gasPrice",
                "oppBlockNumber",
                "foundOpp",
                "details.blockNumber",
                "details.route",
                "details.maxInput",
                "details.marketPrice",
                "details.gasCostInToken",
                "details.txUrl",
                "details.tx",
            ];
            for (key in error.spanAttributes) {
                if (!expectedSpanAttrsKeys.includes(key)) assert.fail(
                    `found unexpected key in span atributes: ${key}`
                );
            }
        }
    });
});