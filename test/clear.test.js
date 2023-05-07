const { assert } = require("chai");
const { clear } = require("../src");
const { ethers } = require("hardhat");
const CONFIG = require("../config.json");
const { zeroExCloneDeploy } = require("./deploy/arbDeploy");
const ERC20Artifact = require("./abis/ERC20Upgradeable.json");
const { deployOrderBook } = require("./deploy/orderbookDeploy");
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


// This test runs on hardhat forked network of polygon using 0x live quotes from polygon mainnet
describe("Rain Arb Bot Test", async function () {
    let interpreter,
        store,
        expressionDeployer,
        orderbook,
        arb,
        USDT,
        USDTDecimals,
        USDC,
        USDCDecimals,
        FRAX,
        FRAXDecimals,
        DAI,
        DAIDecimals,
        bot,
        owners,
        config;

    before(async() => {
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
        arb = await zeroExCloneDeploy(
            expressionDeployer,
            orderbook.address,
            config.proxyAddress,
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
            to: FRAXHolder.address
        });
        for (let i = 0; i < 3; i++) {
            await USDT.connect(USDTHolder).transfer(owners[i].address, "1000" + "0".repeat(USDTDecimals));
            await USDC.connect(USDCHolder).transfer(owners[i].address, "1000" + "0".repeat(USDCDecimals));
            await DAI.connect(DAIHolder).transfer(owners[i].address, "1000" + "0".repeat(DAIDecimals));
            await FRAX.connect(FRAXHolder).transfer(owners[i].address, "1000" + "0".repeat(FRAXDecimals));
        }
    });

    it("should bundle and clear orders successfully", async function () {

        // set up vault ids
        const USDC_vaultId = ethers.BigNumber.from(randomUint256());
        const USDT_vaultId = ethers.BigNumber.from(randomUint256());
        const DAI_vaultId = ethers.BigNumber.from(randomUint256());
        const FRAX_vaultId = ethers.BigNumber.from(randomUint256());

        // topping up owners 1 2 3 vaults with 100 of each token
        for (let i = 0; i < 3; i++) {
            const depositConfigStruct = {
                token: USDC.address,
                vaultId: USDC_vaultId,
                amount: "100" + "0".repeat(USDCDecimals),
            };
            await USDC
                .connect(owners[i])
                .approve(orderbook.address, depositConfigStruct.amount);
            await orderbook
                .connect(owners[i])
                .deposit(depositConfigStruct);
        }
        for (let i = 0; i < 3; i++) {
            const depositConfigStruct = {
                token: USDT.address,
                vaultId: USDT_vaultId,
                amount: "100" + "0".repeat(USDTDecimals),
            };
            await USDT
                .connect(owners[i])
                .approve(orderbook.address, depositConfigStruct.amount);
            await orderbook
                .connect(owners[i])
                .deposit(depositConfigStruct);
        }
        for (let i = 0; i < 3; i++) {
            const depositConfigStruct = {
                token: DAI.address,
                vaultId: DAI_vaultId,
                amount: "100" + "0".repeat(DAIDecimals),
            };
            await DAI
                .connect(owners[i])
                .approve(orderbook.address, depositConfigStruct.amount);
            await orderbook
                .connect(owners[i])
                .deposit(depositConfigStruct);
        }
        for (let i = 0; i < 3; i++) {
            const depositConfigStruct = {
                token: FRAX.address,
                vaultId: FRAX_vaultId,
                amount: "100" + "0".repeat(FRAXDecimals),
            };
            await FRAX
                .connect(owners[i])
                .approve(orderbook.address, depositConfigStruct.amount);
            await orderbook
                .connect(owners[i])
                .deposit(depositConfigStruct);
        }

        const sgOrders = [];
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
                { token: USDT.address, decimals: USDTDecimals, vaultId: USDT_vaultId },
                { token: DAI.address, decimals: DAIDecimals, vaultId: DAI_vaultId },
            ],
            validOutputs: [
                { token: USDC.address, decimals: USDCDecimals, vaultId: USDC_vaultId },
            ],
            evaluableConfig: EvaluableConfig,
            meta: encodeMeta("owner1_order1"),
        };
        const tx_owner1_order1 = await orderbook.connect(owners[0]).addOrder(owner1_order1);
        sgOrders.push(await mockSgFromEvent(
            await getEventArgs(
                tx_owner1_order1,
                "AddOrder",
                orderbook
            ),
            orderbook,
            [USDT, USDC, DAI, FRAX]
        ));

        const owner1_order2 = {
            validInputs: [
                { token: FRAX.address, decimals: FRAXDecimals, vaultId: FRAX_vaultId },
            ],
            validOutputs: [
                { token: USDC.address, decimals: USDCDecimals, vaultId: USDC_vaultId },
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
            [USDT, USDC, DAI, FRAX]
        ));

        const owner2_order1 = {
            validInputs: [
                { token: FRAX.address, decimals: FRAXDecimals, vaultId: FRAX_vaultId },
            ],
            validOutputs: [
                { token: USDC.address, decimals: USDCDecimals, vaultId: USDC_vaultId },
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
            [USDT, USDC, DAI, FRAX]
        ));

        const owner3_order1 = {
            validInputs: [
                { token: USDT.address, decimals: USDTDecimals, vaultId: USDT_vaultId },
            ],
            validOutputs: [
                { token: USDC.address, decimals: USDCDecimals, vaultId: USDC_vaultId },
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
            [USDT, USDC, DAI, FRAX]
        ));

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
        config.interpreterAbi = "../test/abis/IInterpreterV1.json";
        config.arbAbi = "../test/abis/ZeroExOrderBookFlashBorrower.json";
        const reports = await clear(bot, config, sgOrders, "0.1", false);

        // should have cleared 2 toke pairs bundled orders
        assert.ok(reports.length == 2);

        // validate first cleared token pair orders
        assert.equal(reports[0].tokenPair, "USDT/USDC");
        assert.equal(reports[0].clearedAmount, "180000000");
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
            "20000000"
        );
        assert.equal(
            (await orderbook.vaultBalance(
                owners[2].address,
                USDT.address,
                USDT_vaultId
            )).toString(),
            "140000000"
        );

        // validate second cleared token pair orders
        assert.equal(reports[1].tokenPair, "FRAX/USDC");
        assert.equal(reports[1].clearedAmount, "90000000");
        assert.equal(reports[1].clearedOrders.length, 1);

        // check vault balances for orders in cleared token pair FRAX/USDC
        assert.equal(
            (await orderbook.vaultBalance(
                owners[1].address,
                USDC.address,
                USDC_vaultId
            )).toString(),
            "10000000"
        );
        assert.equal(
            (await orderbook.vaultBalance(
                owners[1].address,
                FRAX.address,
                FRAX_vaultId
            )).toString(),
            "145000000000000000000"
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
});
