const { assert } = require("chai");
const { OrderV3 } = require("../src/abis");
const mockServer = require("mockttp").getLocal();
const { ethers, viem, network } = require("hardhat");
const ERC20Artifact = require("./abis/ERC20Upgradeable.json");
const { decodeAbiParameters, parseAbiParameters } = require("viem");
const { deployOrderBookNPE2, encodeQuoteResponse } = require("./utils");
const { bundleOrders, getVaultBalance, quoteOrders, quoteSingleOrder } = require("../src/utils");
const {
    utils: { hexlify, randomBytes, keccak256 },
} = require("ethers");
const {
    toOrder,
    getOrderPairs,
    prepareOrdersForRound,
    getOrderbookOwnersProfileMapFromSg,
} = require("../src/order");

describe("Test order details", async function () {
    beforeEach(() => mockServer.start(8081));
    afterEach(() => mockServer.stop());

    const getOrders = () => {
        const order1 = {
            id: "0x004349d76523bce3b6aeec93cf4c2a396b9cb71bc07f214e271cab363a0c89eb",
            orderHash: "0x004349d76523bce3b6aeec93cf4c2a396b9cb71bc07f214e271cab363a0c89eb",
            owner: "0x0f47a0c7f86a615606ca315ad83c3e302b474bd6",
            orderBytes: "",
            active: true,
            nonce: `0x${"0".repeat(64)}`,
            orderbook: {
                id: `0x${"2".repeat(40)}`,
            },
            inputs: [
                {
                    balance: "1",
                    vaultId: "1",
                    token: {
                        address: "0xc2132d05d31c914a87c6611c10748aeb04b58e8f",
                        decimals: 6,
                        symbol: "USDT",
                    },
                },
            ],
            outputs: [
                {
                    balance: "1",
                    vaultId: "1",
                    token: {
                        address: "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270",
                        decimals: 18,
                        symbol: "WMATIC",
                    },
                },
            ],
        };
        const orderStruct1 = getOrderStruct(order1);
        const orderBytes1 = ethers.utils.defaultAbiCoder.encode([OrderV3], [orderStruct1]);
        order1.orderBytes = orderBytes1;

        const order2 = {
            id: "0x008817a4b6f264326ef14357df54e48b9c064051f54f3877807970bb98096c01",
            orderHash: "0x008817a4b6f264326ef14357df54e48b9c064051f54f3877807970bb98096c01",
            owner: "0x0eb840e5acd0125853ad630663d3a62e673c22e6",
            orderBytes: "",
            active: true,
            nonce: `0x${"0".repeat(64)}`,
            orderbook: {
                id: `0x${"2".repeat(40)}`,
            },
            inputs: [
                {
                    balance: "1",
                    vaultId: "1",
                    token: {
                        address: "0xc2132d05d31c914a87c6611c10748aeb04b58e8f",
                        decimals: 6,
                        symbol: "USDT",
                    },
                },
                {
                    balance: "1",
                    vaultId: "1",
                    token: {
                        address: "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270",
                        decimals: 18,
                        symbol: "WMATIC",
                    },
                },
            ],
            outputs: [
                {
                    balance: "1",
                    vaultId: "1",
                    token: {
                        address: "0xc2132d05d31c914a87c6611c10748aeb04b58e8f",
                        decimals: 6,
                        symbol: "USDT",
                    },
                },
                {
                    balance: "1",
                    vaultId: "1",
                    token: {
                        address: "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270",
                        decimals: 18,
                        symbol: "WMATIC",
                    },
                },
            ],
        };
        const orderStruct2 = getOrderStruct(order2);
        const orderBytes2 = ethers.utils.defaultAbiCoder.encode([OrderV3], [orderStruct2]);
        order2.orderBytes = orderBytes2;

        return [order1, order2];
    };

    const getNewOrder = (orderbook, owner, token1, token2, nonce) => {
        const order = {
            id: "",
            orderHash: "",
            owner,
            orderBytes: "",
            active: true,
            nonce: `0x${nonce.toString().repeat(64)}`,
            orderbook: {
                id: orderbook,
            },
            inputs: [
                {
                    balance: "1",
                    vaultId: "0x01",
                    token: token1,
                },
            ],
            outputs: [
                {
                    balance: "1",
                    vaultId: "0x01",
                    token: token2,
                },
            ],
        };
        const orderStruct = getOrderStruct(order);
        const orderBytes = ethers.utils.defaultAbiCoder.encode([OrderV3], [orderStruct]);
        order.orderBytes = orderBytes;
        order.struct = orderStruct;
        order.id = keccak256(orderBytes);
        order.orderHash = keccak256(orderBytes);
        return order;
    };

    it("should return correct order details", async function () {
        const [order1, order2] = getOrders();
        const orderStruct1 = toOrder(
            decodeAbiParameters(parseAbiParameters(OrderV3), order1.orderBytes)[0],
        );
        const orderStruct2 = toOrder(
            decodeAbiParameters(parseAbiParameters(OrderV3), order2.orderBytes)[0],
        );
        const unbundledResult = bundleOrders([order1, order2], false, false);
        const unbundledExpected = [
            [
                {
                    buyToken: orderStruct1.validInputs[0].token,
                    buyTokenSymbol: order1.inputs[0].token.symbol,
                    buyTokenDecimals: orderStruct1.validInputs[0].decimals,
                    sellToken: orderStruct1.validOutputs[0].token,
                    sellTokenSymbol: order1.outputs[0].token.symbol,
                    sellTokenDecimals: orderStruct1.validOutputs[0].decimals,
                    orderbook: `0x${"2".repeat(40)}`,
                    takeOrders: [
                        {
                            id: order1.orderHash,
                            takeOrder: {
                                order: ethers.utils.defaultAbiCoder.decode(
                                    [OrderV3],
                                    order1.orderBytes,
                                )[0],
                                inputIOIndex: 0,
                                outputIOIndex: 0,
                                signedContext: [],
                            },
                        },
                    ],
                },
                {
                    buyToken: orderStruct2.validInputs[1].token,
                    buyTokenSymbol: order2.inputs[1].token.symbol,
                    buyTokenDecimals: orderStruct2.validInputs[1].decimals,
                    sellToken: orderStruct2.validOutputs[0].token,
                    sellTokenSymbol: order2.outputs[0].token.symbol,
                    sellTokenDecimals: orderStruct2.validOutputs[0].decimals,
                    orderbook: `0x${"2".repeat(40)}`,
                    takeOrders: [
                        {
                            id: order2.orderHash,
                            takeOrder: {
                                order: ethers.utils.defaultAbiCoder.decode(
                                    [OrderV3],
                                    order2.orderBytes,
                                )[0],
                                inputIOIndex: 1,
                                outputIOIndex: 0,
                                signedContext: [],
                            },
                        },
                    ],
                },
                {
                    buyToken: orderStruct2.validInputs[0].token,
                    buyTokenSymbol: order2.inputs[0].token.symbol,
                    buyTokenDecimals: orderStruct2.validInputs[0].decimals,
                    sellToken: orderStruct2.validOutputs[1].token,
                    sellTokenSymbol: order2.outputs[1].token.symbol,
                    sellTokenDecimals: orderStruct2.validOutputs[1].decimals,
                    orderbook: `0x${"2".repeat(40)}`,
                    takeOrders: [
                        {
                            id: order2.orderHash,
                            takeOrder: {
                                order: ethers.utils.defaultAbiCoder.decode(
                                    [OrderV3],
                                    order2.orderBytes,
                                )[0],
                                inputIOIndex: 0,
                                outputIOIndex: 1,
                                signedContext: [],
                            },
                        },
                    ],
                },
            ],
        ];
        assert.deepEqual(unbundledResult, unbundledExpected);

        const bundledResult = bundleOrders([order1, order2], false, true);
        const bundledExpected = [
            [
                {
                    buyToken: orderStruct1.validInputs[0].token,
                    buyTokenSymbol: order1.inputs[0].token.symbol,
                    buyTokenDecimals: orderStruct1.validInputs[0].decimals,
                    sellToken: orderStruct1.validOutputs[0].token,
                    sellTokenSymbol: order1.outputs[0].token.symbol,
                    sellTokenDecimals: orderStruct1.validOutputs[0].decimals,
                    orderbook: `0x${"2".repeat(40)}`,
                    takeOrders: [
                        {
                            id: order1.id,
                            takeOrder: {
                                order: ethers.utils.defaultAbiCoder.decode(
                                    [OrderV3],
                                    order1.orderBytes,
                                )[0],
                                inputIOIndex: 0,
                                outputIOIndex: 0,
                                signedContext: [],
                            },
                        },
                        {
                            id: order2.orderHash,
                            takeOrder: {
                                order: ethers.utils.defaultAbiCoder.decode(
                                    [OrderV3],
                                    order2.orderBytes,
                                )[0],
                                inputIOIndex: 0,
                                outputIOIndex: 1,
                                signedContext: [],
                            },
                        },
                    ],
                },
                {
                    buyToken: orderStruct2.validInputs[1].token,
                    buyTokenSymbol: order2.inputs[1].token.symbol,
                    buyTokenDecimals: orderStruct2.validInputs[1].decimals,
                    sellToken: orderStruct2.validOutputs[0].token,
                    sellTokenSymbol: order2.outputs[0].token.symbol,
                    sellTokenDecimals: orderStruct2.validOutputs[0].decimals,
                    orderbook: `0x${"2".repeat(40)}`,
                    takeOrders: [
                        {
                            id: order2.orderHash,
                            takeOrder: {
                                order: ethers.utils.defaultAbiCoder.decode(
                                    [OrderV3],
                                    order2.orderBytes,
                                )[0],
                                inputIOIndex: 1,
                                outputIOIndex: 0,
                                signedContext: [],
                            },
                        },
                    ],
                },
            ],
        ];
        assert.deepEqual(bundledResult, bundledExpected);
    });

    it("should get correct vault balance", async function () {
        const [order1, order2] = getOrders();
        const viemClient = await viem.getPublicClient();
        const usdt = {
            address: order1.inputs[0].token.address,
            decimals: order1.inputs[0].token.decimals,
            symbol: order1.inputs[0].token.symbol,
            addressWithBalance: "0xF977814e90dA44bFA03b6295A0616a897441aceC",
        };
        const usdtContract = await ethers.getContractAt(ERC20Artifact.abi, usdt.address);
        const wmatic = {
            address: order1.outputs[0].token.address,
            decimals: order1.outputs[0].token.decimals,
            symbol: order1.outputs[0].token.symbol,
            addressWithBalance: "0xdF906eA18C6537C6379aC83157047F507FB37263",
        };
        const wmaticContract = await ethers.getContractAt(ERC20Artifact.abi, wmatic.address);

        // deploy orderbook
        const orderbook = await deployOrderBookNPE2();
        const orderStruct1 = toOrder(
            decodeAbiParameters(parseAbiParameters(OrderV3), order1.orderBytes)[0],
        );
        const orderStruct2 = toOrder(
            decodeAbiParameters(parseAbiParameters(OrderV3), order2.orderBytes)[0],
        );

        // impersonate owners and addresses with large token balances to fund the owner 1 2
        // accounts with some tokens used for topping up their vaults
        const owner1 = await ethers.getImpersonatedSigner(orderStruct1.owner);
        const owner2 = await ethers.getImpersonatedSigner(orderStruct2.owner);
        const usdtHolder = await ethers.getImpersonatedSigner(usdt.addressWithBalance);
        const wmaticHolder = await ethers.getImpersonatedSigner(wmatic.addressWithBalance);

        // fund token holders and owners with eth for tx gas cost
        await network.provider.send("hardhat_setBalance", [owner1.address, "0x4563918244F40000"]);
        await network.provider.send("hardhat_setBalance", [owner2.address, "0x4563918244F40000"]);
        await network.provider.send("hardhat_setBalance", [
            usdtHolder.address,
            "0x4563918244F40000",
        ]);
        await network.provider.send("hardhat_setBalance", [
            wmaticHolder.address,
            "0x4563918244F40000",
        ]);

        // fund owner1 and owner2 with their orders output tokens from account with balance
        await wmaticContract
            .connect(wmaticHolder)
            .transfer(owner1.address, "50" + "0".repeat(wmatic.decimals));
        await usdtContract
            .connect(usdtHolder)
            .transfer(owner2.address, "50" + "0".repeat(usdt.decimals));
        await wmaticContract
            .connect(wmaticHolder)
            .transfer(owner2.address, "50" + "0".repeat(wmatic.decimals));

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
            .deposit2(
                depositConfigStructOwner1.token,
                depositConfigStructOwner1.vaultId,
                depositConfigStructOwner1.amount,
                [],
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
            .deposit2(
                depositConfigStructOwner2_1.token,
                depositConfigStructOwner2_1.vaultId,
                depositConfigStructOwner2_1.amount,
                [],
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
            .deposit2(
                depositConfigStructOwner2_2.token,
                depositConfigStructOwner2_2.vaultId,
                depositConfigStructOwner2_2.amount,
                [],
            );

        // no bundle vault balance check
        const expectedBalancesNoBundle = [
            owner1WmaticDepositAmount,
            owner2UsdtDepositAmount,
            owner2WmaticDepositAmount,
        ];
        order1.orderbook.id = orderbook.address.toLowerCase();
        order2.orderbook.id = orderbook.address.toLowerCase();
        const noBundleOrders = bundleOrders([order1, order2], false, false);

        for (let i = 0; i < noBundleOrders.length; i++) {
            const vaultBalance = await getVaultBalance(
                noBundleOrders.find((v) => v[0].orderbook === orderbook.address.toLowerCase())[i],
                orderbook.address,
                viemClient,
                "0xcA11bde05977b3631167028862bE2a173976CA11",
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
                bundledOrders.find((v) => v[0].orderbook === orderbook.address.toLowerCase())[i],
                orderbook.address,
                viemClient,
                "0xcA11bde05977b3631167028862bE2a173976CA11",
            );
            assert.deepEqual(vaultBalance, expectedBalancesBundled[i]);
        }
    });

    it("should quote orders", async function () {
        const orderbook = `0x${"2".repeat(40)}`;
        const orderDetails = [
            [
                {
                    orderbook: orderbook,
                    takeOrders: [
                        {
                            id: `0x${"1".repeat(64)}`,
                            takeOrder: {
                                order: {
                                    owner: `0x${"2".repeat(40)}`,
                                    evaluable: {
                                        interpreter: `0x${"2".repeat(40)}`,
                                        store: `0x${"2".repeat(40)}`,
                                        bytecode: "0x",
                                    },
                                    validInputs: [
                                        {
                                            token: `0x${"2".repeat(40)}`,
                                            decimals: 18,
                                            vaultId: ethers.BigNumber.from("1"),
                                        },
                                    ],
                                    validOutputs: [
                                        {
                                            token: `0x${"2".repeat(40)}`,
                                            decimals: 18,
                                            vaultId: ethers.BigNumber.from("1"),
                                        },
                                    ],
                                    nonce: "1",
                                },
                                inputIOIndex: 0,
                                outputIOIndex: 0,
                                signedContext: [],
                            },
                        },
                        {
                            id: `0x${"2".repeat(64)}`,
                            takeOrder: {
                                order: {
                                    owner: `0x${"2".repeat(40)}`,
                                    evaluable: {
                                        interpreter: `0x${"2".repeat(40)}`,
                                        store: `0x${"2".repeat(40)}`,
                                        bytecode: "0x",
                                    },
                                    validInputs: [
                                        {
                                            token: `0x${"2".repeat(40)}`,
                                            decimals: 18,
                                            vaultId: ethers.BigNumber.from("1"),
                                        },
                                    ],
                                    validOutputs: [
                                        {
                                            token: `0x${"2".repeat(40)}`,
                                            decimals: 18,
                                            vaultId: ethers.BigNumber.from("1"),
                                        },
                                    ],
                                    nonce: "1",
                                },
                                inputIOIndex: 0,
                                outputIOIndex: 0,
                                signedContext: [],
                            },
                        },
                    ],
                },
            ],
        ];
        // mock response with encoded data as:
        // first order: successfull (maxout 1, ratio 2)
        // second order: fail
        await mockServer.forPost("/rpc").thenSendJsonRpcResult(
            encodeQuoteResponse([
                [true, ethers.BigNumber.from(1), ethers.BigNumber.from(2)],
                [false, ethers.BigNumber.from(0), ethers.BigNumber.from(0)],
            ]),
        );
        const result = await quoteOrders(orderDetails, [mockServer.url + "/rpc"]);
        const expected = [
            [
                {
                    orderbook: orderDetails[0][0].orderbook,
                    takeOrders: [
                        {
                            ...orderDetails[0][0].takeOrders[0],
                            quote: {
                                maxOutput: ethers.BigNumber.from(1),
                                ratio: ethers.BigNumber.from(2),
                            },
                        },
                    ],
                },
            ],
        ];
        assert.deepEqual(result, expected);
    });

    it("should single quote order", async function () {
        const orderbook = `0x${"2".repeat(40)}`;
        const orderDetails = {
            orderbook: orderbook,
            takeOrders: [
                {
                    id: `0x${"1".repeat(64)}`,
                    quote: {
                        maxOutput: ethers.BigNumber.from("33"),
                        ratio: ethers.BigNumber.from("44"),
                    },
                    takeOrder: {
                        order: {
                            owner: `0x${"2".repeat(40)}`,
                            evaluable: {
                                interpreter: `0x${"2".repeat(40)}`,
                                store: `0x${"2".repeat(40)}`,
                                bytecode: "0x",
                            },
                            validInputs: [
                                {
                                    token: `0x${"2".repeat(40)}`,
                                    decimals: 18,
                                    vaultId: ethers.BigNumber.from("1"),
                                },
                            ],
                            validOutputs: [
                                {
                                    token: `0x${"2".repeat(40)}`,
                                    decimals: 18,
                                    vaultId: ethers.BigNumber.from("1"),
                                },
                            ],
                            nonce: "1",
                        },
                        inputIOIndex: 0,
                        outputIOIndex: 0,
                        signedContext: [],
                    },
                },
            ],
        };
        // mock response with encoded data
        await mockServer
            .forPost("/rpc")
            .thenSendJsonRpcResult(
                encodeQuoteResponse([[true, ethers.BigNumber.from(1), ethers.BigNumber.from(2)]]),
            );
        await quoteSingleOrder(orderDetails, [mockServer.url + "/rpc"]);
        const expected = {
            maxOutput: ethers.BigNumber.from(1),
            ratio: ethers.BigNumber.from(2),
        };
        assert.deepEqual(orderDetails.takeOrders[0].quote, expected);
    });

    it("should get order pairs", async function () {
        const [order1] = getOrders();
        const orderStruct = toOrder(
            decodeAbiParameters(parseAbiParameters(OrderV3), order1.orderBytes)[0],
        );
        const result = await getOrderPairs(orderStruct, undefined, [], order1);
        const expected = [
            {
                buyToken: orderStruct.validInputs[0].token,
                buyTokenSymbol: order1.inputs[0].token.symbol,
                buyTokenDecimals: orderStruct.validInputs[0].decimals,
                sellToken: orderStruct.validOutputs[0].token,
                sellTokenSymbol: order1.outputs[0].token.symbol,
                sellTokenDecimals: orderStruct.validOutputs[0].decimals,
                takeOrder: {
                    order: orderStruct,
                    inputIOIndex: 0,
                    outputIOIndex: 0,
                    signedContext: [],
                },
            },
        ];
        assert.deepEqual(result, expected);
    });

    it("should make orderbook owner order map", async function () {
        const [order1, order2] = getOrders();
        const orderStruct1 = toOrder(
            decodeAbiParameters(parseAbiParameters(OrderV3), order1.orderBytes)[0],
        );
        const orderStruct2 = toOrder(
            decodeAbiParameters(parseAbiParameters(OrderV3), order2.orderBytes)[0],
        );
        const result = await getOrderbookOwnersProfileMapFromSg(
            [order1, order2],
            undefined,
            [],
            {},
        );
        const ownerMap = new Map();
        ownerMap.set(order1.owner.toLowerCase(), {
            limit: 25,
            orders: new Map([
                [
                    order1.orderHash.toLowerCase(),
                    {
                        active: true,
                        order: orderStruct1,
                        consumedTakeOrders: [],
                        takeOrders: [
                            {
                                buyToken: orderStruct1.validInputs[0].token,
                                buyTokenSymbol: order1.inputs[0].token.symbol,
                                buyTokenDecimals: orderStruct1.validInputs[0].decimals,
                                sellToken: orderStruct1.validOutputs[0].token,
                                sellTokenSymbol: order1.outputs[0].token.symbol,
                                sellTokenDecimals: orderStruct1.validOutputs[0].decimals,
                                takeOrder: {
                                    order: orderStruct1,
                                    inputIOIndex: 0,
                                    outputIOIndex: 0,
                                    signedContext: [],
                                },
                            },
                        ],
                    },
                ],
            ]),
        });
        ownerMap.set(order2.owner.toLowerCase(), {
            limit: 25,
            orders: new Map([
                [
                    order2.orderHash.toLowerCase(),
                    {
                        active: true,
                        order: orderStruct2,
                        consumedTakeOrders: [],
                        takeOrders: [
                            {
                                buyToken: orderStruct2.validInputs[0].token,
                                buyTokenSymbol: order2.inputs[0].token.symbol,
                                buyTokenDecimals: orderStruct2.validInputs[0].decimals,
                                sellToken: orderStruct2.validOutputs[0].token,
                                sellTokenSymbol: order2.outputs[0].token.symbol,
                                sellTokenDecimals: orderStruct2.validOutputs[0].decimals,
                                takeOrder: {
                                    order: orderStruct2,
                                    inputIOIndex: 0,
                                    outputIOIndex: 0,
                                    signedContext: [],
                                },
                            },
                        ],
                    },
                ],
            ]),
        });
        const expected = new Map([]);
        expected.set(`0x${"2".repeat(40)}`, ownerMap);

        const resultAsArray = Array.from(result).map((v) => [
            v[0],
            Array.from(v[1]).map((e) => [e[0], Array.from(e[1])]),
        ]);
        const expectedAsArray = Array.from(result).map((v) => [
            v[0],
            Array.from(v[1]).map((e) => [e[0], Array.from(e[1])]),
        ]);
        assert.deepEqual(resultAsArray, expectedAsArray);
    });

    it("should prepare orders for rounds by specified owner limits", async function () {
        const orderbook = hexlify(randomBytes(20)).toLowerCase();
        const owner1 = hexlify(randomBytes(20)).toLowerCase();
        const owner2 = hexlify(randomBytes(20)).toLowerCase();
        const token1 = {
            address: hexlify(randomBytes(20)).toLowerCase(),
            decimals: 6,
            symbol: "NewToken1",
        };
        const token2 = {
            address: hexlify(randomBytes(20)).toLowerCase(),
            decimals: 6,
            symbol: "NewToken1",
        };
        const [order1, order2, order3, order4, order5, order6, order7, order8] = [
            getNewOrder(orderbook, owner1, token1, token2, 1), // owner 1
            getNewOrder(orderbook, owner1, token1, token2, 2), // //
            getNewOrder(orderbook, owner1, token1, token2, 3), // //
            getNewOrder(orderbook, owner1, token1, token2, 4), // //
            getNewOrder(orderbook, owner1, token1, token2, 5), // //
            getNewOrder(orderbook, owner1, token1, token2, 6), // //
            getNewOrder(orderbook, owner2, token2, token1, 1), // owner 2
            getNewOrder(orderbook, owner2, token2, token1, 2), // //
        ];
        const owner1Orders = [order1, order2, order3, order4, order5, order6];
        const owner2Orders = [order7, order8];

        // build orderbook owner map
        const allOrders = await getOrderbookOwnersProfileMapFromSg(
            [order1, order2, order3, order4, order5, order6, order7, order8],
            undefined,
            [],
            { [owner1]: 3, [owner2]: 1 }, // set owner1 limit as 3, owner2 to 1
        );

        // prepare orders for first round
        const result1 = prepareOrdersForRound(allOrders, false);
        const expected1 = [
            [
                {
                    buyToken: token1.address,
                    buyTokenSymbol: token1.symbol,
                    buyTokenDecimals: token1.decimals,
                    sellToken: token2.address,
                    sellTokenSymbol: token2.symbol,
                    sellTokenDecimals: token2.decimals,
                    orderbook,
                    // first 3 owner1 orders for round1, owner1 limit is 3
                    takeOrders: owner1Orders.slice(0, 3).map((v) => ({
                        id: v.id,
                        takeOrder: {
                            order: v.struct,
                            inputIOIndex: 0,
                            outputIOIndex: 0,
                            signedContext: [],
                        },
                    })),
                },
                {
                    buyToken: token2.address,
                    buyTokenSymbol: token2.symbol,
                    buyTokenDecimals: token2.decimals,
                    sellToken: token1.address,
                    sellTokenSymbol: token1.symbol,
                    sellTokenDecimals: token1.decimals,
                    orderbook,
                    // first 1 owner2 orders for round1, owner2 limit is 1
                    takeOrders: owner2Orders.slice(0, 1).map((v) => ({
                        id: v.id,
                        takeOrder: {
                            order: v.struct,
                            inputIOIndex: 0,
                            outputIOIndex: 0,
                            signedContext: [],
                        },
                    })),
                },
            ],
        ];
        assert.deepEqual(result1, expected1);

        // prepare orders for second round
        const result2 = prepareOrdersForRound(allOrders, false);
        const expected2 = [
            [
                {
                    buyToken: token1.address,
                    buyTokenSymbol: token1.symbol,
                    buyTokenDecimals: token1.decimals,
                    sellToken: token2.address,
                    sellTokenSymbol: token2.symbol,
                    sellTokenDecimals: token2.decimals,
                    orderbook,
                    // second 3 owner1 orders for round2, owner1 limit is 3
                    takeOrders: owner1Orders.slice(3, owner1Orders.length).map((v) => ({
                        id: v.id,
                        takeOrder: {
                            order: v.struct,
                            inputIOIndex: 0,
                            outputIOIndex: 0,
                            signedContext: [],
                        },
                    })),
                },
                {
                    buyToken: token2.address,
                    buyTokenSymbol: token2.symbol,
                    buyTokenDecimals: token2.decimals,
                    sellToken: token1.address,
                    sellTokenSymbol: token1.symbol,
                    sellTokenDecimals: token1.decimals,
                    orderbook,
                    // second 1 owner2 orders for round2, owner2 limit is 1
                    takeOrders: owner2Orders.slice(1, owner2Orders.length).map((v) => ({
                        id: v.id,
                        takeOrder: {
                            order: v.struct,
                            inputIOIndex: 0,
                            outputIOIndex: 0,
                            signedContext: [],
                        },
                    })),
                },
            ],
        ];
        assert.deepEqual(result2, expected2);

        // prepare orders for 3rd round, so should be back to consuming
        // orders of onwer1 and 2 just like round 1
        const result3 = prepareOrdersForRound(allOrders, false);
        const expected3 = [
            [
                {
                    buyToken: token1.address,
                    buyTokenSymbol: token1.symbol,
                    buyTokenDecimals: token1.decimals,
                    sellToken: token2.address,
                    sellTokenSymbol: token2.symbol,
                    sellTokenDecimals: token2.decimals,
                    orderbook,
                    // first 3 owner1 orders again for round3, owner1 limit is 3
                    takeOrders: owner1Orders.slice(0, 3).map((v) => ({
                        id: v.id,
                        takeOrder: {
                            order: v.struct,
                            inputIOIndex: 0,
                            outputIOIndex: 0,
                            signedContext: [],
                        },
                    })),
                },
                {
                    buyToken: token2.address,
                    buyTokenSymbol: token2.symbol,
                    buyTokenDecimals: token2.decimals,
                    sellToken: token1.address,
                    sellTokenSymbol: token1.symbol,
                    sellTokenDecimals: token1.decimals,
                    orderbook,
                    // first 1 owner2 orders again for round3, owner2 limit is 1
                    takeOrders: owner2Orders.slice(0, 1).map((v) => ({
                        id: v.id,
                        takeOrder: {
                            order: v.struct,
                            inputIOIndex: 0,
                            outputIOIndex: 0,
                            signedContext: [],
                        },
                    })),
                },
            ],
        ];
        assert.deepEqual(result3, expected3);
    });
});

function getOrderStruct(order) {
    return {
        nonce: order.nonce,
        owner: order.owner.toLowerCase(),
        evaluable: {
            interpreter: `0x${"1".repeat(40)}`,
            store: `0x${"2".repeat(40)}`,
            bytecode: "0x1234",
        },
        validInputs: order.inputs.map((v) => ({
            token: v.token.address.toLowerCase(),
            decimals: v.token.decimals,
            vaultId: v.vaultId,
        })),
        validOutputs: order.outputs.map((v) => ({
            token: v.token.address.toLowerCase(),
            decimals: v.token.decimals,
            vaultId: v.vaultId,
        })),
    };
}
