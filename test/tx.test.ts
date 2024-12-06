import { assert } from "chai";
import fixtures from "./data";
import { ethers } from "ethers";
import { handleReceipt, handleTransaction } from "../src/tx";
import { InsufficientFundsError, TransactionReceipt } from "viem";
import { ProcessPairHaltReason, ProcessPairReportStatus } from "../src/processOrders";

describe("Test tx", async function () {
    let signer: any = {};
    let viemClient: any = {};
    const {
        orderPairObject1: orderPairObject,
        config,
        pair,
        orderbook,
        txHash,
        scannerUrl,
        toToken,
        fromToken,
    } = fixtures;
    const gasUsed = 10n;
    const effectiveGasPrice = 44n;
    const inputToEthPrice = "1.5";
    const outputToEthPrice = "0.5";
    beforeEach(() => {
        // mock signer and viemClient before each test
        signer = {
            chain: config.chain,
            account: { address: "0x1F1E4c845183EF6d50E9609F16f6f9cAE43BC9Cb" },
            BALANCE: ethers.BigNumber.from(0),
            BOUNTY: [],
            BUSY: false,
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
            chain: config.chain,
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

    it("handle transaction successfuly", async function () {
        const spanAttributes = {};
        const rawtx = {
            to: "0x" + "1".repeat(40),
            data: "",
        };
        const res = {
            reason: undefined,
            error: undefined,
            gasCost: undefined,
            spanAttributes,
            report: {
                status: ProcessPairReportStatus.FoundOpportunity,
                tokenPair: pair,
                buyToken: orderPairObject.buyToken,
                sellToken: orderPairObject.sellToken,
            },
        };
        const result = await (
            await handleTransaction(
                signer,
                viemClient,
                spanAttributes,
                rawtx as any,
                orderbook,
                orderPairObject,
                inputToEthPrice,
                outputToEthPrice,
                res,
                pair,
                toToken,
                fromToken,
                config as any,
            )
        )();
        const expected = {
            reason: undefined,
            error: undefined,
            gasCost: ethers.BigNumber.from(gasUsed * effectiveGasPrice),
            spanAttributes: {
                "details.txUrl": scannerUrl + "/tx/" + txHash,
                didClear: true,
            },
            report: {
                status: ProcessPairReportStatus.FoundOpportunity,
                txUrl: scannerUrl + "/tx/" + txHash,
                tokenPair: pair,
                buyToken: orderPairObject.buyToken,
                sellToken: orderPairObject.sellToken,
                clearedAmount: undefined,
                actualGasCost: ethers.utils.formatUnits(gasUsed * effectiveGasPrice),
                income: undefined,
                inputTokenIncome: undefined,
                outputTokenIncome: undefined,
                netProfit: undefined,
                clearedOrders: [orderPairObject.takeOrders[0].id],
            },
        };
        assert.deepEqual(result, expected);
    });

    it("handle fail to submit transaction", async function () {
        // mock signer to reject the sendTransaction
        signer.sendTransaction = async () => {
            throw new InsufficientFundsError();
        };
        const spanAttributes = {};
        const rawtx = {
            to: "0x" + "1".repeat(40),
            data: "",
        };
        const res = {
            reason: undefined,
            error: undefined,
            gasCost: undefined,
            spanAttributes,
            report: {
                status: ProcessPairReportStatus.FoundOpportunity,
                tokenPair: pair,
                buyToken: orderPairObject.buyToken,
                sellToken: orderPairObject.sellToken,
            },
        };
        try {
            await (
                await handleTransaction(
                    signer,
                    viemClient,
                    spanAttributes,
                    rawtx as any,
                    orderbook,
                    orderPairObject,
                    inputToEthPrice,
                    outputToEthPrice,
                    res,
                    pair,
                    toToken,
                    fromToken,
                    config as any,
                )
            )();
            assert.fail("expected to fail, but resolved");
        } catch (e) {
            const x = {
                error: new InsufficientFundsError(),
                gasCost: undefined,
                reason: ProcessPairHaltReason.TxFailed,
                report: {
                    buyToken: orderPairObject.buyToken,
                    sellToken: orderPairObject.sellToken,
                    status: ProcessPairReportStatus.FoundOpportunity,
                    tokenPair: pair,
                },
                spanAttributes: {
                    "details.rawTx": JSON.stringify({
                        to: rawtx.to,
                        data: "",
                        nonce: 0,
                        from: signer.account.address,
                    }),
                    txNoneNodeError: false,
                },
            };
            assert.deepEqual(e, x);
        }
    });

    it("should handle success transaction receipt successfuly", async function () {
        const receipt: Promise<TransactionReceipt> = (async () => ({
            status: "success", // success tx receipt
            effectiveGasPrice,
            gasUsed,
            logs: [],
            events: [],
        }))() as any;
        const spanAttributes = {};
        const rawtx: any = {
            to: "0x" + "1".repeat(40),
            data: "",
        };
        const txUrl = scannerUrl + "/tx/" + txHash;
        const res = {
            reason: undefined,
            error: undefined,
            gasCost: undefined,
            spanAttributes,
            report: {
                status: ProcessPairReportStatus.FoundOpportunity,
                tokenPair: pair,
                buyToken: orderPairObject.buyToken,
                sellToken: orderPairObject.sellToken,
            },
        };
        const result = await handleReceipt(
            txHash,
            await receipt,
            signer,
            spanAttributes,
            rawtx,
            orderbook,
            orderPairObject,
            inputToEthPrice,
            outputToEthPrice,
            res,
            txUrl,
            pair,
            toToken,
            fromToken,
            config as any,
            0,
        );
        const expected = {
            reason: undefined,
            error: undefined,
            gasCost: ethers.BigNumber.from(gasUsed * effectiveGasPrice),
            spanAttributes: { didClear: true },
            report: {
                status: 3,
                txUrl,
                tokenPair: pair,
                buyToken: orderPairObject.buyToken,
                sellToken: orderPairObject.sellToken,
                clearedAmount: undefined,
                actualGasCost: ethers.utils.formatUnits(gasUsed * effectiveGasPrice),
                income: undefined,
                inputTokenIncome: undefined,
                outputTokenIncome: undefined,
                netProfit: undefined,
                clearedOrders: [orderPairObject.takeOrders[0].id],
            },
        };
        assert.deepEqual(result, expected);
    });

    it("should handle revert transaction receipt successfuly", async function () {
        // mock signer to throw on tx simulation
        signer.call = async () => {
            throw new InsufficientFundsError();
        };
        const receipt: Promise<TransactionReceipt> = (async () => ({
            status: "revert", // revert tx receipt
            effectiveGasPrice,
            gasUsed,
            logs: [],
            events: [],
        }))() as any;
        const spanAttributes = {};
        const rawtx: any = {
            to: "0x" + "1".repeat(40),
            data: "",
        };
        const txUrl = scannerUrl + "/tx/" + txHash;
        const res = {
            reason: undefined,
            error: undefined,
            gasCost: undefined,
            spanAttributes,
            report: {
                status: ProcessPairReportStatus.FoundOpportunity,
                tokenPair: pair,
                buyToken: orderPairObject.buyToken,
                sellToken: orderPairObject.sellToken,
            },
        };
        try {
            await handleReceipt(
                txHash,
                await receipt,
                signer,
                spanAttributes,
                rawtx,
                orderbook,
                orderPairObject,
                inputToEthPrice,
                outputToEthPrice,
                res,
                txUrl,
                pair,
                toToken,
                fromToken,
                config as any,
                0,
            );
            assert.fail("expected to fail, but resolved");
        } catch (e) {
            const expected = {
                reason: ProcessPairHaltReason.TxReverted,
                error: {
                    err: "transaction reverted onchain, account ran out of gas for transaction gas cost",
                    nodeError: false,
                    snapshot:
                        "transaction reverted onchain, account ran out of gas for transaction gas cost",
                },
                gasCost: undefined,
                spanAttributes: { txNoneNodeError: true },
                report: {
                    status: ProcessPairReportStatus.FoundOpportunity,
                    txUrl,
                    tokenPair: pair,
                    buyToken: orderPairObject.buyToken,
                    sellToken: orderPairObject.sellToken,
                    actualGasCost: ethers.utils.formatUnits(gasUsed * effectiveGasPrice),
                },
            };
            assert.deepEqual(e, expected);
        }
    });
});
