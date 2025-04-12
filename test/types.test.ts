import { assert } from "chai";
import { RpcRecord } from "../src/types";

describe("Test types functionalities", async function () {
    it("should test RpcRecord init", async function () {
        const result = RpcRecord.init();
        assert.equal(result.req, 0);
        assert.equal(result.success, 0);
        assert.equal(result.failure, 0);
        assert.deepEqual(result.cache, {});
        assert.deepEqual(result.requestIntervals, []);
        assert.deepEqual(result.lastRequestTimestamp, 0);
        assert.equal(result.timeout, 0);
        assert.equal(result.avgRequestIntervals, 0);
        assert.exists(result.reset);
        assert.exists(result.recordRequest);
        assert.exists(result.recordResponse);
    });

    it("should record new request", async function () {
        const result = RpcRecord.init();
        result.recordRequest();
        assert.equal(result.req, 1);
        assert.equal(result.success, 0);
        assert.equal(result.failure, 0);
        assert.deepEqual(result.cache, {});
        assert.deepEqual(result.requestIntervals, []);
        assert.ok(result.lastRequestTimestamp > 0);
        assert.equal(result.timeout, 1);
        assert.equal(result.avgRequestIntervals, 0);

        result.recordRequest();
        assert.equal(result.req, 2);
        assert.equal(result.success, 0);
        assert.equal(result.failure, 0);
        assert.deepEqual(result.cache, {});
        assert.ok(result.requestIntervals.length === 1);
        assert.ok(result.lastRequestTimestamp > 0);
        assert.equal(result.timeout, 2);
        assert.ok(result.avgRequestIntervals >= 0);
    });

    it("should record new response", async function () {
        const result = RpcRecord.init();
        result.recordRequest();
        result.recordRequest();

        // record success
        result.recordResponse(true);
        assert.equal(result.req, 2);
        assert.equal(result.success, 1);
        assert.equal(result.failure, 0);
        assert.deepEqual(result.cache, {});
        assert.ok(result.requestIntervals.length === 1);
        assert.ok(result.lastRequestTimestamp > 0);
        assert.equal(result.timeout, 1);
        assert.ok(result.avgRequestIntervals >= 0);

        // record failure
        result.recordResponse(false);
        assert.equal(result.req, 2);
        assert.equal(result.success, 1);
        assert.equal(result.failure, 1);
        assert.deepEqual(result.cache, {});
        assert.ok(result.requestIntervals.length === 1);
        assert.ok(result.lastRequestTimestamp > 0);
        assert.equal(result.timeout, 0);
        assert.ok(result.avgRequestIntervals >= 0);
    });

    it("should reset rpc record", async function () {
        const record = RpcRecord.init();
        record.req = 10;
        record.success = 5;
        record.failure = 2;
        record.requestIntervals = [1, 2, 3];

        record.reset();
        assert.equal(record.req, 0);
        assert.equal(record.success, 0);
        assert.equal(record.failure, 0);
        assert.deepEqual(record.cache, {});
        assert.deepEqual(record.requestIntervals, []);
        assert.deepEqual(record.lastRequestTimestamp, 0);
        assert.equal(record.timeout, 0);
        assert.equal(record.avgRequestIntervals, 0);
    });

    it("should test getting timeout count for rpc record", async function () {
        const record = RpcRecord.init();
        record.req = 10;
        record.success = 5;
        record.failure = 2;

        const result = record.timeout;
        const expected = 3;
        assert.equal(result, expected);
    });

    it("should test getting avg request intervals for rpc record", async function () {
        const record = RpcRecord.init();

        // empty case
        assert.equal(record.avgRequestIntervals, 0);

        // not empty case
        record.requestIntervals = [2549, 3127, 2112, 2100, 3775];
        assert.equal(record.avgRequestIntervals, 2732);
    });
});
