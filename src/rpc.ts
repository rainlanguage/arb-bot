import { promiseTimeout, sleep } from "./utils";
import { onFetchRequest, onFetchResponse } from "./config";
import { http, Transport, HttpTransportConfig } from "viem";
import { RainSolverTransportTimeoutError } from "./transport";

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
    async nextRpc({
        timeout = 10_000,
        pollingInterval = 250,
    }: {
        timeout?: number;
        pollingInterval?: number;
    }): Promise<Transport> {
        // rpcs selection rate, each rate determines the probability of selecting that
        // rpc which is just a percentage of that rpc's latest success rate in 2 fixed
        // point decimalss relative to other rpcs sucess rates, so the bigger the rate,
        // the higher chance of being selected
        const rates = this.urls.map((url) => this.metrics[url].progress.selectionRate);
        return await promiseTimeout(
            (async () => {
                for (;;) {
                    // pick a random one
                    const index = probablyPicksNext(rates);
                    if (isNaN(index)) {
                        await sleep(pollingInterval);
                    } else {
                        this.lastUsedRpcIndex = index;
                        return this.transports[this.urls[index]];
                    }
                }
            })(),
            timeout,
            new RainSolverTransportTimeoutError(timeout),
        );
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
        this.failure++;
    }
}

/** A helper enum type for a rpc response */
export enum RpcResponseType {
    Success,
    Failure,
}

/**
 * Holds progress details of a rpc that persist during runtime rounds
 */
export class RpcProgress {
    /** Number of latest requests to keep track of, default is 100 */
    trackSize = 100;
    /** Multiplier to selection rate of this rpc, default is 1 */
    selectionWeight = 1;
    /** Number of latest successful requests, max possible value equals to trackSize */
    success: number;
    /** The buffer that keeps the latest response types with the length of trackSize */
    buffer: RpcResponseType[];

    /**
     * Creates a new instance with given configuration
     * @param config - (optional) The rpc configurations
     */
    constructor(config?: RpcConfig) {
        this.success = 0;
        if (typeof config?.trackSize === "number") {
            this.trackSize = config.trackSize;
        }
        if (typeof config?.selectionWeight === "number") {
            this.selectionWeight = config.selectionWeight;
        }
        this.buffer = Array(this.selectionWeight).fill(RpcResponseType.Failure);
    }

    /** Current success rate in 2 fixed decimals points percentage */
    get successRate() {
        if (this.buffer.length === 0) return 10_000;
        return Math.ceil((this.success / this.buffer.length) * 10_000);
    }

    /**
     * Current selection rate, determines the relative chance to get picked.
     * min of 0.25% if zero success rate, in order to allow for a slim chance of
     * being picked again so it doesnt get stuck at zero rate forever, in case
     * of 2 fixed point decimals, 0.25% equates to 25
     */
    get selectionRate() {
        return Math.max(Math.ceil(this.successRate * this.selectionWeight), 25);
    }

    /** Handles a request */
    recordRequest() {
        // we consider every req a failure, it only gets changed
        // to success when the success response gets recorded
        //
        // buffer length saturates at trackSize
        this.buffer.push(RpcResponseType.Failure);
        if (this.buffer.length > this.trackSize) {
            // knock the first itme out
            if (this.buffer[0] === RpcResponseType.Success) this.success--;
            this.buffer = this.buffer.slice(1);
        }
    }

    /** Records a success response */
    recordSuccess() {
        // set the latest item in buffer to success
        const index = this.buffer.lastIndexOf(RpcResponseType.Failure);
        if (index > -1) {
            this.success++;
            this.buffer[index] = RpcResponseType.Success;
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
 * Probably picks an item from the given array of success rates as probablities,
 * rates are in 2 fixed point decimalss
 * @param rates - The array of success rates to select from
 * @returns The index of the picked item from the array or NaN if out-of-range
 */
export function probablyPicksNext(rates: number[]): number {
    // pick a random int from [1, max] range
    const max = 10_000 * rates.length;
    const pick = Math.floor(Math.random() * max) + 1;

    // we now match the selection rates against
    // picked random int to get picked index
    for (let i = 0; i < rates.length; i++) {
        const offset = 10_000 * i;
        const lowerBound = offset + 1;
        const upperBound = offset + rates[i];
        if (lowerBound <= pick && pick <= upperBound) {
            return i;
        }
    }

    // out-of-range, picked value didnt match an item from the given list
    return NaN;
}
