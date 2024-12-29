import fs from "fs";
import { deployerAbi } from "./abis";
import { BigNumber, utils } from "ethers";
import { Dispair, ViemClient } from "./types";
import { parseAbi, PublicClient, stringToHex } from "viem";
import { MetaStore, RainDocument } from "@rainlanguage/dotrain";

export const TaskEntryPoint: string[] = ["main"] as const;

export const EnsureBountyDotrainPath = "./tasks/ensure-bounty.rain" as const;
export const WithdrawEnsureBountyDotrainPath = "./tasks/withdraw-ensure-bounty.rain" as const;

/**
 * Get the bounty check ensure task rainlang
 * @param inputToEthPrice - Input token to Eth price
 * @param outputToEthPrice - Output token to Eth price
 * @param minimumExcepted - Minimum expected amount
 * @param sender - The msg sender
 */
export async function getBountyEnsureRainlang(
    inputToEthPrice: BigNumber,
    outputToEthPrice: BigNumber,
    minimumExcepted: BigNumber,
    sender: string,
): Promise<string> {
    const text = fs.readFileSync(EnsureBountyDotrainPath, { encoding: "utf8" });
    return await RainDocument.composeText(text, TaskEntryPoint, new MetaStore(), [
        ["sender", sender],
        ["input-to-eth-price", utils.formatUnits(inputToEthPrice)],
        ["output-to-eth-price", utils.formatUnits(outputToEthPrice)],
        ["minimum-excepted", utils.formatUnits(minimumExcepted)],
    ]);
}

/**
 * Get the bounty check ensure task rainlang for clear2 withdraw
 * @param botAddress - Bot wallet address
 * @param inputToken - Input token address
 * @param outputToken - Output token address
 * @param orgInputBalance - Input token original balance
 * @param orgOutputBalance - Output token original balance
 * @param inputToEthPrice - Input token to Eth price
 * @param outputToEthPrice - Output token to Eth price
 * @param minimumExcepted - Minimum expected amount
 * @param sender - The msg sender
 */
export async function getWithdrawEnsureRainlang(
    botAddress: string,
    inputToken: string,
    outputToken: string,
    orgInputBalance: BigNumber,
    orgOutputBalance: BigNumber,
    inputToEthPrice: BigNumber,
    outputToEthPrice: BigNumber,
    minimumExcepted: BigNumber,
    sender: string,
): Promise<string> {
    const text = fs.readFileSync(WithdrawEnsureBountyDotrainPath, { encoding: "utf8" });
    return await RainDocument.composeText(text, TaskEntryPoint, new MetaStore(), [
        ["sender", sender],
        ["input-to-eth-price", utils.formatUnits(inputToEthPrice)],
        ["output-to-eth-price", utils.formatUnits(outputToEthPrice)],
        ["minimum-excepted", utils.formatUnits(minimumExcepted)],
        ["bot-address", botAddress],
        ["input-token", inputToken],
        ["output-token", outputToken],
        ["original-input-balance", utils.formatUnits(orgInputBalance)],
        ["original-output-balance", utils.formatUnits(orgOutputBalance)],
    ]);
}

/**
 * Calls parse2 on a given deployer to parse the given rainlang text
 */
export async function parseRainlang(
    rainlang: string,
    viemClient: ViemClient | PublicClient,
    dispair: Dispair,
): Promise<string> {
    return await viemClient.readContract({
        address: dispair.deployer as `0x${string}`,
        abi: parseAbi(deployerAbi),
        functionName: "parse2",
        args: [stringToHex(rainlang)],
    });
}
