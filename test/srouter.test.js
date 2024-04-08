require("dotenv").config();
const { assert } = require("chai");
const { clear } = require("../src");
const { ethers } = require("hardhat");
const CONFIG = require("../config.json");
const { arbDeploy } = require("./deploy/arbDeploy");
const ERC20Artifact = require("./abis/ERC20Upgradeable.json");
const helpers = require("@nomicfoundation/hardhat-network-helpers");
const { deployOrderBook, deployOrderBookNPE2 } = require("./deploy/orderbookDeploy");
const { randomUint256, prepareOrders, AddressWithBalance, generateEvaluableConfig } = require("./utils");
const { rainterpreterExpressionDeployerDeploy, rainterpreterExpressionDeployerNPE2Deploy } = require("./deploy/expressionDeployer");
const { rainterpreterDeploy, rainterpreterStoreDeploy, rainterpreterNPE2Deploy, rainterpreterStoreNPE2Deploy, rainterpreterParserNPE2Deploy } = require("./deploy/rainterpreterDeploy");
const { Resource } = require("@opentelemetry/resources");
const { SEMRESATTRS_SERVICE_NAME } = require("@opentelemetry/semantic-conventions");
const { BasicTracerProvider, BatchSpanProcessor, ConsoleSpanExporter } = require("@opentelemetry/sdk-trace-base");
const { trace, context } = require("@opentelemetry/api");


// This test runs on hardhat forked network of polygon
describe("Rain Arb Bot 'srouter' Mode Tests", async function () {
    let turn = 0;
    let interpreter,
        store,
        expressionDeployer,
        orderbook,
        arb,
        USDT,
        USDTDecimals,
        USDC,
        USDCDecimals,
        BUSD,
        BUSDDecimals,
        DAI,
        DAIDecimals,
        FRAX,
        FRAXDecimals,
        bot,
        owners,
        config;

    const exporter = new ConsoleSpanExporter();
    const provider = new BasicTracerProvider({
        resource: new Resource({
            [SEMRESATTRS_SERVICE_NAME]: "arb-bot-test"
        }),
    });
    provider.addSpanProcessor(new BatchSpanProcessor(exporter));
    provider.register();
    const tracer = provider.getTracer("arb-bot-tracer");

    beforeEach(async() => {
        // reset network before each test
        await helpers.reset(
            process?.env?.TEST_POLYGON_RPC,
            53559376
        );

        [bot, ...owners] = await ethers.getSigners();
        config = CONFIG.find(async(v) => v.chainId === await bot.getChainId());

        // deploy contracts
        interpreter = turn == 0
            ? await rainterpreterDeploy(true)
            : await rainterpreterNPE2Deploy();
        store = turn == 0
            ? await rainterpreterStoreDeploy(true)
            : await rainterpreterStoreNPE2Deploy();
        parser = turn == 0 ? undefined : await rainterpreterParserNPE2Deploy();
        expressionDeployer = turn == 0
            ? await rainterpreterExpressionDeployerDeploy(
                interpreter,
                store,
                true
            )
            : await rainterpreterExpressionDeployerNPE2Deploy(
                interpreter,
                store,
                parser
            );
        orderbook = turn == 0
            ? await deployOrderBook(expressionDeployer, true)
            : await deployOrderBookNPE2(expressionDeployer);
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
            turn === 0 ? undefined : true
        );

        // update config with new addresses
        config.arbAddress = arb.address;
        config.orderbookAddress = orderbook.address;

        // get token contract instances
        USDT = await ethers.getContractAt(
            ERC20Artifact.abi,
            config.stableTokens.find(v => v.symbol === "USDT").address
        );
        USDTDecimals = config.stableTokens.find(v => v.symbol === "USDT").decimals;
        USDC = await ethers.getContractAt(
            ERC20Artifact.abi,
            config.stableTokens.find(v => v.symbol === "USDC").address
        );
        USDCDecimals = config.stableTokens.find(v => v.symbol === "USDC").decimals;
        DAI = await ethers.getContractAt(
            ERC20Artifact.abi,
            config.stableTokens.find(v => v.symbol === "DAI").address
        );
        DAIDecimals = config.stableTokens.find(v => v.symbol === "DAI").decimals;
        BUSD = await ethers.getContractAt(
            ERC20Artifact.abi,
            config.stableTokens.find(v => v.symbol === "BUSD").address
        );
        BUSDDecimals = config.stableTokens.find(v => v.symbol === "BUSD").decimals;
        FRAX = await ethers.getContractAt(
            ERC20Artifact.abi,
            config.stableTokens.find(v => v.symbol === "FRAX").address
        );
        FRAXDecimals = config.stableTokens.find(v => v.symbol === "FRAX").decimals;

        // impersonate addresses with large token balances to fund the owners 1 2 3
        // accounts with 1000 tokens each used for topping up the order vaults
        const USDCHolder = await ethers.getImpersonatedSigner(AddressWithBalance.usdc);
        const USDTHolder = await ethers.getImpersonatedSigner(AddressWithBalance.usdt);
        const DAIHolder = await ethers.getImpersonatedSigner(AddressWithBalance.dai);
        const BUSDHolder = await ethers.getImpersonatedSigner(AddressWithBalance.busd);
        const FRAXHolder = await ethers.getImpersonatedSigner(AddressWithBalance.frax);
        await bot.sendTransaction({
            value: ethers.utils.parseEther("5.0"),
            to: USDTHolder.address
        });
        await bot.sendTransaction({
            value: ethers.utils.parseEther("5.0"),
            to: USDCHolder.address
        });
        await bot.sendTransaction({
            value: ethers.utils.parseEther("5.0"),
            to: DAIHolder.address
        });
        await bot.sendTransaction({
            value: ethers.utils.parseEther("5.0"),
            to: BUSDHolder.address
        });
        await bot.sendTransaction({
            value: ethers.utils.parseEther("5.0"),
            to: FRAXHolder.address
        });
        for (let i = 0; i < 3; i++) {
            await USDT.connect(USDTHolder).transfer(owners[i].address, "1000" + "0".repeat(USDTDecimals));
            await USDC.connect(USDCHolder).transfer(owners[i].address, "1000" + "0".repeat(USDCDecimals));
            await DAI.connect(DAIHolder).transfer(owners[i].address, "1000" + "0".repeat(DAIDecimals));
            await BUSD.connect(BUSDHolder).transfer(owners[i].address, "1000" + "0".repeat(BUSDDecimals));
            await FRAX.connect(FRAXHolder).transfer(owners[i].address, "1000" + "0".repeat(FRAXDecimals));
        }
        turn++;
    });

    it("should clear orders in 'srouter' mode", async function () {
        const testSpan = tracer.startSpan("test-srouter");
        const ctx = trace.setSpan(context.active(), testSpan);

        // set up vault ids
        const USDC_vaultId = ethers.BigNumber.from(randomUint256());
        const USDT_vaultId = ethers.BigNumber.from(randomUint256());
        const DAI_vaultId = ethers.BigNumber.from(randomUint256());
        const FRAX_vaultId = ethers.BigNumber.from(randomUint256());

        const sgOrders = await prepareOrders(
            owners,
            [USDC, USDT, DAI, FRAX],
            [USDCDecimals, USDTDecimals, DAIDecimals, FRAXDecimals],
            [USDC_vaultId, USDT_vaultId, DAI_vaultId, FRAX_vaultId],
            orderbook,
            expressionDeployer,
            true
        );

        // check that bot's balance is zero for all tokens
        assert.ok(
            (await USDT.connect(bot).balanceOf(bot.address)).isZero()
        );
        assert.ok(
            (await USDC.connect(bot).balanceOf(bot.address)).isZero()
        );
        assert.ok(
            (await DAI.connect(bot).balanceOf(bot.address)).isZero()
        );
        assert.ok(
            (await FRAX.connect(bot).balanceOf(bot.address)).isZero()
        );

        // run the clearing process
        config.rpc = process?.env?.TEST_POLYGON_RPC;
        config.shuffle = false;
        config.signer = bot;
        config.lps = ["SushiSwapV2"];
        config.interpreterv2 = false;
        config.hops = 5;
        config.bundle = true;
        const reports = await clear("srouter", config, sgOrders, undefined, tracer, ctx);

        // should have cleared 2 toke pairs bundled orders
        assert.ok(reports.length == 2);

        // validate first cleared token pair orders
        assert.equal(reports[0].tokenPair, "USDT/USDC");
        assert.equal(reports[0].clearedAmount, "200000000");
        assert.equal(reports[0].clearedOrders.length, 2);

        // check vault balances for orders in cleared token pair USDT/USDC
        assert.equal(
            (await orderbook.vaultBalance(
                owners[0].address,
                USDC.address,
                USDC_vaultId
            )).toString(),
            "0"
        );
        assert.equal(
            (await orderbook.vaultBalance(
                owners[0].address,
                USDT.address,
                USDT_vaultId
            )).toString(),
            "150000000"
        );
        assert.equal(
            (await orderbook.vaultBalance(
                owners[2].address,
                USDC.address,
                USDC_vaultId
            )).toString(),
            "0"
        );
        assert.equal(
            (await orderbook.vaultBalance(
                owners[2].address,
                USDT.address,
                USDT_vaultId
            )).toString(),
            "150000000"
        );

        // validate second cleared token pair orders
        assert.equal(reports[1].tokenPair, "DAI/USDC");
        assert.equal(reports[1].clearedAmount, "100000000");
        // assert.equal(reports[1].clearedOrders.length, 1);

        // check vault balances for orders in cleared token pair FRAX/USDC
        assert.equal(
            (await orderbook.vaultBalance(
                owners[1].address,
                USDC.address,
                USDC_vaultId
            )).toString(),
            "0"
        );
        assert.equal(
            (await orderbook.vaultBalance(
                owners[1].address,
                DAI.address,
                DAI_vaultId
            )).toString(),
            "150000000000000000000"
        );

        // bot should have received the bounty for cleared orders input token
        assert.ok(
            (await USDT.connect(bot).balanceOf(bot.address)).gt("0")
        );
        assert.ok(
            (await DAI.connect(bot).balanceOf(bot.address)).gt("0")
        );

        // should not have received any bounty for the tokens that were not part of the cleared orders input tokens
        assert.ok(
            (await USDC.connect(bot).balanceOf(bot.address)).isZero()
        );
        assert.ok(
            (await FRAX.connect(bot).balanceOf(bot.address)).isZero()
        );
        testSpan.end();
    });

    it("should clear orders in 'srouter' mode using interpreter v2", async function () {
        const testSpan = tracer.startSpan("test-srouter-int-v2");
        const ctx = trace.setSpan(context.active(), testSpan);

        // set up vault ids
        const USDC_vaultId = ethers.BigNumber.from(randomUint256());
        const USDT_vaultId = ethers.BigNumber.from(randomUint256());
        const DAI_vaultId = ethers.BigNumber.from(randomUint256());
        const FRAX_vaultId = ethers.BigNumber.from(randomUint256());

        const sgOrders = await prepareOrders(
            owners,
            [USDC, USDT, DAI, FRAX],
            [USDCDecimals, USDTDecimals, DAIDecimals, FRAXDecimals],
            [USDC_vaultId, USDT_vaultId, DAI_vaultId, FRAX_vaultId],
            orderbook,
            expressionDeployer,
            true
        );

        // check that bot's balance is zero for all tokens
        assert.ok(
            (await USDT.connect(bot).balanceOf(bot.address)).isZero()
        );
        assert.ok(
            (await USDC.connect(bot).balanceOf(bot.address)).isZero()
        );
        assert.ok(
            (await DAI.connect(bot).balanceOf(bot.address)).isZero()
        );
        assert.ok(
            (await FRAX.connect(bot).balanceOf(bot.address)).isZero()
        );

        // run the clearing process
        config.rpc = process?.env?.TEST_POLYGON_RPC;
        config.shuffle = false;
        config.signer = bot;
        config.lps = ["SushiSwapV2"];
        config.interpreterv2 = true;
        config.hops = 5;
        config.bundle = true;
        const reports = await clear("srouter", config, sgOrders, undefined, tracer, ctx);

        // should have cleared 2 toke pairs bundled orders
        assert.ok(reports.length == 2);

        // validate first cleared token pair orders
        assert.equal(reports[0].tokenPair, "USDT/USDC");
        assert.equal(reports[0].clearedAmount, "200000000");
        assert.equal(reports[0].clearedOrders.length, 2);

        // check vault balances for orders in cleared token pair USDT/USDC
        assert.equal(
            (await orderbook.vaultBalance(
                owners[0].address,
                USDC.address,
                USDC_vaultId
            )).toString(),
            "0"
        );
        assert.equal(
            (await orderbook.vaultBalance(
                owners[0].address,
                USDT.address,
                USDT_vaultId
            )).toString(),
            "150000000"
        );
        assert.equal(
            (await orderbook.vaultBalance(
                owners[2].address,
                USDC.address,
                USDC_vaultId
            )).toString(),
            "0"
        );
        assert.equal(
            (await orderbook.vaultBalance(
                owners[2].address,
                USDT.address,
                USDT_vaultId
            )).toString(),
            "150000000"
        );

        // validate second cleared token pair orders
        assert.equal(reports[1].tokenPair, "DAI/USDC");
        assert.equal(reports[1].clearedAmount, "100000000");
        // assert.equal(reports[1].clearedOrders.length, 1);

        // check vault balances for orders in cleared token pair FRAX/USDC
        assert.equal(
            (await orderbook.vaultBalance(
                owners[1].address,
                USDC.address,
                USDC_vaultId
            )).toString(),
            "0"
        );
        assert.equal(
            (await orderbook.vaultBalance(
                owners[1].address,
                DAI.address,
                DAI_vaultId
            )).toString(),
            "150000000000000000000"
        );

        // bot should have received the bounty for cleared orders input token
        assert.ok(
            (await USDT.connect(bot).balanceOf(bot.address)).gt("0")
        );
        assert.ok(
            (await DAI.connect(bot).balanceOf(bot.address)).gt("0")
        );

        // should not have received any bounty for the tokens that were not part of the cleared orders input tokens
        assert.ok(
            (await USDC.connect(bot).balanceOf(bot.address)).isZero()
        );
        assert.ok(
            (await FRAX.connect(bot).balanceOf(bot.address)).isZero()
        );
        testSpan.end();
    });
});