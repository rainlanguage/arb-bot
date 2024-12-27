import { assert } from "chai";
import { ChainId } from "sushi";
import { BotConfig, ViemClient } from "../src/types";
import { estimateGasCost, getL1Fee, getTxFee } from "../src/gas";
import { createViemClient, getChainConfig } from "../src/config";

describe("Test gas", async function () {
    it("should estimate gas correctly for L1 and L2 chains", async function () {
        // mock l1 signer
        const l1Signer = {
            getL1BaseFee: async () => 20n,
            estimateL1Gas: async () => 5n,
        };
        // mock normal signer
        const signer = {
            estimateGas: async () => 55n,
            getGasPrice: async () => 2n,
        } as any as ViemClient;
        const tx = {
            data: "0x1234" as `0x${string}`,
            to: ("0x" + "1".repeat(40)) as `0x${string}`,
        };

        // estimate gas as special L2 chain
        const botconfig = { isSpecialL2: true, gasPriceMultiplier: 100n } as any as BotConfig;
        const result1 = await estimateGasCost(tx, signer, botconfig, undefined, l1Signer);
        const expected1 = {
            gas: 55n,
            gasPrice: 2n,
            l1Gas: 5n,
            l1GasPrice: 20n,
            l1Cost: 20n * 5n,
            totalGasCost: 2n * 55n + 20n * 5n,
        };
        assert.deepEqual(result1, expected1);

        // estimate as usual chain
        botconfig.isSpecialL2 = false;
        const result2 = await estimateGasCost(tx, signer, botconfig);
        const expected2 = {
            gas: 55n,
            gasPrice: 2n,
            l1Gas: 0n,
            l1GasPrice: 0n,
            l1Cost: 0n,
            totalGasCost: 2n * 55n,
        };
        assert.deepEqual(result2, expected2);
    });

    it("should get tx L1 gas cost from receipt", async function () {
        const config = getChainConfig(ChainId.BASE);
        const viemclient = await createViemClient(ChainId.BASE, ["https://rpc.ankr.com/base"]);
        const hash = "0x18219497dc46babfbdc58fad112bf01ed584148bf06727cc97cb105915fd96b0";
        const receipt = await viemclient.getTransactionReceipt({ hash });

        const result = getL1Fee(receipt, config as any as BotConfig);
        const expected = 43615200401n; // known L1 cost taken from the actual tx
        assert.equal(result, expected);
    });

    it("should get tx fee", async function () {
        const config = {} as any;
        const receipt = {
            effectiveGasPrice: 10n,
            gasUsed: 5n,
        } as any;

        // normal
        let result = getTxFee(receipt, config);
        assert.equal(result, 50n);

        // l2 chain
        config.isSpecialL2 = true;
        receipt.l1Fee = 50n;
        result = getTxFee(receipt, config);
        assert.equal(result, 100n);
    });
});
