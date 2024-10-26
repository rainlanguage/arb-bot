const { assert } = require("chai");
const { ethers } = require("hardhat");
const { OrderV3 } = require("../src/abis");
const mockServer = require("mockttp").getLocal();
const { handleOrderbooksNewLogs } = require("../src/watcher");
const { getOrderbookOwnersProfileMapFromSg } = require("../src/order");
const {
    utils: { hexlify, randomBytes },
} = require("ethers");

describe("Test watchers", async function () {
    beforeEach(() => mockServer.start(8899));
    afterEach(() => mockServer.stop());

    const tokens = [];
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
    const getOrderbookOwnersProfileMap = async () => {
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
        order1.struct = orderStruct1;
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
        order2.struct = orderStruct2;
        order2.orderBytes = orderBytes2;

        return [
            await getOrderbookOwnersProfileMapFromSg([order1, order2], undefined, tokens, {}),
            order1,
            order2,
        ];
    };

    const getNewOrder = (orderbook, owner) => {
        const orderHash = hexlify(randomBytes(32));
        const order = {
            id: orderHash,
            orderHash: orderHash,
            owner,
            orderBytes: "",
            active: true,
            nonce: `0x${"0".repeat(64)}`,
            orderbook: {
                id: orderbook,
            },
            inputs: [
                {
                    balance: "1",
                    vaultId: "1",
                    token: {
                        address: hexlify(randomBytes(20)),
                        decimals: 6,
                        symbol: "NewToken1",
                    },
                },
            ],
            outputs: [
                {
                    balance: "1",
                    vaultId: "1",
                    token: {
                        address: hexlify(randomBytes(20)),
                        decimals: 18,
                        symbol: "NewToken2",
                    },
                },
            ],
        };
        const orderStruct = getOrderStruct(order);
        const orderBytes = ethers.utils.defaultAbiCoder.encode([OrderV3], [orderStruct]);
        order.orderBytes = orderBytes;
        order.struct = orderStruct;
        return order;
    };

    it("should handle orderbooks new logs into orderbook owner map, add and remove", async function () {
        const [orderbooksOwnersProfileMap, order1] = await getOrderbookOwnersProfileMap();

        const newOrderbook = hexlify(randomBytes(20));
        const newOwner1 = hexlify(randomBytes(20));
        const newOrder1 = getNewOrder(newOrderbook, newOwner1);

        const newOwner2 = hexlify(randomBytes(20));
        const newOrder2 = getNewOrder(`0x${"2".repeat(40)}`, newOwner2);

        const newOrderbookLogs = {
            [`0x${"2".repeat(40)}`]: {
                orderLogs: [
                    {
                        type: "remove",
                        block: 1,
                        logIndex: 1,
                        order: {
                            sender: order1.owner,
                            orderHash: order1.orderHash,
                            order: order1.struct,
                        },
                    },
                    {
                        type: "add",
                        block: 2,
                        logIndex: 1,
                        order: {
                            sender: newOwner2,
                            orderHash: newOrder2.orderHash,
                            order: newOrder2.struct,
                        },
                    },
                ],
            },
            [newOrderbook]: {
                orderLogs: [
                    {
                        type: "add",
                        block: 2,
                        logIndex: 1,
                        order: {
                            sender: newOwner1,
                            orderHash: newOrder1.orderHash,
                            order: newOrder1.struct,
                        },
                    },
                ],
            },
        };
        await handleOrderbooksNewLogs(
            orderbooksOwnersProfileMap,
            newOrderbookLogs,
            undefined,
            tokens,
            {},
        );

        const expectedMap = (await getOrderbookOwnersProfileMap())[0];
        expectedMap
            .get(`0x${"2".repeat(40)}`)
            .get(order1.owner.toLowerCase())
            .orders.get(order1.orderHash.toLowerCase()).active = false;
        expectedMap.get(`0x${"2".repeat(40)}`).set(newOwner2, {
            limits: 25,
            orders: new Map([
                [
                    newOrder2.orderHash.toLowerCase(),
                    {
                        active: true,
                        order: newOrder2,
                        consumedTakeOrders: [],
                        takeOrders: [
                            {
                                buyToken: newOrder2.struct.validInputs[0].token,
                                buyTokenSymbol: newOrder2.inputs[0].token.symbol,
                                buyTokenDecimals: newOrder2.struct.validInputs[0].decimals,
                                sellToken: newOrder2.struct.validOutputs[0].token,
                                sellTokenSymbol: newOrder2.outputs[0].token.symbol,
                                sellTokenDecimals: newOrder2.struct.validOutputs[0].decimals,
                                takeOrder: {
                                    order: newOrder2.struct,
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
        expectedMap.set(
            newOrderbook,
            new Map([
                [
                    newOwner1,
                    {
                        limits: 25,
                        orders: new Map([
                            [
                                newOrder1.orderHash.toLowerCase(),
                                {
                                    active: true,
                                    order: newOrder1,
                                    consumedTakeOrders: [],
                                    takeOrders: [
                                        {
                                            buyToken: newOrder1.struct.validInputs[0].token,
                                            buyTokenSymbol: newOrder1.inputs[0].token.symbol,
                                            buyTokenDecimals:
                                                newOrder1.struct.validInputs[0].decimals,
                                            sellToken: newOrder1.struct.validOutputs[0].token,
                                            sellTokenSymbol: newOrder1.outputs[0].token.symbol,
                                            sellTokenDecimals:
                                                newOrder1.struct.validOutputs[0].decimals,
                                            takeOrder: {
                                                order: newOrder1.struct,
                                                inputIOIndex: 0,
                                                outputIOIndex: 0,
                                                signedContext: [],
                                            },
                                        },
                                    ],
                                },
                            ],
                        ]),
                    },
                ],
            ]),
        );

        const result = Array.from(orderbooksOwnersProfileMap).map((v) => [
            v[0],
            Array.from(v[1]).map((e) => [e[0], Array.from(e[1])]),
        ]);
        const expected = Array.from(expectedMap).map((v) => [
            v[0],
            Array.from(v[1]).map((e) => [e[0], Array.from(e[1])]),
        ]);
        assert.deepEqual(result, expected);
    });
});
