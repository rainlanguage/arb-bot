import { assert } from "chai";
import { RpcMetrics, RpcState } from "../src/rpc";
import { sleep } from "../src/utils";

describe("Test RpcState", async function () {
    it("should init RpcState", async function () {
        const urls = ["https://example1.com/", "https://example2.com/"];
        const metrics = {
            [urls[0]]: new RpcMetrics(),
            [urls[1]]: new RpcMetrics(),
        };

        const result = new RpcState(urls);
        const expected = { urls, metrics } as any;
        assert.deepEqual(result, expected);
    });
});

describe("Test RpcMetrics", async function () {
    it("should init RpcMetrics", async function () {
        const result = new RpcMetrics();
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
        assert.exists(result.recordSuccess);
    });

    it("should record new request", async function () {
        const result = new RpcMetrics();

        // record a request
        result.recordRequest();

        assert.equal(result.req, 1);
        assert.equal(result.success, 0);
        assert.equal(result.failure, 0);
        assert.deepEqual(result.cache, {});
        assert.deepEqual(result.requestIntervals, []);
        assert.ok(result.lastRequestTimestamp > 0);
        assert.equal(result.timeout, 1);
        assert.equal(result.avgRequestIntervals, 0);

        // wait 2 seconds and then record another request
        await sleep(2000);
        result.recordRequest();

        assert.equal(result.req, 2);
        assert.equal(result.success, 0);
        assert.equal(result.failure, 0);
        assert.deepEqual(result.cache, {});
        assert.ok(result.requestIntervals.length === 1);
        assert.ok(result.requestIntervals[0] >= 2000);
        assert.ok(result.lastRequestTimestamp > 0);
        assert.equal(result.timeout, 2);
        assert.ok(result.avgRequestIntervals >= 2000);

        // wait 3 seconds and then record yet another request
        await sleep(3000);
        result.recordRequest();

        assert.equal(result.req, 3);
        assert.equal(result.success, 0);
        assert.equal(result.failure, 0);
        assert.deepEqual(result.cache, {});
        assert.isOk((result.requestIntervals.length as number) === 2);
        assert.ok(result.requestIntervals[0] >= 2000);
        assert.ok(result.requestIntervals[1] >= 3000);
        assert.ok(result.lastRequestTimestamp > 0);
        assert.equal(result.timeout, 3);
        assert.ok(result.avgRequestIntervals >= 2500);
    });

    it("should record successful response", async function () {
        const result = new RpcMetrics();
        result.recordRequest();

        result.recordSuccess();

        assert.equal(result.req, 1);
        assert.equal(result.success, 1);
        assert.equal(result.failure, 0);
        assert.deepEqual(result.cache, {});
        assert.ok(result.requestIntervals.length === 0);
        assert.ok(result.lastRequestTimestamp > 0);
        assert.equal(result.timeout, 0);
        assert.ok(result.avgRequestIntervals >= 0);
    });

    it("should record failure response", async function () {
        const result = new RpcMetrics();
        result.recordRequest();

        result.recordFailure();

        assert.equal(result.req, 1);
        assert.equal(result.success, 0);
        assert.equal(result.failure, 1);
        assert.deepEqual(result.cache, {});
        assert.ok(result.requestIntervals.length === 0);
        assert.ok(result.lastRequestTimestamp > 0);
        assert.equal(result.timeout, 0);
        assert.ok(result.avgRequestIntervals >= 0);
    });

    it("should reset rpc record", async function () {
        const record = new RpcMetrics();
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
        const record = new RpcMetrics();
        record.req = 10;
        record.success = 5;
        record.failure = 2;

        const result = record.timeout;
        const expected = 3;
        assert.equal(result, expected);
    });

    it("should test getting avg request intervals for rpc record", async function () {
        const record = new RpcMetrics();

        record.requestIntervals = [];
        assert.equal(record.avgRequestIntervals, 0);

        record.requestIntervals = [3775];
        assert.equal(record.avgRequestIntervals, 3775);

        record.requestIntervals = [3775, 2556];
        assert.equal(record.avgRequestIntervals, 3165);

        record.requestIntervals = [2549, 3127, 2112, 2100, 3775];
        assert.equal(record.avgRequestIntervals, 2732);
    });
});
