import { WalletManager } from ".";
import { TokenDetails } from "../state";
import { RainSolverSigner } from "../signer";
import { PreAssembledSpan } from "../logger";
import { SpanStatusCode } from "@opentelemetry/api";
import { describe, it, expect, vi, Mock, beforeEach } from "vitest";
import { transferTokenFrom, transferRemainingGasFrom } from "./sweep";

vi.mock("viem", async (importOriginal) => {
    return {
        ...(await importOriginal()),
        encodeFunctionData: vi.fn().mockReturnValue("0xencodedData"),
    };
});

describe("Test sweep functions", () => {
    let mockWalletManager: WalletManager;
    let mockSigner: RainSolverSigner;
    let mockToken: TokenDetails;

    beforeEach(() => {
        // reset all mocks
        vi.clearAllMocks();
        vi.resetAllMocks();

        // setup mock token
        mockToken = {
            address: "0xtoken" as `0x${string}`,
            symbol: "TEST",
            decimals: 18,
        };

        // setup mock signer
        mockSigner = {
            account: { address: "0xsigner" },
            readContract: vi.fn(),
            writeContract: vi.fn(),
            getSelfBalance: vi.fn(),
            estimateGasCost: vi.fn(),
            waitForTransactionReceipt: vi.fn(),
            sendTx: vi.fn(),
        } as any;

        // setup mock wallet manager
        mockWalletManager = {
            mainWallet: { address: "0xmain" },
            fundWallet: vi.fn(),
        } as any;
    });

    describe("Test transferTokenFrom", () => {
        it("should return early if token balance is zero", async () => {
            (mockSigner.readContract as Mock).mockResolvedValue(0n);

            const result = await transferTokenFrom.call(mockWalletManager, mockSigner, mockToken);

            expect(result).toEqual({ amount: 0n });
            expect(mockSigner.writeContract).not.toHaveBeenCalled();
        });

        it("should fund wallet if gas balance is insufficient", async () => {
            (mockSigner.readContract as Mock).mockResolvedValue(100n);
            (mockSigner.getSelfBalance as Mock).mockResolvedValue(50n);
            (mockSigner.estimateGasCost as Mock).mockResolvedValue({ totalGasCost: 100n });
            (mockWalletManager.fundWallet as Mock).mockResolvedValue({});
            (mockSigner.writeContract as Mock).mockResolvedValue("0xhash");
            (mockSigner.waitForTransactionReceipt as Mock).mockResolvedValue({ status: "success" });

            await transferTokenFrom.call(mockWalletManager, mockSigner, mockToken);

            expect(mockWalletManager.fundWallet).toHaveBeenCalledWith(
                mockSigner.account.address,
                110n, // 110% of gas cost
            );
        });

        it("should handle funding failure", async () => {
            (mockSigner.readContract as Mock).mockResolvedValue(100n);
            (mockSigner.getSelfBalance as Mock).mockResolvedValue(50n);
            (mockSigner.estimateGasCost as Mock).mockResolvedValue({ totalGasCost: 100n });

            const mockSpan = new PreAssembledSpan("test");
            mockSpan.setStatus({ code: SpanStatusCode.ERROR, message: "Funding failed" });
            (mockWalletManager.fundWallet as Mock).mockRejectedValue(mockSpan);

            await expect(
                transferTokenFrom.call(mockWalletManager, mockSigner, mockToken),
            ).rejects.toThrow("Funding failed");
        });

        it("should successfully transfer tokens", async () => {
            (mockSigner.readContract as Mock).mockResolvedValue(100n);
            (mockSigner.getSelfBalance as Mock).mockResolvedValue(1000n);
            (mockSigner.estimateGasCost as Mock).mockResolvedValue({ totalGasCost: 50n });
            (mockSigner.writeContract as Mock).mockResolvedValue("0xhash");
            (mockSigner.waitForTransactionReceipt as Mock).mockResolvedValue({ status: "success" });

            const result = await transferTokenFrom.call(mockWalletManager, mockSigner, mockToken);

            expect(result).toEqual({ amount: 100n, txHash: "0xhash" });
        });

        it("should handle failed transfer transaction", async () => {
            (mockSigner.readContract as Mock).mockResolvedValue(100n);
            (mockSigner.getSelfBalance as Mock).mockResolvedValue(1000n);
            (mockSigner.estimateGasCost as Mock).mockResolvedValue({ totalGasCost: 50n });
            (mockSigner.writeContract as Mock).mockResolvedValue("0xhash");
            (mockSigner.waitForTransactionReceipt as Mock).mockResolvedValue({
                status: "reverted",
            });

            await expect(
                transferTokenFrom.call(mockWalletManager, mockSigner, mockToken),
            ).rejects.toMatchObject({
                txHash: "0xhash",
                error: new Error("Failed to transfer tokens, reason: transaction reverted onchain"),
            });
        });
    });

    describe("Test transferRemainingGasFrom", () => {
        it("should return early if gas balance is zero", async () => {
            (mockSigner.getSelfBalance as Mock).mockResolvedValue(0n);

            const result = await transferRemainingGasFrom.call(mockWalletManager, mockSigner);

            expect(result).toEqual({ amount: 0n });
            expect(mockSigner.sendTx).not.toHaveBeenCalled();
        });

        it("should return early if balance is less than gas cost", async () => {
            (mockSigner.getSelfBalance as Mock).mockResolvedValue(50n);
            (mockSigner.estimateGasCost as Mock).mockResolvedValue({ totalGasCost: 100n });

            const result = await transferRemainingGasFrom.call(mockWalletManager, mockSigner);

            expect(result).toEqual({ amount: 0n });
            expect(mockSigner.sendTx).not.toHaveBeenCalled();
        });

        it("should successfully transfer remaining gas", async () => {
            (mockSigner.getSelfBalance as Mock).mockResolvedValue(1000n);
            (mockSigner.estimateGasCost as Mock).mockResolvedValue({ totalGasCost: 100n });
            (mockSigner.sendTx as Mock).mockResolvedValue("0xhash");
            (mockSigner.waitForTransactionReceipt as Mock).mockResolvedValue({ status: "success" });

            const result = await transferRemainingGasFrom.call(mockWalletManager, mockSigner);

            expect(result).toMatchObject({
                txHash: "0xhash",
                amount: 898n,
            });
            expect(mockSigner.sendTx).toHaveBeenCalledWith({
                to: mockWalletManager.mainWallet.address,
                value: 898n,
            });
        });

        it("should handle failed gas transfer transaction", async () => {
            (mockSigner.getSelfBalance as Mock).mockResolvedValue(1000n);
            (mockSigner.estimateGasCost as Mock).mockResolvedValue({ totalGasCost: 100n });
            (mockSigner.sendTx as Mock).mockResolvedValue("0xhash");
            (mockSigner.waitForTransactionReceipt as Mock).mockResolvedValue({
                status: "reverted",
            });

            await expect(
                transferRemainingGasFrom.call(mockWalletManager, mockSigner),
            ).rejects.toMatchObject({
                txHash: "0xhash",
                error: new Error(
                    "Failed to transfer remaining gas, reason: transaction reverted onchain",
                ),
            });
        });
    });
});
