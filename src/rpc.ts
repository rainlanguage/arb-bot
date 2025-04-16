import { randomInt } from "crypto";
import { onFetchRequest, onFetchResponse } from "./config";
import { http, Transport, HttpTransportConfig } from "viem";

/** The rpc configurations */
export type RpcConfig = {
    /** The rpc url */
    url: string;
    /** The number of latest requests to keep track of, default is 100 */
    trackSize?: number;
    /** The selection weight for this rpc, default is 1 */
    selectionWeight?: number;
    /** Viem transport configuration */
    transportConfig?: Pick<HttpTransportConfig, "key" | "name" | "batch" | "fetchOptions">;
};

export type RpcWithTransport = { transport: Transport; metrics: RpcMetrics };

/**
 * Rain solver rpc state, manages and keeps track of rpcs during runtime
 */
export class RpcState {
    /** List of rpc urls */
    readonly urls: string[];
    /** A key/value object keeping metrics of each rpc */
    metrics: Record<string, RpcMetrics>;
    /** A key/value object keeping viem transport of each rpc */
    transports: Record<string, Transport>;
    /** Keeps the index of the rpc that was used for the latest request */
    lastUsedRpcIndex: number;

    /**
     * Creates a new instance
     * @param configs - The list of rpc configs
     */
    constructor(public configs: RpcConfig[]) {
        // throw if no rpc is given
        if (!configs.length) throw "empty list, expected at least one rpc";

        // set normalized urls
        this.urls = configs.map((v) => normalizeUrl(v.url));
        this.lastUsedRpcIndex = configs.length - 1;

        // for each url as k/v
        this.metrics = {};
        this.transports = {};
        configs.forEach((conf, i) => {
            this.metrics[this.urls[i]] = new RpcMetrics(conf);
            this.transports[this.urls[i]] = http(conf.url, {
                ...conf.transportConfig,
                onFetchRequest: onFetchRequest.bind(this),
                onFetchResponse: onFetchResponse.bind(this),
            });
        });
    }

    /**
     * Last used rpc
     */
    get lastUsedRpc(): Transport {
        return this.transports[this.lastUsedUrl];
    }
    /**
     * Last used rpc url
     */
    get lastUsedUrl(): string {
        return this.urls[this.lastUsedRpcIndex];
    }
    /**
     * Get next rpc to use which is picked based on past performance
     */
    get nextRpc(): Transport {
        // return early if only 1 rpc is available
        if (this.urls.length === 1) {
            return this.lastUsedRpc;
        }

        // rpcs selection ranges, each range determines the probability of
        // selecting that rpc which is just a percentage of that rpc's latest
        // success rate, so the bigger the rate, the higher chance of being selected
        let zerosRatesCount = 0;
        let selectionRanges = this.urls.map((url) => {
            const rate = this.metrics[url].progress.selectionRate;
            if (!rate) zerosRatesCount++;
            return rate;
        });

        // set 1% for each zero success rate rpc in order for them to have a slim chance
        // of being picked again so their rates wont get stuck once they hit zero rate
        if (zerosRatesCount) {
            const acc = selectionRanges.reduce((a, b) => a + b, 0);
            const zeroRange = Math.ceil(acc / (100 - zerosRatesCount));
            selectionRanges = selectionRanges.map((v) => (!v ? zeroRange : v));
        }

        // pick a random rpc based on their past performnace rates
        const index = selectRandom(selectionRanges);
        this.lastUsedRpcIndex = index;
        return this.transports[this.urls[index]];
    }
}

/**
 * Metrics of a rpc consumption details
 */
export class RpcMetrics {
    /** Number of requests */
    req = 0;
    /** Number of successful requests */
    success = 0;
    /** Number of unsuccessful requests */
    failure = 0;
    /** Last request timestamp in milliseconds unix format */
    lastRequestTimestamp = 0;
    /** List of times between 2 consecutive requests in milliseconds */
    requestIntervals: number[] = [];
    /** A utility cache, that can hold any data betwen separate requests */
    cache: Record<string, any> = {};
    /** Hold progress details of this rpc */
    progress: RpcProgress;

    /**
     * Creates a new instance
     * @param config - (optional) The rpc configurations
     */
    constructor(config?: RpcConfig) {
        this.progress = new RpcProgress(config);
    }

    /** Number of timeout requests */
    get timeout() {
        return Math.max(this.req - (this.success + this.failure), 0);
    }

    /** Average request intervals */
    get avgRequestIntervals() {
        return Math.floor(
            this.requestIntervals.reduce((a, b) => a + b, 0) /
                Math.max(this.requestIntervals.length, 1),
        );
    }

    /** Resets the records */
    reset() {
        this.req = 0;
        this.success = 0;
        this.failure = 0;
        this.requestIntervals = [];
    }

    /** Handles a request */
    recordRequest() {
        this.req++;
        this.progress.recordRequest();
        const now = Date.now();
        if (!this.lastRequestTimestamp) {
            this.lastRequestTimestamp = now;
        } else {
            const prevRequestTimestamp = this.lastRequestTimestamp;
            this.lastRequestTimestamp = now;
            this.requestIntervals.push(now - prevRequestTimestamp);
        }
    }

    /** Records a success response */
    recordSuccess() {
        this.progress.recordSuccess();
        this.success++;
    }

    /** Records a failure response */
    recordFailure() {
        this.progress.recordFailure();
        this.failure++;
    }
}

/**
 * Holds progress details of a rpc that persist during runtime rounds
 */
export class RpcProgress {
    /** Number of latest requests to keep track of, default is 1000 */
    trackSize = 1000;
    /** Multiplier to selection frequency of this rpc, default is 1 */
    selectionWeight = 1;
    /** Number of latest requests, max possible value equals to trackSize */
    req: number;
    /** Number of latest successful requests, max possible value equals to trackSize */
    success: number;

    /**
     * Creates a new instance with given configuration
     * @param config - (optional) The rpc configurations
     */
    constructor(config?: RpcConfig) {
        this.req = 0;
        this.success = 0;
        if (typeof config?.trackSize === "number") {
            this.trackSize = config.trackSize;
        }
        if (typeof config?.selectionWeight === "number") {
            this.selectionWeight = config.selectionWeight;
        }
    }

    /** Current success rate in 2 fixed decimal points percentage */
    get successRate() {
        if (this.req === 0) return 10_000;
        return Math.ceil((this.success / this.req) * 10_000);
    }

    /** Current selection rate, determines the relative chance to get picked  */
    get selectionRate() {
        return Math.ceil(this.successRate * this.selectionWeight);
    }

    /** Handles a request */
    recordRequest() {
        // saturates at trackSize
        if (this.req < this.trackSize) {
            this.req = Math.min(this.trackSize, this.req + 1);
        }
    }

    /** Records a success response */
    recordSuccess() {
        this.success = Math.min(this.trackSize, this.success + 1);
    }

    /** Records a failure response */
    recordFailure() {
        if (this.req === this.trackSize) {
            this.success = Math.max(0, this.success - 1);
        }
    }
}

/**
 * Normalizes the given url
 */
export function normalizeUrl(url: string): string {
    return url.endsWith("/") ? url : `${url}/`;
}

/**
 * Picks a item randomly from the given array of probability ranges
 * @param selectionRanges - The array of probability ranges to select from
 * @returns The index of the picked item from the array
 */
export function selectRandom(selectionRanges: number[]): number {
    // pick a random int between min/max range
    const max = selectionRanges.reduce((a, b) => a + b, 1);
    const pick = randomInt(1, max);

    // we now match the selection rages against
    // picked random int to get picked index
    let fallback = 0;
    for (let i = 0; i < selectionRanges.length; i++) {
        if (selectionRanges[i] > fallback) {
            // fallback set to the one with biggest range, this cant really happen
            // but for the purpose of type saftey and assurance of always returning
            // a valid value we'll use it
            fallback = selectionRanges[i];
        }
        const offset = selectionRanges.slice(0, i).reduce((a, b) => a + b, 0);
        const lowerBound = offset + 1;
        const upperBound = offset + selectionRanges[i];
        if (lowerBound <= pick && pick <= upperBound) {
            return i;
        }
    }

    // unreachable, but added for type saftey
    return fallback;
}
