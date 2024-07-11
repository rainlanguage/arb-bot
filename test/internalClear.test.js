require("dotenv").config();
const { assert } = require("chai");
const { ChainId } = require("sushi");
const { ethers, network } = require("hardhat");
const { USDT, USDC } = require("sushi/currency");
const { bundleOrders } = require("../src/utils");
const { genericArbrbDeploy } = require("./deploy/arbDeploy");
const { DefaultArbEvaluable } = require("../src/abis");
const ERC20Artifact = require("./abis/ERC20Upgradeable.json");
const { deployOrderBookNPE2 } = require("./deploy/orderbookDeploy");
const { randomUint256, mockSgFromEvent, getEventArgs, encodeMeta } = require("./utils");
const { rainterpreterNPE2Deploy, rainterpreterStoreNPE2Deploy } = require("./deploy/rainterpreterDeploy");

describe.only("Rain Arb Bot Internal Clear", async function () {
    it("should clear orders against orders of other orderbook", async function () {
        // tokens to test with
        const tokens = [
            USDT[ChainId.POLYGON],
            USDC[ChainId.POLYGON],
            // DAI[ChainId.POLYGON]
        ];

        // addresses with token balance, in order with specified tokens
        const addressesWithBalance = [
            "0xF977814e90dA44bFA03b6295A0616a897441aceC",
            "0xe7804c37c13166fF0b37F5aE0BB07A3aEbb6e245",
            // "0x4aac95EBE2eA6038982566741d1860556e265F8B",
        ];

        // get bot signer
        const bot = (await ethers.getSigners())[0];

        // deploy contracts
        const interpreter = await rainterpreterNPE2Deploy();
        const store = await rainterpreterStoreNPE2Deploy();
        const orderbook0 = await deployOrderBookNPE2();
        const orderbook1 = await deployOrderBookNPE2();
        const arb = await genericArbrbDeploy(orderbook0.address);

        // set up tokens contracts and impersonate owners
        const owners = [];
        for (let i = 0; i < tokens.length; i++) {
            tokens[i].contract = await ethers.getContractAt(
                ERC20Artifact.abi,
                tokens[i].address
            );
            tokens[i].vaultId = ethers.BigNumber.from(randomUint256());
            tokens[i].depositAmount = ethers.BigNumber.from(
                (i === 0 ? "60" : "100") + "0".repeat(tokens[i].decimals)
            );
            owners.push(await ethers.getImpersonatedSigner(addressesWithBalance[i]));
            await network.provider.send(
                "hardhat_setBalance",
                [addressesWithBalance[i], "0x4563918244F40000"]
            );
        }

        // dposit and add orders for each owner and return
        // the deployed orders in format of a sg query.
        const orders = [];
        for (let i = 0; i < tokens.length; i++) {
            const currentob = i === 0 ? orderbook0 : orderbook1;
            const depositConfigStruct = {
                token: tokens[i].address,
                vaultId: tokens[i].vaultId,
                amount: tokens[i].depositAmount.toString()
            };
            await tokens[i]
                .contract
                .connect(owners[i])
                .approve(currentob.address, depositConfigStruct.amount);
            await currentob
                .connect(owners[i])
                .deposit2(
                    depositConfigStruct.token,
                    depositConfigStruct.vaultId,
                    depositConfigStruct.amount,
                    []
                );

            // ratio of 0.8 for first order
            // ratio of 0.5 for second order
            const ratioRaw = ethers.BigNumber.from((i === 0 ? "8" : "5") + "0".repeat(17)).toHexString().substring(2);
            const ratio = "0".repeat(64 - ratioRaw.length) + ratioRaw;
            const maxOutput = "f".repeat(64);
            const bytecode = `0x0000000000000000000000000000000000000000000000000000000000000002${maxOutput}${ratio}0000000000000000000000000000000000000000000000000000000000000015020000000c02020002011000000110000100000000`;
            const inputToken = i === 0 ? tokens[1] : tokens[0];
            const outputToken = i === 0 ? tokens[0] : tokens[1];
            const addOrderConfig = {
                evaluable: {
                    interpreter: interpreter.address,
                    store: store.address,
                    bytecode,
                },
                nonce: "0x" + "0".repeat(63) + "1",
                secret: "0x" + "0".repeat(63) + "1",
                validInputs: [{
                    token: inputToken.address,
                    decimals: inputToken.decimals,
                    vaultId: inputToken.vaultId
                }],
                validOutputs: [{
                    token: outputToken.address,
                    decimals: outputToken.decimals,
                    vaultId: outputToken.vaultId
                }],
                meta: encodeMeta("some_order"),
            };
            const tx = await currentob
                .connect(owners[i])
                .addOrder2(addOrderConfig, []);
            orders.push(await mockSgFromEvent(
                await getEventArgs(tx, "AddOrderV2", currentob),
                currentob,
                tokens.map(v => ({ ...v.contract, knownSymbol: v.symbol }))
            ));
        }
        const sgOrders = bundleOrders(orders, false, false);

        console.log("\nvaults before clear:");
        let ob0Token0Owner0OutputVault = await orderbook0.vaultBalance(
            owners[0].address,
            tokens[0].address,
            tokens[0].vaultId
        );
        let ob0Token1Owner0InputVault = await orderbook0.vaultBalance(
            owners[0].address,
            tokens[1].address,
            tokens[1].vaultId
        );
        let ob1Token1Owner1OutputVault = await orderbook1.vaultBalance(
            owners[1].address,
            tokens[1].address,
            tokens[1].vaultId
        );
        let ob1Token0Owner1InputVault = await orderbook1.vaultBalance(
            owners[1].address,
            tokens[0].address,
            tokens[0].vaultId
        );
        console.log("ob0, owner0, token0, output vault", ob0Token0Owner0OutputVault);
        console.log("ob0, owner0, token1, input vault", ob0Token1Owner0InputVault);
        console.log("ob1, owner1, token1, output vault", ob1Token1Owner1OutputVault);
        console.log("ob1, owner1, token0, input vault", ob1Token0Owner1InputVault);
        console.log("\n");

        assert.equal(ob0Token0Owner0OutputVault.toString(), tokens[0].depositAmount.toString());
        assert.equal(ob0Token1Owner0InputVault.toString(), "0");
        assert.equal(ob1Token1Owner1OutputVault.toString(), tokens[1].depositAmount.toString());
        assert.equal(ob1Token0Owner1InputVault.toString(), "0");

        // encode takeOrders2() with order2 ofc the other ob
        const encodedFN = orderbook1.interface.encodeFunctionData(
            "takeOrders2",
            [{
                minimumInput: ethers.constants.One,
                maximumInput: ethers.constants.MaxUint256,
                maximumIORatio: ethers.constants.MaxUint256,
                orders: [sgOrders[1].takeOrders[0].takeOrder],
                data: "0x"
            }]
        );
        const takeOrdersConfigStruct = {
            minimumInput: ethers.constants.One,
            maximumInput: ethers.constants.MaxUint256,
            maximumIORatio: ethers.constants.MaxUint256,
            orders: [sgOrders[0].takeOrders[0].takeOrder],
            data: ethers.utils.defaultAbiCoder.encode(
                ["address", "address", "bytes"],
                [orderbook1.address, orderbook1.address, encodedFN]
            )
        };

        // building and submit the transaction
        const rawtx = {
            data: arb.interface.encodeFunctionData(
                "arb2",
                [takeOrdersConfigStruct, "0", DefaultArbEvaluable]
            ),
            to: arb.address,
        };

        const tx = await bot.sendTransaction(rawtx);
        await tx.wait();

        console.log("vaults after clear:");
        ob0Token0Owner0OutputVault = await orderbook0.vaultBalance(
            owners[0].address,
            tokens[0].address,
            tokens[0].vaultId
        );
        ob0Token1Owner0InputVault = await orderbook0.vaultBalance(
            owners[0].address,
            tokens[1].address,
            tokens[1].vaultId
        );
        ob1Token1Owner1OutputVault = await orderbook1.vaultBalance(
            owners[1].address,
            tokens[1].address,
            tokens[1].vaultId
        );
        ob1Token0Owner1InputVault = await orderbook1.vaultBalance(
            owners[1].address,
            tokens[0].address,
            tokens[0].vaultId
        );
        console.log("ob0, owner0, token0, output vault", ob0Token0Owner0OutputVault);
        console.log("ob0, owner0, token1, input vault", ob0Token1Owner0InputVault);
        console.log("ob1, owner1, token1, output vault", ob1Token1Owner1OutputVault);
        console.log("ob1, owner1, token0, input vault", ob1Token0Owner1InputVault);
        console.log("\n");

        assert.equal(ob0Token0Owner0OutputVault.toString(), "0");
        assert.equal(
            ob0Token1Owner0InputVault.toString(),
            tokens[0].depositAmount.mul(8).div(10).toString()
        );
        assert.equal(ob1Token1Owner1OutputVault.toString(), "0");
        assert.equal(
            ob1Token0Owner1InputVault.toString(),
            tokens[1].depositAmount.mul(5).div(10).toString()
        );

        const botToken0Balance = await tokens[0].contract.balanceOf(bot.address);
        const botToken1Balance = await tokens[1].contract.balanceOf(bot.address);

        console.log("recieved bounty of token0", botToken0Balance);
        console.log("recieved bounty of token1", botToken1Balance);

        assert.equal(
            botToken0Balance.toString(),
            tokens[0].depositAmount.sub(tokens[1].depositAmount.mul(5).div(10)).toString()
        );
        assert.equal(
            botToken1Balance.toString(),
            tokens[1].depositAmount.sub(tokens[0].depositAmount.mul(8).div(10)).toString()
        );
    });

    it("should clear orders against orders of same orderbook", async function () {
        // tokens to test with
        const tokens = [
            USDT[ChainId.POLYGON],
            USDC[ChainId.POLYGON],
        ];

        // addresses with token balance, in order with specified tokens
        const addressesWithBalance = [
            "0xF977814e90dA44bFA03b6295A0616a897441aceC",
            "0xe7804c37c13166fF0b37F5aE0BB07A3aEbb6e245",
        ];

        // get bot signer
        const bot = (await ethers.getSigners())[1];

        // deploy contracts
        const interpreter = await rainterpreterNPE2Deploy();
        const store = await rainterpreterStoreNPE2Deploy();
        const orderbook = await deployOrderBookNPE2();
        // const arb = await genericArbrbDeploy(orderbook.address);

        // set up tokens contracts and impersonate owners
        const owners = [];
        for (let i = 0; i < tokens.length; i++) {
            tokens[i].contract = await ethers.getContractAt(
                ERC20Artifact.abi,
                tokens[i].address
            );
            tokens[i].vaultId = ethers.BigNumber.from(randomUint256());
            tokens[i].depositAmount = ethers.BigNumber.from(
                (i === 0 ? "10" : "20") + "0".repeat(tokens[i].decimals)
            );
            owners.push(await ethers.getImpersonatedSigner(addressesWithBalance[i]));
            await network.provider.send(
                "hardhat_setBalance",
                [addressesWithBalance[i], "0x4563918244F40000"]
            );
        }

        // dposit and add orders for each owner and return
        // the deployed orders in format of a sg query.
        const orders = [];
        for (let i = 0; i < tokens.length; i++) {
            const depositConfigStruct = {
                token: tokens[i].address,
                vaultId: tokens[i].vaultId,
                amount: tokens[i].depositAmount.toString()
            };
            await tokens[i]
                .contract
                .connect(owners[i])
                .approve(orderbook.address, depositConfigStruct.amount);
            await orderbook
                .connect(owners[i])
                .deposit2(
                    depositConfigStruct.token,
                    depositConfigStruct.vaultId,
                    depositConfigStruct.amount,
                    []
                );

            // ratio of 1 for first order
            // ratio of 0.5 for second order
            const ratioRaw = ethers.BigNumber.from((i === 0 ? "1" + "0".repeat(18) : "5" + "0".repeat(17))).toHexString().substring(2);
            const ratio = "0".repeat(64 - ratioRaw.length) + ratioRaw;
            const maxOutput = "f".repeat(64);
            const bytecode = `0x0000000000000000000000000000000000000000000000000000000000000002${maxOutput}${ratio}0000000000000000000000000000000000000000000000000000000000000015020000000c02020002011000000110000100000000`;
            const inputToken = i === 0 ? tokens[1] : tokens[0];
            const outputToken = i === 0 ? tokens[0] : tokens[1];
            const addOrderConfig = {
                evaluable: {
                    interpreter: interpreter.address,
                    store: store.address,
                    bytecode,
                },
                nonce: "0x" + "0".repeat(63) + "1",
                secret: "0x" + "0".repeat(63) + "1",
                validInputs: [{
                    token: inputToken.address,
                    decimals: inputToken.decimals,
                    vaultId: inputToken.vaultId
                }],
                validOutputs: [{
                    token: outputToken.address,
                    decimals: outputToken.decimals,
                    vaultId: outputToken.vaultId
                }],
                meta: encodeMeta("some_order"),
            };
            const tx = await orderbook
                .connect(owners[i])
                .addOrder2(addOrderConfig, []);
            orders.push(await mockSgFromEvent(
                await getEventArgs(tx, "AddOrderV2", orderbook),
                orderbook,
                tokens.map(v => ({ ...v.contract, knownSymbol: v.symbol }))
            ));
        }
        const sgOrders = bundleOrders(orders, false, false);

        console.log("\nvaults before clear:");
        let ob0Token0Owner0OutputVault = await orderbook.vaultBalance(
            owners[0].address,
            tokens[0].address,
            tokens[0].vaultId
        );
        let ob0Token1Owner0InputVault = await orderbook.vaultBalance(
            owners[0].address,
            tokens[1].address,
            tokens[1].vaultId
        );
        let ob1Token1Owner1OutputVault = await orderbook.vaultBalance(
            owners[1].address,
            tokens[1].address,
            tokens[1].vaultId
        );
        let ob1Token0Owner1InputVault = await orderbook.vaultBalance(
            owners[1].address,
            tokens[0].address,
            tokens[0].vaultId
        );
        console.log("owner0, token0, output vault", ob0Token0Owner0OutputVault);
        console.log("owner0, token1, input vault", ob0Token1Owner0InputVault);
        console.log("owner1, token1, output vault", ob1Token1Owner1OutputVault);
        console.log("owner1, token0, input vault", ob1Token0Owner1InputVault);
        console.log("\n");

        assert.equal(ob0Token0Owner0OutputVault.toString(), tokens[0].depositAmount.toString());
        assert.equal(ob0Token1Owner0InputVault.toString(), "0");
        assert.equal(ob1Token1Owner1OutputVault.toString(), tokens[1].depositAmount.toString());
        assert.equal(ob1Token0Owner1InputVault.toString(), "0");

        const aliceBountyVaultId = "1";
        const bobBountyVaultId = "1";
        const botToken0BalancOrg = await tokens[0].contract.balanceOf(bot.address);

        // ":ensure(greater-than-or-equal-to(sub(erc20-balance-of(token account) originalBalance) minimumSenderOutput) \"minimumSenderOutput\");"
        const taskBytecodeFailing = "0x0000000000000000000000000000000000000000000000000000000000000005"
            + tokens[0].address.substring(2).padStart(64, "0") // token
            + bot.address.substring(2).padStart(64, "0") // address
            + botToken0BalancOrg.toHexString().substring(2).padStart(64, "0") // org balance
            + ethers.BigNumber.from("6" + "0".repeat(18)).toHexString().substring(2).padStart(64, "0") // min output greater bounty
            + "936d696e696d756d53656e6465724f7574707574000000000000000000000000000000000000000000000000000000000000000000000000000000000000002b0100000905000001100004011000030110000201100001011000001112000047120000211200001d020000";

        const withdrawCallFailing = orderbook.interface.encodeFunctionData(
            "withdraw2",
            [
                tokens[0].address,
                aliceBountyVaultId,
                ethers.constants.MaxUint256.toString(),
                [{
                    evaluable: {
                        interpreter: interpreter.address,
                        store: store.address,
                        bytecode: taskBytecodeFailing,
                    },
                    signedContext: []
                }]
            ]
        );
        const clear2CallFailing = orderbook.interface.encodeFunctionData(
            "clear2",
            [
                sgOrders[0].takeOrders[0].takeOrder.order,
                sgOrders[1].takeOrders[0].takeOrder.order,
                {
                    aliceInputIOIndex: 0,
                    aliceOutputIOIndex: 0,
                    bobInputIOIndex: 0,
                    bobOutputIOIndex: 0,
                    aliceBountyVaultId: aliceBountyVaultId,
                    bobBountyVaultId: bobBountyVaultId,
                },
                [],
                []
            ]
        );
        const rawMulticallDataFailing = orderbook.interface.encodeFunctionData(
            "multicall",
            [[clear2CallFailing, withdrawCallFailing]]
        );

        // building and submit the transaction
        const rawtxFailing = {
            data: rawMulticallDataFailing,
            to: orderbook.address
        };

        try {
            const tx = await bot.sendTransaction(rawtxFailing);
            await tx.wait();
            assert.fail("expected to reject");
        } catch (error) { /**/ }

        // ":ensure(greater-than-or-equal-to(sub(erc20-balance-of(token account) originalBalance) minimumSenderOutput) \"minimumSenderOutput\");"
        const taskBytecodePassing = "0x0000000000000000000000000000000000000000000000000000000000000005"
            + tokens[0].address.substring(2).padStart(64, "0") // token
            + bot.address.substring(2).padStart(64, "0") // address
            + botToken0BalancOrg.toHexString().substring(2).padStart(64, "0") // org balance
            + ethers.BigNumber.from("5" + "0".repeat(18)).toHexString().substring(2).padStart(64, "0") // min output LTE than bounty
            + "936d696e696d756d53656e6465724f7574707574000000000000000000000000000000000000000000000000000000000000000000000000000000000000002b0100000905000001100004011000030110000201100001011000001112000047120000211200001d020000";

        const withdrawCallPassing = orderbook.interface.encodeFunctionData(
            "withdraw2",
            [
                tokens[0].address,
                aliceBountyVaultId,
                ethers.constants.MaxUint256.toString(),
                [{
                    evaluable: {
                        interpreter: interpreter.address,
                        store: store.address,
                        bytecode: taskBytecodePassing,
                    },
                    signedContext: []
                }]
            ]
        );
        const clear2CallPassing = orderbook.interface.encodeFunctionData(
            "clear2",
            [
                sgOrders[0].takeOrders[0].takeOrder.order,
                sgOrders[1].takeOrders[0].takeOrder.order,
                {
                    aliceInputIOIndex: 0,
                    aliceOutputIOIndex: 0,
                    bobInputIOIndex: 0,
                    bobOutputIOIndex: 0,
                    aliceBountyVaultId: aliceBountyVaultId,
                    bobBountyVaultId: bobBountyVaultId,
                },
                [],
                []
            ]
        );
        const rawMulticallDataPassing = orderbook.interface.encodeFunctionData(
            "multicall",
            [[clear2CallPassing, withdrawCallPassing]]
        );

        // building and submit the transaction
        const rawtxPassing = {
            data: rawMulticallDataPassing,
            to: orderbook.address
        };

        const tx = await bot.sendTransaction(rawtxPassing);
        await tx.wait();

        console.log("vaults after clear:");
        ob0Token0Owner0OutputVault = await orderbook.vaultBalance(
            owners[0].address,
            tokens[0].address,
            tokens[0].vaultId
        );
        ob0Token1Owner0InputVault = await orderbook.vaultBalance(
            owners[0].address,
            tokens[1].address,
            tokens[1].vaultId
        );
        ob1Token1Owner1OutputVault = await orderbook.vaultBalance(
            owners[1].address,
            tokens[1].address,
            tokens[1].vaultId
        );
        ob1Token0Owner1InputVault = await orderbook.vaultBalance(
            owners[1].address,
            tokens[0].address,
            tokens[0].vaultId
        );
        console.log("owner0, token0, output vault", ob0Token0Owner0OutputVault);
        console.log("owner0, token1, input vault", ob0Token1Owner0InputVault);
        console.log("owner1, token1, output vault", ob1Token1Owner1OutputVault);
        console.log("owner1, token0, input vault", ob1Token0Owner1InputVault);
        console.log("\n");

        assert.equal(ob0Token0Owner0OutputVault.toString(), "0");
        assert.equal(ob0Token1Owner0InputVault.toString(), "10000000");
        assert.equal(ob1Token1Owner1OutputVault.toString(), "10000000");
        assert.equal(ob1Token0Owner1InputVault.toString(), "5000000");

        const botVaultToken0 = await orderbook.vaultBalance(
            bot.address,
            tokens[0].address,
            aliceBountyVaultId
        );
        const botVaultToken1 = await orderbook.vaultBalance(
            bot.address,
            tokens[1].address,
            bobBountyVaultId
        );
        assert.equal(botVaultToken0.toString(), "0");
        assert.equal(botVaultToken1.toString(), "0");

        const botToken0Balance = await tokens[0].contract.balanceOf(bot.address);
        const botToken1Balance = await tokens[1].contract.balanceOf(bot.address);

        console.log("withdrawn bounty of token0", botToken0Balance);
        console.log("withdrawn bounty of token1", botToken1Balance);

        assert.equal(botToken0Balance.toString(), "5000000");
        assert.equal(botToken1Balance.toString(), "0");
    });
});
