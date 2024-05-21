const { assert } = require("chai");
const { ethers, viem, network } = require("hardhat");
const ERC20Artifact = require("./abis/ERC20Upgradeable.json");
const { bundleOrders, getVaultBalance } = require("../src/utils");
const { deployOrderBookNPE2 } = require("./deploy/orderbookDeploy");
const { rainterpreterExpressionDeployerNPE2Deploy } = require("./deploy/expressionDeployer");
const { rainterpreterNPE2Deploy, rainterpreterStoreNPE2Deploy, rainterpreterParserNPE2Deploy } = require("./deploy/rainterpreterDeploy");

describe("Test order details", async function () {
    const order1 = {
        orderJSONString: "{\"owner\":\"0x0f47a0c7f86a615606ca315ad83c3e302b474bd6\",\"handleIo\":false,\"evaluable\":{\"interpreter\":\"0x1efd85e6c384fad9b80c6d508e9098eb91c4ed30\",\"store\":\"0x4ffc97bfb6dfce289f9b2a4083f5f5e940c8b88d\",\"expression\":\"0x224f9ca76a6f1b3414280bed0f68227c1b61f2b2\"},\"validInputs\":[{\"token\":\"0xc2132d05d31c914a87c6611c10748aeb04b58e8f\",\"decimals\":\"6\",\"vaultId\":\"0xdce98e3a7ee4b8b7ec1def4542b220083f8c3f0d569f142752cdc5bad6e14092\"}],\"validOutputs\":[{\"token\":\"0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270\",\"decimals\":\"18\",\"vaultId\":\"0xdce98e3a7ee4b8b7ec1def4542b220083f8c3f0d569f142752cdc5bad6e14092\"}]}",
        id: "0x004349d76523bce3b6aeec93cf4c2a396b9cb71bc07f214e271cab363a0c89eb",
        validInputs: [{
            token: {
                id: "0xc2132d05d31c914a87c6611c10748aeb04b58e8f",
                decimals: 6,
                symbol: "USDT"
            }
        }],
        validOutputs: [{
            token: {
                id: "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270",
                decimals: 18,
                symbol: "WMATIC",
            }
        }]
    };
    const orderStruct1 = JSON.parse(order1.orderJSONString);

    const order2 = {
        orderJSONString: "{\"owner\":\"0x0eb840e5acd0125853ad630663d3a62e673c22e6\",\"handleIo\":false,\"evaluable\":{\"interpreter\":\"0x1efd85e6c384fad9b80c6d508e9098eb91c4ed30\",\"store\":\"0x4ffc97bfb6dfce289f9b2a4083f5f5e940c8b88d\",\"expression\":\"0xcc2de1bec57eb64004bcf28cc7cc3c62c4cc574b\"},\"validInputs\":[{\"token\":\"0xc2132d05d31c914a87c6611c10748aeb04b58e8f\",\"decimals\":\"6\",\"vaultId\":\"0xce7cff94ca97c481063dae48cfb378eb4dd3c6b935aef16c2397624c300045fb\"},{\"token\":\"0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270\",\"decimals\":\"18\",\"vaultId\":\"0xce7cff94ca97c481063dae48cfb378eb4dd3c6b935aef16c2397624c300045fb\"}],\"validOutputs\":[{\"token\":\"0xc2132d05d31c914a87c6611c10748aeb04b58e8f\",\"decimals\":\"6\",\"vaultId\":\"0xce7cff94ca97c481063dae48cfb378eb4dd3c6b935aef16c2397624c300045fb\"},{\"token\":\"0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270\",\"decimals\":\"18\",\"vaultId\":\"0xce7cff94ca97c481063dae48cfb378eb4dd3c6b935aef16c2397624c300045fb\"}]}",
        id: "0x008817a4b6f264326ef14357df54e48b9c064051f54f3877807970bb98096c01",
        validInputs: [
            {
                token: {
                    id: "0xc2132d05d31c914a87c6611c10748aeb04b58e8f",
                    decimals: 6,
                    symbol: "USDT"
                }
            },
            {
                token: {
                    id: "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270",
                    decimals: 18,
                    symbol: "WMATIC",
                }
            }
        ],
        validOutputs: [
            {
                token: {
                    id: "0xc2132d05d31c914a87c6611c10748aeb04b58e8f",
                    decimals: 6,
                    symbol: "USDT"
                }
            },
            {
                token: {
                    id: "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270",
                    decimals: 18,
                    symbol: "WMATIC",
                }
            }
        ]
    };
    const orderStruct2 = JSON.parse(order2.orderJSONString);

    it("should return correct order details", async function () {
        const unbundledResult = bundleOrders([order1, order2], false, false);
        const unbundledExpected = [
            {
                buyToken: orderStruct1.validInputs[0].token,
                buyTokenSymbol: order1.validInputs[0].token.symbol,
                buyTokenDecimals: orderStruct1.validInputs[0].decimals,
                sellToken: orderStruct1.validOutputs[0].token,
                sellTokenSymbol: order1.validOutputs[0].token.symbol,
                sellTokenDecimals: orderStruct1.validOutputs[0].decimals,
                takeOrders: [{
                    id: order1.id,
                    takeOrder: {
                        order: {
                            owner: orderStruct1.owner,
                            handleIO: orderStruct1.handleIo,
                            evaluable: orderStruct1.evaluable,
                            validInputs: orderStruct1.validInputs,
                            validOutputs: orderStruct1.validOutputs
                        },
                        inputIOIndex: 0,
                        outputIOIndex: 0,
                        signedContext: []
                    }
                }]
            },
            {
                buyToken: orderStruct2.validInputs[1].token,
                buyTokenSymbol: order2.validInputs[1].token.symbol,
                buyTokenDecimals: orderStruct2.validInputs[1].decimals,
                sellToken: orderStruct2.validOutputs[0].token,
                sellTokenSymbol: order2.validOutputs[0].token.symbol,
                sellTokenDecimals: orderStruct2.validOutputs[0].decimals,
                takeOrders: [{
                    id: order2.id,
                    takeOrder: {
                        order: {
                            owner: orderStruct2.owner,
                            handleIO: orderStruct2.handleIo,
                            evaluable: orderStruct2.evaluable,
                            validInputs: orderStruct2.validInputs,
                            validOutputs: orderStruct2.validOutputs
                        },
                        inputIOIndex: 1,
                        outputIOIndex: 0,
                        signedContext: []
                    }
                }]
            },
            {
                buyToken: orderStruct2.validInputs[0].token,
                buyTokenSymbol: order2.validInputs[0].token.symbol,
                buyTokenDecimals: orderStruct2.validInputs[0].decimals,
                sellToken: orderStruct2.validOutputs[1].token,
                sellTokenSymbol: order2.validOutputs[1].token.symbol,
                sellTokenDecimals: orderStruct2.validOutputs[1].decimals,
                takeOrders: [{
                    id: order2.id,
                    takeOrder: {
                        order: {
                            owner: orderStruct2.owner,
                            handleIO: orderStruct2.handleIo,
                            evaluable: orderStruct2.evaluable,
                            validInputs: orderStruct2.validInputs,
                            validOutputs: orderStruct2.validOutputs
                        },
                        inputIOIndex: 0,
                        outputIOIndex: 1,
                        signedContext: []
                    }
                }]
            },
        ];
        assert.deepEqual(unbundledResult, unbundledExpected);

        const bundledResult = bundleOrders([order1, order2], false, true);
        const bundledExpected = [
            {
                buyToken: orderStruct1.validInputs[0].token,
                buyTokenSymbol: order1.validInputs[0].token.symbol,
                buyTokenDecimals: orderStruct1.validInputs[0].decimals,
                sellToken: orderStruct1.validOutputs[0].token,
                sellTokenSymbol: order1.validOutputs[0].token.symbol,
                sellTokenDecimals: orderStruct1.validOutputs[0].decimals,
                takeOrders: [
                    {
                        id: order1.id,
                        takeOrder: {
                            order: {
                                owner: orderStruct1.owner,
                                handleIO: orderStruct1.handleIo,
                                evaluable: orderStruct1.evaluable,
                                validInputs: orderStruct1.validInputs,
                                validOutputs: orderStruct1.validOutputs
                            },
                            inputIOIndex: 0,
                            outputIOIndex: 0,
                            signedContext: []
                        }
                    },
                    {
                        id: order2.id,
                        takeOrder: {
                            order: {
                                owner: orderStruct2.owner,
                                handleIO: orderStruct2.handleIo,
                                evaluable: orderStruct2.evaluable,
                                validInputs: orderStruct2.validInputs,
                                validOutputs: orderStruct2.validOutputs
                            },
                            inputIOIndex: 0,
                            outputIOIndex: 1,
                            signedContext: []
                        }
                    }
                ]
            },
            {
                buyToken: orderStruct2.validInputs[1].token,
                buyTokenSymbol: order2.validInputs[1].token.symbol,
                buyTokenDecimals: orderStruct2.validInputs[1].decimals,
                sellToken: orderStruct2.validOutputs[0].token,
                sellTokenSymbol: order2.validOutputs[0].token.symbol,
                sellTokenDecimals: orderStruct2.validOutputs[0].decimals,
                takeOrders: [{
                    id: order2.id,
                    takeOrder: {
                        order: {
                            owner: orderStruct2.owner,
                            handleIO: orderStruct2.handleIo,
                            evaluable: orderStruct2.evaluable,
                            validInputs: orderStruct2.validInputs,
                            validOutputs: orderStruct2.validOutputs
                        },
                        inputIOIndex: 1,
                        outputIOIndex: 0,
                        signedContext: []
                    }
                }]
            },
        ];
        assert.deepEqual(bundledResult, bundledExpected);
    });

    it("should correctly handle handleIo/handleIO key", async function () {
        const orderWithHandleIoKey = {
            orderJSONString: "{\"owner\":\"0x0f47a0c7f86a615606ca315ad83c3e302b474bd6\",\"handleIo\":true,\"evaluable\":{\"interpreter\":\"0x1efd85e6c384fad9b80c6d508e9098eb91c4ed30\",\"store\":\"0x4ffc97bfb6dfce289f9b2a4083f5f5e940c8b88d\",\"expression\":\"0x224f9ca76a6f1b3414280bed0f68227c1b61f2b2\"},\"validInputs\":[{\"token\":\"0xc2132d05d31c914a87c6611c10748aeb04b58e8f\",\"decimals\":\"6\",\"vaultId\":\"0xdce98e3a7ee4b8b7ec1def4542b220083f8c3f0d569f142752cdc5bad6e14092\"}],\"validOutputs\":[{\"token\":\"0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270\",\"decimals\":\"18\",\"vaultId\":\"0xdce98e3a7ee4b8b7ec1def4542b220083f8c3f0d569f142752cdc5bad6e14092\"}]}",
            id: "0x004349d76523bce3b6aeec93cf4c2a396b9cb71bc07f214e271cab363a0c89eb",
            validInputs: [{
                token: {
                    id: "0xc2132d05d31c914a87c6611c10748aeb04b58e8f",
                    decimals: 6,
                    symbol: "USDT"
                }
            }],
            validOutputs: [{
                token: {
                    id: "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270",
                    decimals: 18,
                    symbol: "WMATIC",
                }
            }]
        };
        const orderWithHandleIOKey = {
            orderJSONString: "{\"owner\":\"0x0f47a0c7f86a615606ca315ad83c3e302b474bd6\",\"handleIO\":true,\"evaluable\":{\"interpreter\":\"0x1efd85e6c384fad9b80c6d508e9098eb91c4ed30\",\"store\":\"0x4ffc97bfb6dfce289f9b2a4083f5f5e940c8b88d\",\"expression\":\"0x224f9ca76a6f1b3414280bed0f68227c1b61f2b2\"},\"validInputs\":[{\"token\":\"0xc2132d05d31c914a87c6611c10748aeb04b58e8f\",\"decimals\":\"6\",\"vaultId\":\"0xdce98e3a7ee4b8b7ec1def4542b220083f8c3f0d569f142752cdc5bad6e14092\"}],\"validOutputs\":[{\"token\":\"0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270\",\"decimals\":\"18\",\"vaultId\":\"0xdce98e3a7ee4b8b7ec1def4542b220083f8c3f0d569f142752cdc5bad6e14092\"}]}",
            id: "0x004349d76523bce3b6aeec93cf4c2a396b9cb71bc07f214e271cab363a0c89eb",
            validInputs: [{
                token: {
                    id: "0xc2132d05d31c914a87c6611c10748aeb04b58e8f",
                    decimals: 6,
                    symbol: "USDT"
                }
            }],
            validOutputs: [{
                token: {
                    id: "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270",
                    decimals: 18,
                    symbol: "WMATIC",
                }
            }]
        };
        const result1 = bundleOrders([orderWithHandleIoKey], false, false);
        const result2 = bundleOrders([orderWithHandleIOKey], false, false);
        assert.deepEqual(result1, result2);
    });

    it("should get correct vault balance", async function () {
        const viemClient = await viem.getPublicClient();
        const usdt = {
            address: order1.validInputs[0].token.id,
            decimals: order1.validInputs[0].token.decimals,
            symbol: order1.validInputs[0].token.symbol,
            addressWithBalance: "0xF977814e90dA44bFA03b6295A0616a897441aceC",
        };
        const usdtContract = await ethers.getContractAt(
            ERC20Artifact.abi,
            usdt.address
        );
        const wmatic = {
            address: order1.validOutputs[0].token.id,
            decimals: order1.validOutputs[0].token.decimals,
            symbol: order1.validOutputs[0].token.symbol,
            addressWithBalance: "0xdF906eA18C6537C6379aC83157047F507FB37263",
        };
        const wmaticContract = await ethers.getContractAt(
            ERC20Artifact.abi,
            wmatic.address
        );

        // impersonate owner1 and owner2 from orders structs to deposit token into their vaults
        const owner1 = await ethers.getImpersonatedSigner(orderStruct1.owner);
        const owner2 = await ethers.getImpersonatedSigner(orderStruct2.owner);

        // deploy contracts
        const interpreter = await rainterpreterNPE2Deploy();
        const store = await rainterpreterStoreNPE2Deploy();
        const parser = await rainterpreterParserNPE2Deploy();
        const expressionDeployer = await rainterpreterExpressionDeployerNPE2Deploy(
            interpreter,
            store,
            parser
        );
        const orderbook = await deployOrderBookNPE2(expressionDeployer);

        // impersonate addresses with large token balances to fund the owner 1 2
        // accounts with some tokens used for topping up their vaults
        const usdtHolder = await ethers.getImpersonatedSigner(usdt.addressWithBalance);
        const wmaticHolder = await ethers.getImpersonatedSigner(wmatic.addressWithBalance);

        // fund token holders and owners with eth for tx gas cost
        await network.provider.send("hardhat_setBalance", [owner1.address, "0x5000000000000000000"]);
        await network.provider.send("hardhat_setBalance", [owner2.address, "0x5000000000000000000"]);
        await network.provider.send("hardhat_setBalance", [usdtHolder.address, "0x5000000000000000000"]);
        await network.provider.send("hardhat_setBalance", [wmaticHolder.address, "0x5000000000000000000"]);

        // fund owner1 and owner2 with their orders output tokens from account with balance
        await wmaticContract.connect(wmaticHolder).transfer(owner1.address, "50" + "0".repeat(wmatic.decimals));
        await usdtContract.connect(usdtHolder).transfer(owner2.address, "50" + "0".repeat(usdt.decimals));
        await wmaticContract.connect(wmaticHolder).transfer(owner2.address, "50" + "0".repeat(wmatic.decimals));

        // deposite for owner 1 wmatic vault
        const owner1WmaticDepositAmount = ethers.BigNumber.from("10" + "0".repeat(wmatic.decimals));
        const depositConfigStructOwner1 = {
            token: wmaticContract.address,
            vaultId: orderStruct1.validOutputs[0].vaultId,
            amount: owner1WmaticDepositAmount,
        };
        await wmaticContract
            .connect(owner1)
            .approve(orderbook.address, depositConfigStructOwner1.amount);
        await orderbook
            .connect(owner1)
            .deposit(
                depositConfigStructOwner1.token,
                depositConfigStructOwner1.vaultId,
                depositConfigStructOwner1.amount
            );

        // deposite for owner 2 in usdt and wmatic vaults
        const owner2UsdtDepositAmount = ethers.BigNumber.from("5" + "0".repeat(usdt.decimals));
        const depositConfigStructOwner2_1 = {
            token: usdtContract.address,
            vaultId: orderStruct2.validOutputs[0].vaultId,
            amount: owner2UsdtDepositAmount,
        };
        await usdtContract
            .connect(owner2)
            .approve(orderbook.address, depositConfigStructOwner2_1.amount);
        await orderbook
            .connect(owner2)
            .deposit(
                depositConfigStructOwner2_1.token,
                depositConfigStructOwner2_1.vaultId,
                depositConfigStructOwner2_1.amount
            );

        const owner2WmaticDepositAmount = ethers.BigNumber.from("15" + "0".repeat(usdt.decimals));
        const depositConfigStructOwner2_2 = {
            token: wmaticContract.address,
            vaultId: orderStruct2.validOutputs[1].vaultId,
            amount: owner2WmaticDepositAmount,
        };
        await wmaticContract
            .connect(owner2)
            .approve(orderbook.address, depositConfigStructOwner2_2.amount);
        await orderbook
            .connect(owner2)
            .deposit(
                depositConfigStructOwner2_2.token,
                depositConfigStructOwner2_2.vaultId,
                depositConfigStructOwner2_2.amount
            );

        // no bundle vault balance check
        const expectedBalancesNoBundle = [
            owner1WmaticDepositAmount,
            owner2UsdtDepositAmount,
            owner2WmaticDepositAmount,
        ];
        const noBundleOrders = bundleOrders([order1, order2], false, false);
        for (let i = 0; i < noBundleOrders.length; i++) {
            const vaultBalance = await getVaultBalance(
                noBundleOrders[i],
                orderbook.address,
                viemClient,
                "0xcA11bde05977b3631167028862bE2a173976CA11"
            );
            assert.deepEqual(vaultBalance, expectedBalancesNoBundle[i]);
        }

        // bundle vault balance check
        const expectedBalancesBundled = [
            owner1WmaticDepositAmount.add(owner2WmaticDepositAmount),
            owner2UsdtDepositAmount,
        ];
        const bundledOrders = bundleOrders([order1, order2], false, true);
        for (let i = 0; i < bundleOrders.length; i++) {
            const vaultBalance = await getVaultBalance(
                bundledOrders[i],
                orderbook.address,
                viemClient,
                "0xcA11bde05977b3631167028862bE2a173976CA11"
            );
            assert.deepEqual(vaultBalance, expectedBalancesBundled[i]);
        }
    });
});