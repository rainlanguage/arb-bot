require("dotenv").config();
const { assert } = require("chai");
const { clear } = require("../src");
const { ethers } = require("hardhat");
const CONFIG = require("../config.json");
const { arbDeploy } = require("./deploy/arbDeploy");
const ERC20Artifact = require("./abis/ERC20Upgradeable.json");
const { deployOrderBook } = require("./deploy/orderbookDeploy");
const helpers = require("@nomicfoundation/hardhat-network-helpers");
const { rainterpreterExpressionDeployerDeploy } = require("./deploy/expressionDeployer");
const { rainterpreterDeploy, rainterpreterStoreDeploy } = require("./deploy/rainterpreterDeploy");
const {
    encodeMeta,
    getEventArgs,
    randomUint256,
    mockSgFromEvent,
    AddressWithBalance,
    generateEvaluableConfig
} = require("./utils");


// This test runs on hardhat forked network of polygon
describe("Rain Arb Bot Tests", async function () {
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

    beforeEach(async() => {
        // reset network before each test
        await helpers.reset("https://polygon-rpc.com/", 42314555);

        [bot, ...owners] = await ethers.getSigners();
        config = CONFIG.find(async(v) => v.chainId === await bot.getChainId());

        // deploy contracts
        interpreter = await rainterpreterDeploy();
        store = await rainterpreterStoreDeploy();
        expressionDeployer = await rainterpreterExpressionDeployerDeploy(
            interpreter,
            store
        );
        orderbook = await deployOrderBook(expressionDeployer);
        arb = await arbDeploy(
            expressionDeployer,
            orderbook.address,
            generateEvaluableConfig(
                expressionDeployer,
                {
                    constants: [bot.address],
                    sources: ["0x000c0001000c0000000400000027000000170001"]
                }
            )
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
    });

    it("should clear orders using RouteProcessor3 contract", async function () {

        // set up vault ids
        const USDC_vaultId = ethers.BigNumber.from(randomUint256());
        const USDT_vaultId = ethers.BigNumber.from(randomUint256());
        const DAI_vaultId = ethers.BigNumber.from(randomUint256());
        const BUSD_vaultId = ethers.BigNumber.from(randomUint256());

        const sgOrders = await prepareOrders(
            owners,
            [USDC, USDT, DAI, BUSD],
            [USDCDecimals, USDTDecimals, DAIDecimals, BUSDDecimals],
            [USDC_vaultId, USDT_vaultId, DAI_vaultId, BUSD_vaultId],
            orderbook,
            expressionDeployer
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
            (await BUSD.connect(bot).balanceOf(bot.address)).isZero()
        );

        // run the clearing process
        config.rpc = "test";
        config.signer = bot;
        config.lps = ["quickswap", "uniswapv2", "uniswapv3"];
        const reports = await clear("router", config, sgOrders, {prioritization: false});

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
        assert.equal(reports[1].tokenPair, "BUSD/USDC");
        assert.equal(reports[1].clearedAmount, "100000000");
        assert.equal(reports[1].clearedOrders.length, 1);

        // check vault balances for orders in cleared token pair BUSD/USDC
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
                BUSD.address,
                BUSD_vaultId
            )).toString(),
            "150000000000000000000"
        );

        // bot should have received the bounty for cleared orders input token
        assert.ok(
            (await USDT.connect(bot).balanceOf(bot.address)).gt("0")
        );
        assert.ok(
            (await BUSD.connect(bot).balanceOf(bot.address)).gt("0")
        );

        // should not have received any bounty for the tokens that were not part of the cleared orders input tokens
        assert.ok(
            (await USDC.connect(bot).balanceOf(bot.address)).isZero()
        );
        assert.ok(
            (await DAI.connect(bot).balanceOf(bot.address)).isZero()
        );
    });

    it("should clear orders using Curve.fi platform liquidity", async function () {

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
            expressionDeployer
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
        config.rpc = "test";
        config.signer = bot;
        config.lps = ["SushiSwapV2"];
        const reports = await clear("curve", config, sgOrders, {prioritization: false});

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
        assert.equal(reports[1].tokenPair, "FRAX/USDC");
        assert.equal(reports[1].clearedAmount, "100000000");
        assert.equal(reports[1].clearedOrders.length, 1);

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
                FRAX.address,
                FRAX_vaultId
            )).toString(),
            "150000000000000000000"
        );

        // bot should have received the bounty for cleared orders input token
        assert.ok(
            (await USDT.connect(bot).balanceOf(bot.address)).gt("0")
        );
        assert.ok(
            (await FRAX.connect(bot).balanceOf(bot.address)).gt("0")
        );

        // should not have received any bounty for the tokens that were not part of the cleared orders input tokens
        assert.ok(
            (await USDC.connect(bot).balanceOf(bot.address)).isZero()
        );
        assert.ok(
            (await DAI.connect(bot).balanceOf(bot.address)).isZero()
        );
    });

    // uses 0x live quotes from polygon mainnet and requires 0x api key set in .env
    // uncomment for testing
    // it("should clear orders using 0x platform", async function () {

    //     // set up vault ids
    //     const USDC_vaultId = ethers.BigNumber.from(randomUint256());
    //     const USDT_vaultId = ethers.BigNumber.from(randomUint256());
    //     const DAI_vaultId = ethers.BigNumber.from(randomUint256());
    //     const BUSD_vaultId = ethers.BigNumber.from(randomUint256());

    //     const sgOrders = await prepareOrders(
    //         owners,
    //         [USDC, USDT, DAI, BUSD],
    //         [USDCDecimals, USDTDecimals, DAIDecimals, BUSDDecimals],
    //         [USDC_vaultId, USDT_vaultId, DAI_vaultId, BUSD_vaultId],
    //         orderbook,
    //         expressionDeployer
    //     );

    //     // check that bot's balance is zero for all tokens
    //     assert.ok(
    //         (await USDT.connect(bot).balanceOf(bot.address)).isZero()
    //     );
    //     assert.ok(
    //         (await USDC.connect(bot).balanceOf(bot.address)).isZero()
    //     );
    //     assert.ok(
    //         (await DAI.connect(bot).balanceOf(bot.address)).isZero()
    //     );
    //     assert.ok(
    //         (await BUSD.connect(bot).balanceOf(bot.address)).isZero()
    //     );

    //     // run the clearing process
    //     config.apiKey = process?.env?.API_KEY;
    //     config.signer = bot;
    //     const reports = await clear("0x", config, sgOrders, {prioritization: false});

    //     // should have cleared 2 toke pairs bundled orders
    //     assert.ok(reports.length == 2);

    //     // validate first cleared token pair orders
    //     assert.equal(reports[0].tokenPair, "USDT/USDC");
    //     assert.equal(reports[0].clearedAmount, "200000000");
    //     assert.equal(reports[0].clearedOrders.length, 2);

    //     // check vault balances for orders in cleared token pair USDT/USDC
    //     assert.equal(
    //         (await orderbook.vaultBalance(
    //             owners[0].address,
    //             USDC.address,
    //             USDC_vaultId
    //         )).toString(),
    //         "0"
    //     );
    //     assert.equal(
    //         (await orderbook.vaultBalance(
    //             owners[0].address,
    //             USDT.address,
    //             USDT_vaultId
    //         )).toString(),
    //         "150000000"
    //     );
    //     assert.equal(
    //         (await orderbook.vaultBalance(
    //             owners[2].address,
    //             USDC.address,
    //             USDC_vaultId
    //         )).toString(),
    //         "0"
    //     );
    //     assert.equal(
    //         (await orderbook.vaultBalance(
    //             owners[2].address,
    //             USDT.address,
    //             USDT_vaultId
    //         )).toString(),
    //         "150000000"
    //     );

    //     // validate second cleared token pair orders
    //     assert.equal(reports[1].tokenPair, "BUSD/USDC");
    //     assert.equal(reports[1].clearedAmount, "100000000");
    //     assert.equal(reports[1].clearedOrders.length, 1);

    //     // check vault balances for orders in cleared token pair BUSD/USDC
    //     assert.equal(
    //         (await orderbook.vaultBalance(
    //             owners[1].address,
    //             USDC.address,
    //             USDC_vaultId
    //         )).toString(),
    //         "0"
    //     );
    //     assert.equal(
    //         (await orderbook.vaultBalance(
    //             owners[1].address,
    //             BUSD.address,
    //             BUSD_vaultId
    //         )).toString(),
    //         "150000000000000000000"
    //     );

    //     // bot should have received the bounty for cleared orders input token
    //     assert.ok(
    //         (await USDT.connect(bot).balanceOf(bot.address)).gt("0")
    //     );
    //     assert.ok(
    //         (await BUSD.connect(bot).balanceOf(bot.address)).gt("0")
    //     );

    //     // should not have received any bounty for the tokens that were not part of the cleared orders input tokens
    //     assert.ok(
    //         (await USDC.connect(bot).balanceOf(bot.address)).isZero()
    //     );
    //     assert.ok(
    //         (await DAI.connect(bot).balanceOf(bot.address)).isZero()
    //     );
    // });
});

// prepare orders by adding orders and topping up the vault balances and return mocked sg results
const prepareOrders = async(
    owners,
    tokens,
    tokensDecimals,
    vaultIds,
    orderbook,
    expressionDeployer
) => {
    // topping up owners 1 2 3 vaults with 100 of each token
    for (let i = 0; i < 3; i++) {
        const depositConfigStruct = {
            token: tokens[0].address,
            vaultId: vaultIds[0],
            amount: "100" + "0".repeat(tokensDecimals[0]),
        };
        await tokens[0]
            .connect(owners[i])
            .approve(orderbook.address, depositConfigStruct.amount);
        await orderbook
            .connect(owners[i])
            .deposit(depositConfigStruct);
    }
    for (let i = 0; i < 3; i++) {
        const depositConfigStruct = {
            token: tokens[1].address,
            vaultId: vaultIds[1],
            amount: "100" + "0".repeat(tokensDecimals[1]),
        };
        await tokens[1]
            .connect(owners[i])
            .approve(orderbook.address, depositConfigStruct.amount);
        await orderbook
            .connect(owners[i])
            .deposit(depositConfigStruct);
    }
    for (let i = 0; i < 3; i++) {
        const depositConfigStruct = {
            token: tokens[2].address,
            vaultId: vaultIds[2],
            amount: "100" + "0".repeat(tokensDecimals[2]),
        };
        await tokens[2]
            .connect(owners[i])
            .approve(orderbook.address, depositConfigStruct.amount);
        await orderbook
            .connect(owners[i])
            .deposit(depositConfigStruct);
    }
    for (let i = 0; i < 3; i++) {
        const depositConfigStruct = {
            token: tokens[3].address,
            vaultId: vaultIds[3],
            amount: "100" + "0".repeat(tokensDecimals[3]),
        };
        await tokens[3]
            .connect(owners[i])
            .approve(orderbook.address, depositConfigStruct.amount);
        await orderbook
            .connect(owners[i])
            .deposit(depositConfigStruct);
    }

    const sgOrders = [];
    // order expression config
    const expConfig = {
        constants: [
            ethers.constants.MaxUint256.toHexString(),  // max output
            "5" + "0".repeat(17)                        // ratio 0.5, for testing purpose to ensure clearance
        ],
        sources: ["0x000c0001000c0003", "0x"]
    };

    const EvaluableConfig = generateEvaluableConfig(
        expressionDeployer,
        expConfig
    );

    // add orders
    const owner1_order1 = {
        validInputs: [
            { token: tokens[1].address, decimals: tokensDecimals[1], vaultId: vaultIds[1] },
            { token: tokens[2].address, decimals: tokensDecimals[2], vaultId: vaultIds[2] },
        ],
        validOutputs: [
            { token: tokens[0].address, decimals: tokensDecimals[0], vaultId: vaultIds[0] },
        ],
        evaluableConfig: EvaluableConfig,
        meta: encodeMeta("owner1_order1"),
    };
    const tx_owner1_order1 = await orderbook.connect(owners[0]).addOrder(owner1_order1);
    // get sg-like order details from tx event
    sgOrders.push(await mockSgFromEvent(
        await getEventArgs(
            tx_owner1_order1,
            "AddOrder",
            orderbook
        ),
        orderbook,
        [tokens[1], tokens[0], tokens[2], tokens[3]]
    ));

    const owner1_order2 = {
        validInputs: [
            { token: tokens[3].address, decimals: tokensDecimals[3], vaultId: vaultIds[3] },
        ],
        validOutputs: [
            { token: tokens[0].address, decimals: tokensDecimals[0], vaultId: vaultIds[0] },
        ],
        evaluableConfig: EvaluableConfig,
        meta: encodeMeta("owner1_order2"),
    };
    const tx_owner1_order2 = await orderbook.connect(owners[0]).addOrder(owner1_order2);
    sgOrders.push(await mockSgFromEvent(
        await getEventArgs(
            tx_owner1_order2,
            "AddOrder",
            orderbook
        ),
        orderbook,
        [tokens[1], tokens[0], tokens[2], tokens[3]]
    ));

    const owner2_order1 = {
        validInputs: [
            { token: tokens[3].address, decimals: tokensDecimals[3], vaultId: vaultIds[3] },
        ],
        validOutputs: [
            { token: tokens[0].address, decimals: tokensDecimals[0], vaultId: vaultIds[0] },
        ],
        evaluableConfig: EvaluableConfig,
        meta: encodeMeta("owner2_order1"),
    };
    const tx_owner2_order1 = await orderbook.connect(owners[1]).addOrder(owner2_order1);
    sgOrders.push(await mockSgFromEvent(
        await getEventArgs(
            tx_owner2_order1,
            "AddOrder",
            orderbook
        ),
        orderbook,
        [tokens[1], tokens[0], tokens[2], tokens[3]]
    ));

    const owner3_order1 = {
        validInputs: [
            { token: tokens[1].address, decimals: tokensDecimals[1], vaultId: vaultIds[1] },
        ],
        validOutputs: [
            { token: tokens[0].address, decimals: tokensDecimals[0], vaultId: vaultIds[0] },
        ],
        evaluableConfig: EvaluableConfig,
        meta: encodeMeta("owner3_order1"),
    };
    const tx_owner3_order1 = await orderbook.connect(owners[2]).addOrder(owner3_order1);
    sgOrders.push(await mockSgFromEvent(
        await getEventArgs(
            tx_owner3_order1,
            "AddOrder",
            orderbook
        ),
        orderbook,
        [tokens[1], tokens[0], tokens[2], tokens[3]]
    ));

    return sgOrders;
};