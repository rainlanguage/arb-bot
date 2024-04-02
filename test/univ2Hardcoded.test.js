require("dotenv").config();
const { assert } = require("chai");
const { clear } = require("../src");
const { ethers } = require("hardhat");
const CONFIG = require("../config.json");
const { arbDeploy } = require("./deploy/arbDeploy");
const ERC20Artifact = require("./abis/ERC20Upgradeable.json");
const helpers = require("@nomicfoundation/hardhat-network-helpers");
const { deployOrderBookNPE2 } = require("./deploy/orderbookDeploy");
const { randomUint256, generateEvaluableConfig, mockSgFromEvent, encodeMeta, getEventArgs } = require("./utils");
const { rainterpreterExpressionDeployerNPE2Deploy } = require("./deploy/expressionDeployer");
const { rainterpreterNPE2Deploy, rainterpreterStoreNPE2Deploy, rainterpreterParserNPE2Deploy } = require("./deploy/rainterpreterDeploy");


// This test runs on hardhat forked network of polygon
describe.only("Rain Arb Bot 'univ2 hardcoded' Mode Tests", async function () {
    let interpreter,
        store,
        expressionDeployer,
        orderbook,
        arb,
        USDT,
        USDTDecimals,
        BJ,
        BJDecimals,
        bot,
        owners,
        config;

    beforeEach(async() => {
        // reset network before each test
        // await helpers.reset("http://127.0.0.1:8545/");
        await helpers.reset("https://rpc.ankr.com/arbitrum", 196636675);

        [bot, ...owners] = await ethers.getSigners();
        config = CONFIG.find(async(v) => v.chainId === await bot.getChainId());
        console.log("1");
        // deploy contracts
        interpreter = await rainterpreterNPE2Deploy();
        store = await rainterpreterStoreNPE2Deploy();
        parser = await rainterpreterParserNPE2Deploy();
        expressionDeployer = await rainterpreterExpressionDeployerNPE2Deploy(
            interpreter,
            store,
            parser
        );
        orderbook = await deployOrderBookNPE2(expressionDeployer);
        console.log(orderbook.address);
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
            "srouter",
            config.routeProcessor3_2Address,
            true
        );
        console.log("2");
        // update config with new addresses
        config.arbAddress = arb.address;
        config.orderbookAddress = orderbook.address;

        // get token contract instances
        USDT = await ethers.getContractAt(
            ERC20Artifact.abi,
            config.stableTokens.find(v => v.symbol === "USDT").address
        );
        USDTDecimals = config.stableTokens.find(v => v.symbol === "USDT").decimals;
        console.log("3");
        BJ = await ethers.getContractAt(
            ERC20Artifact.abi,
            "0x9cAAe40DCF950aFEA443119e51E821D6FE2437ca"
        );
        console.log("4");
        BJDecimals = 18;

        // impersonate addresses with large token balances to fund the owners 1 2 3
        // accounts with 1000 tokens each used for topping up the order vaults
        const USDTHolder = await ethers.getImpersonatedSigner("0x8841774533d3d76c170b2a72e1b1542aaa751c4e");
        console.log("5");
        await bot.sendTransaction({
            value: ethers.utils.parseEther("50"),
            to: USDTHolder.address
        });
        console.log("6");
        await USDT.connect(USDTHolder).transfer(owners[0].address, "1000" + "0".repeat(USDTDecimals));
        console.log("7");
    });

    it.only("should clear orders in 'srouter' mode using interpreter v2", async function () {
        // set up vault ids
        const BJ_vaultId = ethers.BigNumber.from(randomUint256());
        const USDT_vaultId = ethers.BigNumber.from(randomUint256());

        const depositConfigStruct = {
            token: USDT.address,
            vaultId: USDT_vaultId,
            amount: "1" + "0".repeat(USDTDecimals),
        };
        await USDT
            .connect(owners[0])
            .approve(orderbook.address, depositConfigStruct.amount);
        console.log("8");
        await orderbook
            .connect(owners[0])
            .deposit(
                depositConfigStruct.token,
                depositConfigStruct.vaultId,
                depositConfigStruct.amount
            );
        console.log("9");

        const expConfig = {
            constants: [
                ethers.constants.MaxUint256.toHexString(),  // max output
                "5" + "0".repeat(17)                        // ratio 0.5, for testing purpose to ensure clearance
            ],
            bytecode: "0x020000000c02020002010000000100000100000000"
        };
        const EvaluableConfig = generateEvaluableConfig(
            expressionDeployer,
            expConfig
        );

        // add orders
        const owner1_order1 = {
            validInputs: [
                { token: BJ.address, decimals: BJDecimals, vaultId: BJ_vaultId },
            ],
            validOutputs: [
                { token: USDT.address, decimals: USDTDecimals, vaultId: USDT_vaultId },
            ],
            evaluableConfig: EvaluableConfig,
            meta: encodeMeta("owner1_order1"),
        };
        const tx_owner1_order1 = await orderbook.connect(owners[0]).addOrder(owner1_order1);
        console.log("10");
        const sgOrders = [];
        // get sg-like order details from tx event
        sgOrders.push(await mockSgFromEvent(
            await getEventArgs(
                tx_owner1_order1,
                "AddOrder",
                orderbook
            ),
            orderbook,
            [USDT, BJ]
        ));
        console.log("11");

        // check that bot's balance is zero for all tokens
        assert.ok(
            (await USDT.connect(bot).balanceOf(bot.address)).isZero()
        );
        assert.ok(
            (await BJ.connect(bot).balanceOf(bot.address)).isZero()
        );
        console.log("12");

        // run the clearing process
        config.rpc = "test";
        config.signer = bot;
        config.interpreterv2 = true;
        config.hops = 5;
        config.bundle = true;
        const reports = await clear("univ2hardcode", config, sgOrders);

        // should have cleared 2 toke pairs bundled orders
        assert.ok(reports.length == 1);

        // validate first cleared token pair orders
        assert.equal(reports[0].tokenPair, "BJ/USDT");
        assert.equal(reports[0].clearedAmount, "1000000");
        assert.equal(reports[0].clearedOrders.length, 1);

        // check vault balances for orders in cleared token pair USDT/BJ
        assert.equal(
            (await orderbook.vaultBalance(
                owners[0].address,
                BJ.address,
                BJ_vaultId
            )).toString(),
            "500000000000000000"
        );
        assert.equal(
            (await orderbook.vaultBalance(
                owners[0].address,
                USDT.address,
                USDT_vaultId
            )).toString(),
            "0"
        );


        // bot should have received the bounty for cleared orders input token
        assert.ok(
            (await USDT.connect(bot).balanceOf(bot.address)).isZero()
        );

        // should not have received any bounty for the tokens that were not part of the cleared orders input tokens
        assert.ok(
            (await BJ.connect(bot).balanceOf(bot.address)).gt("0")
        );
    });
});