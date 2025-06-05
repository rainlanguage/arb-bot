import * as utils from "../utils";
import { BigNumber } from "ethers";
import { type SharedState } from "../state";
import { publicActionsL2 } from "viem/op-stack";
import { type RainSolverSigner } from "./index";
import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import {
    sendTx,
    waitUntilFree,
    getTxGas,
    getSelfBalance,
    estimateGasCost,
    RainSolverSignerActions,
} from "./actions";

vi.mock("viem/op-stack", () => ({
    publicActionsL2: vi.fn(),
}));

describe("Test RainSolverSignerActions", () => {
    it("should correctly create actions using fromSharedState()", () => {
        const mockSharedState = {
            watchedTokens: new Map([
                ["0xtoken1", { address: "0xtoken1", symbol: "TKN1", decimals: 18 }],
                ["0xtoken2", { address: "0xtoken2", symbol: "TKN2", decimals: 6 }],
            ]),
        } as SharedState;
        const mockSigner = {
            state: mockSharedState,
        } as RainSolverSigner;

        const actions = RainSolverSignerActions.fromSharedState(mockSharedState)(mockSigner);

        expect(actions.state).toBe(mockSharedState);
        expect(actions.busy).toBe(false);
        expect(actions.BALANCE).toEqual(BigNumber.from(0));
        expect(actions.BOUNTY).toEqual(Array.from(mockSharedState.watchedTokens.values()));
        expect(typeof actions.sendTx).toBe("function");
        expect(typeof actions.waitUntilFree).toBe("function");
        expect(typeof actions.getSelfBalance).toBe("function");
        expect(typeof actions.estimateGasCost).toBe("function");
    });
});

describe("Test sendTx", () => {
    let mockSigner: RainSolverSigner;
    const mockTx = {
        to: "0xdestination" as `0x${string}`,
        data: "0xdata" as `0x${string}`,
        gas: 100000n,
    };

    beforeEach(() => {
        mockSigner = {
            busy: false,
            account: {
                address: "0xsender",
            },
            state: {
                gasPrice: 20000000000n,
                gasPriceMultiplier: 110,
                chainConfig: {
                    isSpecialL2: false,
                },
                l1GasPrice: undefined,
            },
            waitUntilFree: vi.fn().mockResolvedValue(undefined),
            getTransactionCount: vi.fn().mockResolvedValue(5),
            sendTransaction: vi.fn().mockResolvedValue("0xhash"),
            estimateGas: vi.fn().mockResolvedValue(100000n),
        } as unknown as RainSolverSigner;

        vi.clearAllMocks();
    });

    it("should successfully send a transaction", async () => {
        const txHash = await sendTx(mockSigner, mockTx);

        expect(mockSigner.waitUntilFree).toHaveBeenCalled();
        expect(mockSigner.getTransactionCount).toHaveBeenCalledWith({
            address: "0xsender",
            blockTag: "latest",
        });
        expect(mockSigner.sendTransaction).toHaveBeenCalledWith({
            ...mockTx,
            nonce: 5,
        });
        expect(txHash).toBe("0xhash");
        expect(mockSigner.busy).toBe(false);
    });

    it("should wait until signer is free before sending", async () => {
        let busyResolved = false;
        mockSigner.waitUntilFree = vi.fn().mockImplementation(async () => {
            busyResolved = true;
            return Promise.resolve();
        });

        await sendTx(mockSigner, mockTx);

        expect(busyResolved).toBe(true);
        expect(mockSigner.sendTransaction).toHaveBeenCalled();
    });

    it("should set busy state during transaction and reset after success", async () => {
        const states: boolean[] = [];
        mockSigner.sendTransaction = vi.fn().mockImplementation(async () => {
            states.push(mockSigner.busy);
            return "0xhash";
        });

        expect(mockSigner.busy).toBe(false);
        await sendTx(mockSigner, mockTx);
        expect(mockSigner.busy).toBe(false);
        expect(states).toContain(true); // Was busy during transaction
    });

    it("should reset busy state even if transaction fails", async () => {
        const error = new Error("Transaction failed");
        mockSigner.sendTransaction = vi.fn().mockRejectedValue(error);

        expect(mockSigner.busy).toBe(false);
        await expect(sendTx(mockSigner, mockTx)).rejects.toThrow(error);
        expect(mockSigner.busy).toBe(false);
    });

    it("should handle waitUntilFree failure", async () => {
        const error = new Error("Wait until free failed");
        mockSigner.waitUntilFree = vi.fn().mockRejectedValue(error);

        await expect(sendTx(mockSigner, mockTx)).rejects.toThrow(error);
        expect(mockSigner.busy).toBe(false);
        expect(mockSigner.sendTransaction).not.toHaveBeenCalled();
    });

    it("should handle getTransactionCount failure", async () => {
        const error = new Error("Failed to get nonce");
        mockSigner.getTransactionCount = vi.fn().mockRejectedValue(error);

        await expect(sendTx(mockSigner, mockTx)).rejects.toThrow(error);
        expect(mockSigner.busy).toBe(false);
        expect(mockSigner.sendTransaction).not.toHaveBeenCalled();
    });

    it("should use provided gas", async () => {
        const txWithGas = {
            ...mockTx,
            gas: 200000n,
        };

        await sendTx(mockSigner, txWithGas);

        expect(mockSigner.sendTransaction).toHaveBeenCalledWith(
            expect.objectContaining({
                gas: 200000n,
            }),
        );
    });
});

describe("Test estimateGasCost", () => {
    let mockSigner: RainSolverSigner;
    const mockTx = {
        to: "0xdestination" as `0x${string}`,
        data: "0xdata" as `0x${string}`,
    };

    beforeEach(() => {
        mockSigner = {
            state: {
                gasPrice: 20000000000n, // 20 gwei
                gasPriceMultiplier: 110, // 110%
                chainConfig: {
                    isSpecialL2: false,
                },
                l1GasPrice: undefined,
            },
            estimateGas: vi.fn().mockResolvedValue(100000n),
            extend: vi.fn(),
        } as unknown as RainSolverSigner;
    });

    it("should calculate basic gas cost non-L2 chains", async () => {
        const result = await estimateGasCost(mockSigner, mockTx);

        expect(mockSigner.estimateGas).toHaveBeenCalledWith(mockTx);
        expect(result).toEqual({
            gas: 100000n,
            gasPrice: 22000000000n, // 20 gwei * 110%
            l1GasPrice: 0n,
            l1Cost: 0n,
            totalGasCost: 2200000000000000n, // gas * gasPrice
        });
    });

    it("should calculate gas cost including L2 fees chain is special L2", async () => {
        const mockL2Client = {
            getL1BaseFee: vi.fn().mockResolvedValue(50000000000n), // 50 gwei
            estimateL1Fee: vi.fn().mockResolvedValue(500000000000n), // 500 gwei
        };
        mockSigner.state.chainConfig.isSpecialL2 = true;
        (mockSigner.extend as Mock).mockReturnValue(mockL2Client);

        const result = await estimateGasCost(mockSigner, mockTx);

        expect(mockSigner.extend).toHaveBeenCalledWith(publicActionsL2());
        expect(mockL2Client.getL1BaseFee).toHaveBeenCalled();
        expect(mockL2Client.estimateL1Fee).toHaveBeenCalledWith({
            to: mockTx.to,
            data: mockTx.data,
        });
        expect(result).toEqual({
            gas: 100000n,
            gasPrice: 22000000000n,
            l1GasPrice: 50000000000n,
            l1Cost: 500000000000n,
            totalGasCost: 22000000000n * 100000n + 500000000000n, // L2 gas cost + L1 cost
        });
    });

    it("should use state L1 gas price", async () => {
        const mockL2Client = {
            getL1BaseFee: vi.fn(),
            estimateL1Fee: vi.fn().mockResolvedValue(500000000000n),
        };
        mockSigner.state.chainConfig.isSpecialL2 = true;
        mockSigner.state.l1GasPrice = 40000000000n; // 40 gwei
        (mockSigner.extend as Mock).mockReturnValue(mockL2Client);

        const result = await estimateGasCost(mockSigner, mockTx);

        expect(mockL2Client.getL1BaseFee).not.toHaveBeenCalled();
        expect(result.l1GasPrice).toBe(0n);
    });

    it("should handle L2 estimation errors gracefully", async () => {
        const mockL2Client = {
            getL1BaseFee: vi.fn().mockRejectedValue(new Error("L1 fee estimation failed")),
            estimateL1Fee: vi.fn().mockRejectedValue(new Error("L2 fee estimation failed")),
        };
        mockSigner.state.chainConfig.isSpecialL2 = true;
        (mockSigner.extend as Mock).mockReturnValue(mockL2Client);

        const result = await estimateGasCost(mockSigner, mockTx);

        expect(result).toEqual({
            gas: 100000n,
            gasPrice: 22000000000n,
            l1GasPrice: 0n,
            l1Cost: 0n,
            totalGasCost: 2200000000000000n, // Only L2 gas cost
        });
    });
});

describe("Test getTxGas", () => {
    const originalGas = 100000n;

    it("should return original gas when no transactionGas is set", () => {
        const mockSigner = {
            state: {
                transactionGas: undefined,
            },
        } as RainSolverSigner;
        const result = getTxGas(mockSigner, originalGas);

        expect(result).toBe(originalGas);
    });

    it("should apply percentage multiplier when transactionGas ends with %", () => {
        const mockSigner = {
            state: {
                transactionGas: "150%", // 150% of original gas
            },
        } as RainSolverSigner;
        const result = getTxGas(mockSigner, originalGas);

        expect(result).toBe(150000n); // 100000 * 150 / 100
    });

    it("should use fixed gas value when transactionGas is a number string", () => {
        const mockSigner = {
            state: {
                transactionGas: "200000",
            },
        } as RainSolverSigner;
        const result = getTxGas(mockSigner, originalGas);

        expect(result).toBe(200000n);
    });
});

describe("Test waitUntilFree", () => {
    let mockSigner: RainSolverSigner;
    let sleepSpy: any;

    beforeEach(() => {
        mockSigner = {
            busy: true,
        } as unknown as RainSolverSigner;

        sleepSpy = vi.spyOn(utils, "sleep");
        vi.clearAllMocks();
    });

    it("should call sleep once and resolve after 30 ms", async () => {
        setTimeout(() => (mockSigner.busy = false), 10); // set busy to false after 10 ms
        await waitUntilFree(mockSigner);

        expect(sleepSpy).toHaveBeenCalledTimes(1);
        expect(sleepSpy).toHaveBeenCalledWith(30);
    });

    it("should call sleep ywice and resolve after 60 ms", async () => {
        setTimeout(() => (mockSigner.busy = false), 40); // set busy to false after 40 ms
        await waitUntilFree(mockSigner);

        expect(sleepSpy).toHaveBeenCalledTimes(2);
        expect(sleepSpy).toHaveBeenCalledWith(30);
    });
});

describe("Test getSelfBalance", () => {
    it("should return the balance for the signer's address", async () => {
        const mockSigner = {
            account: {
                address: "0xuser",
            },
            getBalance: vi.fn(),
        } as unknown as RainSolverSigner;
        const expectedBalance = 1000000n;
        (mockSigner.getBalance as any).mockResolvedValue(expectedBalance);
        const balance = await getSelfBalance(mockSigner);

        expect(mockSigner.getBalance).toHaveBeenCalledWith({
            address: "0xuser",
        });
        expect(balance).toBe(expectedBalance);
    });
});
