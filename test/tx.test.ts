import { ethers } from "ethers";
import { getLocal } from "mockttp";
import fixtures from "./data";

describe("Test tx", async function () {
    const mockServer = getLocal();
    let signer = {};
    let viemClient = {};
    const {
        gasPrice,
        gasLimitEstimation,
        arb,
        vaultBalance,
        orderPairObject1: orderPairObject,
        config: fixtureConfig,
        poolCodeMap,
        expectedRouteVisual,
        pair,
        orderbook,
        txHash,
        effectiveGasPrice,
        gasUsed,
        scannerUrl,
        getCurrentPrice,
        expectedRouteData,
        getCurrentInputToEthPrice,
        orderbooksOrders,
        getAmountOut,
    } = fixtures;
    beforeEach(() => {
        mockServer.start(8090);
        // config.gasCoveragePercentage = "0";
        signer = {
            account: { address: "0x1F1E4c845183EF6d50E9609F16f6f9cAE43BC9Cb" },
            BALANCE: ethers.BigNumber.from(0),
            BOUNTY: [],
            getAddress: () => "0x1F1E4c845183EF6d50E9609F16f6f9cAE43BC9Cb",
            getBlockNumber: async () => 123456,
            getGasPrice: async () => gasPrice,
            estimateGas: async () => gasLimitEstimation,
            sendTransaction: async () => txHash,
            getTransactionCount: async () => 0,
            waitForTransactionReceipt: async () => {
                return {
                    status: "success",
                    effectiveGasPrice,
                    gasUsed,
                    logs: [],
                    events: [],
                };
            },
        };
        viemClient = {
            chain: { id: 137 },
            multicall: async () => [vaultBalance.toBigInt()],
            getGasPrice: async () => gasPrice.toBigInt(),
            getBlockNumber: async () => 123456n,
            getTransactionCount: async () => 0,
            waitForTransactionReceipt: async () => {
                return {
                    status: "success",
                    effectiveGasPrice,
                    gasUsed,
                    logs: [],
                    events: [],
                };
            },
        };
    });
    afterEach(() => mockServer.stop());

    it("handle transaction successfuly", async function () {});

    it("handle fail to submit transaction", async function () {});

    it("should handle success transaction successfuly", async function () {});

    it("should handle revert transaction successfuly", async function () {});

    it("should handle dropped transaction successfuly", async function () {});
});
