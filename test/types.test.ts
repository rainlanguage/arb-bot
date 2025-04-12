import { assert } from "chai";
import { RpcRecord } from "../src/types";

describe("Test types functionalities", async function () {
    it("should test RpcRecord init", async function () {
        let expected: RpcRecord = {
            req: 0,
            success: 0,
            failure: 0,
            cache: {},
            lastRequestTimestamp: 0,
            requestIntervals: [],
        };
        let result = RpcRecord.init();
        assert.deepEqual(result, expected);

        expected = {
            req: 0,
            success: 0,
            failure: 0,
            cache: {},
            lastRequestTimestamp: 0,
            requestIntervals: [],
        };
        expected.req++;
        result = RpcRecord.init(true);
        assert.equal(result.req, expected.req);
        assert.equal(result.success, expected.success);
        assert.equal(result.failure, expected.failure);
        assert.deepEqual(result.cache, expected.cache);
        assert.deepEqual(result.requestIntervals, expected.requestIntervals);
        assert.ok(result.lastRequestTimestamp > 0);
    });

    it("should record new request", async function () {
        let record = RpcRecord.init();
        RpcRecord.recordNewRequest(record);
        let expected: RpcRecord = {
            req: 1,
            success: 0,
            failure: 0,
            cache: {},
            lastRequestTimestamp: 0,
            requestIntervals: [],
        };
        assert.equal(record.req, expected.req);
        assert.equal(record.success, expected.success);
        assert.equal(record.failure, expected.failure);
        assert.deepEqual(record.cache, expected.cache);
        assert.deepEqual(record.requestIntervals, expected.requestIntervals);
        assert.ok(record.lastRequestTimestamp > 0);

        record = RpcRecord.init(true);
        RpcRecord.recordNewRequest(record);
        expected = {
            req: 2,
            success: 0,
            failure: 0,
            cache: {},
            lastRequestTimestamp: 0,
            requestIntervals: [],
        };
        assert.equal(record.req, expected.req);
        assert.equal(record.success, expected.success);
        assert.equal(record.failure, expected.failure);
        assert.deepEqual(record.cache, expected.cache);
        assert.ok(record.requestIntervals.length === 1);
        assert.ok(record.lastRequestTimestamp > 0);
    });

    it("should test getting timeout count for rpc record", async function () {
        const record: RpcRecord = {
            req: 220,
            success: 160,
            failure: 25,
            cache: {},
            lastRequestTimestamp: Date.now(),
            requestIntervals: [],
        };
        const result = RpcRecord.timeoutCount(record);
        const expected = 35;
        assert.equal(result, expected);
    });

    it("should test getting avg request intervals for rpc record", async function () {
        // test happy case
        const record: RpcRecord = {
            req: 220,
            success: 160,
            failure: 25,
            cache: {},
            lastRequestTimestamp: Date.now(),
            requestIntervals: [2549, 3127, 2112, 2100, 3775],
        };
        const result = RpcRecord.avgRequestIntervals(record);
        const expected = 2732;
        assert.equal(result, expected);

        // test unhappy case
        record.requestIntervals = [];
        assert.throws(
            () => RpcRecord.avgRequestIntervals(record),
            "found no request interval records",
        );
    });
});
