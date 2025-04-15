import { assert } from "chai";
import { sleep } from "../src/utils";
import { normalizeUrl, RpcConfig, RpcMetrics, RpcProgress, RpcState } from "../src/rpc";

describe("Test RpcState", async function () {
    const configs: RpcConfig[] = [
        {
            url: "https://example1.com/",
        },
        {
            url: "https://example2.com/",
        },
        {
            url: "https://example3.com/",
        },
        {
            url: "https://example4.com/",
        },
    ];

    it("should init RpcState", async function () {
        const urls = configs.map((v) => v.url);
        const expected = {
            urls,
            configs,
            rpcs: {
                [urls[0]]: { metrics: new RpcMetrics() },
                [urls[1]]: { metrics: new RpcMetrics() },
                [urls[2]]: { metrics: new RpcMetrics() },
                [urls[3]]: { metrics: new RpcMetrics() },
            },
            lastUsedRpcIndex: 3,
        } as any;

        const result = new RpcState(configs);
        assert.deepEqual(result.urls, expected.urls);
        assert.deepEqual(result.configs, expected.configs);
        assert.deepEqual(result.lastUsedRpcIndex, expected.lastUsedRpcIndex);
        assert.deepEqual(result.lastUsedUrl, urls[3]);
        for (const item in result.rpcs) {
            assert.deepEqual(result.rpcs[item].metrics, expected.rpcs[item].metrics);
        }
    });

    it("test next rpc from state", async function () {
        const urls = configs.map((v) => v.url);
        const state = new RpcState(configs);

        // set arbitrary req and success for each rpc
        // 40% success rate
        state.rpcs[urls[0]].metrics.progress.req = 100;
        state.rpcs[urls[0]].metrics.progress.success = 40;

        // 30% success rate
        state.rpcs[urls[1]].metrics.progress.req = 100;
        state.rpcs[urls[1]].metrics.progress.success = 30;

        // 20% success rate
        state.rpcs[urls[2]].metrics.progress.req = 100;
        state.rpcs[urls[2]].metrics.progress.success = 20;

        // 10% success rate
        state.rpcs[urls[3]].metrics.progress.req = 100;
        state.rpcs[urls[3]].metrics.progress.success = 10;

        const results = {
            [urls[0]]: 0,
            [urls[1]]: 0,
            [urls[2]]: 0,
            [urls[3]]: 0,
        };

        // run next rpc 10000 times
        for (let i = 0; i < 10000; i++) {
            state.nextRpc;
            const next = state.lastUsedUrl;
            if (next === urls[0]) results[urls[0]]++;
            if (next === urls[1]) results[urls[1]]++;
            if (next === urls[2]) results[urls[2]]++;
            if (next === urls[3]) results[urls[3]]++;
        }

        // convert to percentage
        results[urls[0]] /= 100;
        results[urls[1]] /= 100;
        results[urls[2]] /= 100;
        results[urls[3]] /= 100;

        // results for number of times each rpc was picked
        // should be close to the success rate percentage
        assert.closeTo(results[urls[0]], 40, 2.5); // close to 40%
        assert.closeTo(results[urls[1]], 30, 2.5); // close to 30%
        assert.closeTo(results[urls[2]], 20, 2.5); // close to 20%
        assert.closeTo(results[urls[3]], 10, 2.5); // close to 10%
    });

    it("should normalize url", async function () {
        const url1 = "https://example1.com/";
        const result1 = normalizeUrl(url1);
        assert.equal(result1, "https://example1.com/");

        const url2 = "https://example2.com";
        const result2 = normalizeUrl(url2);
        assert.equal(result2, "https://example2.com/");
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
        assert.equal(result.requestIntervals.length, 1);
        assert.ok(result.lastRequestTimestamp > 0);
        assert.equal(result.timeout, 2);
        assert.ok(
            result.requestIntervals[0] >= 1950,
            "request intervals should be close to 2 seconds",
        );
        assert.ok(
            result.avgRequestIntervals >= 1950,
            "avg request intervals should be close to 2 seconds",
        );

        // wait 3 seconds and then record yet another request
        await sleep(3000);
        result.recordRequest();

        assert.equal(result.req, 3);
        assert.equal(result.success, 0);
        assert.equal(result.failure, 0);
        assert.deepEqual(result.cache, {});
        assert.equal(result.requestIntervals.length, 2);
        assert.ok(result.lastRequestTimestamp > 0);
        assert.equal(result.timeout, 3);
        assert.ok(
            result.requestIntervals[0] >= 1950,
            "first request intervals should be close to 2 seconds",
        );
        assert.ok(
            result.requestIntervals[1] >= 2950,
            "second request intervals should be close to 3 seconds",
        );
        assert.ok(
            result.avgRequestIntervals >= 2450,
            "avg request intervals should be close to 2.5 seconds",
        );
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

    it("should utilize cache property", async function () {
        const metrics = new RpcMetrics();
        metrics.cache["testKey"] = "testValue";
        metrics.cache["complexKey"] = { nested: "object" };

        const expected = {
            testKey: "testValue",
            complexKey: { nested: "object" },
        };
        assert.deepEqual(metrics.cache, expected);

        // Ensure cache persists through request recording
        metrics.recordRequest();
        assert.deepEqual(metrics.cache, expected);

        // Ensure cache persists through response recording
        metrics.recordSuccess();
        assert.deepEqual(metrics.cache, expected);

        // Ensure cache persists through response recording
        metrics.recordFailure();
        assert.deepEqual(metrics.cache, expected);

        // Ensure cache persists through reset
        metrics.reset();
        assert.deepEqual(metrics.cache, expected);
    });
});

describe("Test RpcProgress", async function () {
    it("should init RpcProgress", async function () {
        const result = new RpcProgress({
            selectionWeight: 2,
            trackSize: 50,
            url: "",
        });
        assert.equal(result.req, 0);
        assert.equal(result.success, 0);
        assert.equal(result.trackSize, 50);
        assert.equal(result.selectionWeight, 2);
    });

    it("should record new request", async function () {
        const result = new RpcProgress();

        // record a request
        result.recordRequest();
        assert.equal(result.req, 1);
        assert.equal(result.success, 0);

        result.recordRequest();
        assert.equal(result.req, 2);
        assert.equal(result.success, 0);
    });

    it("should record successful response", async function () {
        const result = new RpcProgress({
            trackSize: 20,
            url: "",
        });

        for (let i = 0; i < 30; i++) {
            const expected = Math.min(i + 1, 20);
            result.recordRequest();
            result.recordSuccess();
            assert.equal(result.req, expected);
            assert.equal(result.success, expected);
        }
    });

    it("should record get success rate", async function () {
        const result = new RpcProgress();
        assert.equal(result.req, 0);
        assert.equal(result.success, 0);
        assert.equal(result.successRate, 100);

        result.recordRequest();
        assert.equal(result.req, 1);
        assert.equal(result.success, 0);
        assert.equal(result.successRate, 1);

        result.recordRequest();
        result.recordSuccess();
        assert.equal(result.req, 2);
        assert.equal(result.success, 1);
        assert.equal(result.successRate, 50);
    });

    it("should record get selection rate", async function () {
        const result1 = new RpcProgress();
        assert.equal(result1.req, 0);
        assert.equal(result1.success, 0);
        assert.equal(result1.selectionRate, 100);

        result1.recordRequest();
        assert.equal(result1.req, 1);
        assert.equal(result1.success, 0);
        assert.equal(result1.selectionRate, 1);

        result1.recordRequest();
        result1.recordSuccess();
        assert.equal(result1.req, 2);
        assert.equal(result1.success, 1);
        assert.equal(result1.selectionRate, 50);

        const result2 = new RpcProgress({
            selectionWeight: 2.5,
            url: "",
        });
        assert.equal(result2.req, 0);
        assert.equal(result2.success, 0);
        assert.equal(result2.selectionRate, 250);

        result2.recordRequest();
        assert.equal(result2.req, 1);
        assert.equal(result2.success, 0);
        assert.equal(result2.selectionRate, 2);

        result2.recordRequest();
        result2.recordSuccess();
        assert.equal(result2.req, 2);
        assert.equal(result2.success, 1);
        assert.equal(result2.selectionRate, 125);
    });
});
