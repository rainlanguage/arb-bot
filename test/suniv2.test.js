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
describe("Rain Arb Bot 'univ2 hardcoded' Mode Tests", async function () {
    let interpreter,
        store,
        expressionDeployer,
        orderbook,
        arb,
        USDT,
        USDTDecimals,
        WFLR,
        WFLRDecimals,
        bot,
        owners,
        config;

    beforeEach(async() => {
        // reset network before each test
        await helpers.reset("https://rpc.ankr.com/flare", 22066730);

        [bot, ...owners] = await ethers.getSigners();
        config = CONFIG.find((v) => v.chainId === 14);
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
            config.routeProcessor3Address,
            true
        );
        // update config with new addresses
        config.arbAddress = arb.address;
        config.orderbookAddress = orderbook.address;

        // get token contract instances
        USDT = await ethers.getContractAt(
            ERC20Artifact.abi,
            "0x96B41289D90444B8adD57e6F265DB5aE8651DF29"
        );
        USDTDecimals = 6;
        WFLR = await ethers.getContractAt(
            ERC20Artifact.abi,
            "0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d"
        );
        WFLRDecimals = 18;

        // impersonate addresses with large token balances to fund the owners 1 2 3
        // accounts with 1000 tokens each used for topping up the order vaults
        const USDTHolder = await ethers.getImpersonatedSigner("0x09F5e7452d72b4A4e51b77DF1Ec8391e46e5F864");
        // 9999 746703416985650280
        await bot.sendTransaction({
            value: ethers.utils.parseEther("5"),
            to: USDTHolder.address
        });
        await USDT.connect(USDTHolder).transfer(owners[0].address, "1000" + "0".repeat(USDTDecimals));
    });

    it("should clear orders in 'srouter' mode using interpreter v2", async function () {
        // set up vault ids
        const WFLR_vaultId = ethers.BigNumber.from(randomUint256());
        const USDT_vaultId = ethers.BigNumber.from(randomUint256());

        const depositConfigStruct = {
            token: USDT.address,
            vaultId: USDT_vaultId,
            amount: "100" + "0".repeat(USDTDecimals),
        };
        await USDT
            .connect(owners[0])
            .approve(orderbook.address, depositConfigStruct.amount);
        await orderbook
            .connect(owners[0])
            .deposit(
                depositConfigStruct.token,
                depositConfigStruct.vaultId,
                depositConfigStruct.amount
            );

        const expConfig = {
            constants: [
                ethers.constants.MaxUint256.toHexString(),  // max output
                "1" + "0".repeat(18)                        // ratio 0.5, for testing purpose to ensure clearance
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
                { token: WFLR.address, decimals: WFLRDecimals, vaultId: WFLR_vaultId },
            ],
            validOutputs: [
                { token: USDT.address, decimals: USDTDecimals, vaultId: USDT_vaultId },
            ],
            evaluableConfig: EvaluableConfig,
            meta: encodeMeta("owner1_order1"),
        };
        const tx_owner1_order1 = await orderbook.connect(owners[0]).addOrder(owner1_order1);
        const sgOrders = [];
        // get sg-like order details from tx event
        sgOrders.push(await mockSgFromEvent(
            await getEventArgs(
                tx_owner1_order1,
                "AddOrder",
                orderbook
            ),
            orderbook,
            [USDT, WFLR]
        ));

        // check that bot's balance is zero for all tokens
        assert.ok(
            (await USDT.connect(bot).balanceOf(bot.address)).isZero()
        );
        assert.ok(
            (await WFLR.connect(bot).balanceOf(bot.address)).isZero()
        );

        // run the clearing process
        config.rpc = "test";
        config.signer = bot;
        config.interpreterv2 = true;
        config.hops = 5;
        config.bundle = true;
        const reports = await clear("suniv2", config, sgOrders);

        // should have cleared 2 toke pairs bundled orders
        assert.ok(reports.length == 1);

        // validate first cleared token pair orders
        assert.equal(reports[0].tokenPair, "WFLR/eUSDT");
        assert.equal(reports[0].clearedAmount, "100000000");
        assert.equal(reports[0].clearedOrders.length, 1);

        // check vault balances for orders in cleared token pair USDT/BJ
        assert.equal(
            (await orderbook.vaultBalance(
                owners[0].address,
                WFLR.address,
                WFLR_vaultId
            )).toString(),
            "100000000000000000000"
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
            (await WFLR.connect(bot).balanceOf(bot.address)).gt("0")
        );
    });
});