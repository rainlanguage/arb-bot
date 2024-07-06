require("dotenv").config();
const { assert } = require("chai");
const { ChainId } = require("sushi");
const { ethers, network } = require("hardhat");
const { USDT, USDC } = require("sushi/currency");
const { bundleOrders } = require("../src/utils");
const { genericArbrbDeploy } = require("./deploy/arbDeploy");
const { DefaultArbEvaluable } = require("../src/abis");
const ERC20Artifact = require("./abis/ERC20Upgradeable.json");
const helpers = require("@nomicfoundation/hardhat-network-helpers");
const { deployOrderBookNPE2 } = require("./deploy/orderbookDeploy");
const { randomUint256, mockSgFromEvent, getEventArgs, encodeMeta } = require("./utils");
const { rainterpreterNPE2Deploy, rainterpreterStoreNPE2Deploy } = require("./deploy/rainterpreterDeploy");

describe("Rain Arb Bot Internal Clear", async function () {
    it("should clear orders against orders of other orderbook", async function () {
        // fork rpc url
        const rpc = process?.env?.TEST_POLYGON_RPC;

        // block number of fork network
        const blockNumber = 56738134;

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

        // reset network before each test
        await helpers.reset(rpc, blockNumber);

        // get bot signer
        const bot = await ethers.getImpersonatedSigner("0x22025257BeF969A81eDaC0b343ce82d777931327");
        await network.provider.send("hardhat_setBalance", [bot.address, "0x4563918244F40000"]);

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
});
