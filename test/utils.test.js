const { assert } = require("chai");
const testData = require("./data");
const { clone, getTotalIncome, checkOwnedOrders } = require("../src/utils");
const {
    ethers,
    utils: { hexlify, randomBytes },
} = require("ethers");

describe("Test utils functions", async function () {
    it("should clone correctly", async function () {
        const obj = {
            a: 123,
            b: true,
            c: "some string",
            d: [1, 2, 3],
            e: ethers.BigNumber.from(1),
            f: {
                a: ethers.BigNumber.from(2),
                b: ["1", "2", "3"],
                c: {
                    a: true,
                    b: [ethers.BigNumber.from(1), ethers.BigNumber.from(2)],
                },
            },
        };
        const result = clone(obj);
        assert.deepEqual(result, obj);
        assert.notEqual(result, obj);
        assert.notEqual(result.f.b, obj.f.b);
        assert.notEqual(result.f.c, obj.f.c);
        assert.notEqual(result.f.c.b, obj.f.c.b);
    });

    it("should get total income", async function () {
        const inputTokenIncome = ethers.BigNumber.from("10000000");
        const outputTokenIncome = ethers.BigNumber.from("20000");
        const inputTokenPrice = "1.25";
        const outputTokenPrice = "0.8";
        const inputTokenDecimals = 6;
        const outputTokenDecimals = 3;

        const result = getTotalIncome(
            inputTokenIncome,
            outputTokenIncome,
            inputTokenPrice,
            outputTokenPrice,
            inputTokenDecimals,
            outputTokenDecimals,
        );
        const expected = ethers.utils.parseUnits((10 * 1.25 + 20 * 0.8).toString());
        assert.equal(result.toString(), expected.toString());
    });

    it("should check owned orders", async function () {
        const owner = hexlify(randomBytes(20));
        const { orderPairObject1: order1, opposingOrderPairObject: order2 } = testData;
        order1.takeOrders[0].takeOrder.order.owner = owner;
        order2.takeOrders[0].takeOrder.order.owner = owner;
        const orders = [order1, order2];
        const config = {
            chain: {
                id: 123,
            },
            mainAccount: {
                account: {
                    address: owner,
                },
            },
            viemClient: {
                multicall: async () => [0n, 10n],
            },
        };
        const result = await checkOwnedOrders(config, orders, hexlify(randomBytes(20)));
        const expected = orders.map((v, i) => ({
            id: v.takeOrders[0].id,
            vaultId:
                v.takeOrders[0].takeOrder.order.validOutputs[
                    v.takeOrders[0].takeOrder.outputIOIndex
                ].vaultId,
            token: v.sellToken,
            symbol: v.sellTokenSymbol,
            decimals: v.sellTokenDecimals,
            orderbook: v.orderbook,
            vaultBalance: ethers.BigNumber.from(i * 10),
        }));
        assert.deepEqual(result, expected);
    });
});
