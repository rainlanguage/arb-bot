const { assert } = require("chai");
const { clone } = require("../src/utils");
const { ethers } = require("ethers");

describe("Test utils functions", async function () {
    it("should clone correctly", async function () {
        const obj = {
            a: 123,
            b: true,
            c: "some string",
            d: [1,2,3],
            e: ethers.BigNumber.from(1),
            f: {
                a: ethers.BigNumber.from(2),
                b: ["1", "2", "3"],
                c: {
                    a: true,
                    b: [ethers.BigNumber.from(1), ethers.BigNumber.from(2)]
                }
            }
        };
        const result = clone(obj);
        assert.deepEqual(result, obj);
        assert.notEqual(result, obj);
        assert.notEqual(result.f.b, obj.f.b);
        assert.notEqual(result.f.c, obj.f.c);
        assert.notEqual(result.f.c.b, obj.f.c.b);
    });
});