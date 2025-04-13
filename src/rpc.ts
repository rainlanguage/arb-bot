/**
 * Rain solver rpc state, keeps track of rpc metrics during runtime
 */
export class RpcState {
    /** List of rpc urls */
    readonly urls: string[];
    /** A key/value object keeping metrics of each rpc */
    metrics: Record<string, RpcMetrics>;

    /**
     * Creates a new instance
     * @param rpcUrls - The rpcs urls
     */
    constructor(rpcUrls: string[]) {
        // set normalized urls
        this.urls = rpcUrls.map((v) => normalizeUrl(v));

        // init metrics for each url as k/v
        this.metrics = {};
        this.urls.forEach((url) => (this.metrics[url] = new RpcMetrics()));
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

    /** Creates a new instance */
    constructor() {}

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
        this.success++;
    }

    /** Records a failure response */
    recordFailure() {
        this.failure++;
    }
}

/**
 * Normalizes the given url
 */
export function normalizeUrl(url: string): string {
    return url.endsWith("/") ? url : `${url}/`;
}
