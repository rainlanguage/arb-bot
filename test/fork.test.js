const { assert } = require("chai");
const { ethers } = require("ethers");
const { Fork } = require("../src/fork");
const { erc20Abi } = require("../src/abis");

describe("Test forking evm", async function () {
    it("should fork from rpc", async function () {
        const provider = new ethers.providers.JsonRpcProvider(process?.env?.TEST_POLYGON_RPC);

        const blockNumber = await provider.getBlockNumber();
        const block = await provider.getBlock(blockNumber);

        const fork = await Fork.create(process?.env?.TEST_POLYGON_RPC, block, 137);
        const forkLastBlock = await fork.hardhatNode.getLatestBlock();

        assert.equal(BigInt(block.difficulty), forkLastBlock.header.difficulty);
        assert.equal(block.extraData, ethers.utils.hexlify(forkLastBlock.header.extraData));
        assert.equal(block.gasLimit.toBigInt(), forkLastBlock.header.gasLimit);
        assert.equal(block.gasUsed.toBigInt(), forkLastBlock.header.gasUsed);
        assert.equal(BigInt(block.number), forkLastBlock.header.number);
        assert.equal(BigInt(block.timestamp), forkLastBlock.header.timestamp);
        assert.equal(block.parentHash, ethers.utils.hexlify(forkLastBlock.header.parentHash));
        assert.equal(block.baseFeePerGas.toBigInt(), forkLastBlock.header.baseFeePerGas);
    });

    it("should return reliable gas estimation", async function () {
        const provider = new ethers.providers.JsonRpcProvider(process?.env?.TEST_POLYGON_RPC);

        const blockNumber = await provider.getBlockNumber();
        const block = await provider.getBlock(blockNumber);

        const fork = await Fork.create(process?.env?.TEST_POLYGON_RPC, block, 137);

        const erc20interface = new ethers.utils.Interface(erc20Abi);
        const from = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
        const to = "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270"; // wmatic
        const balanceOfCalldata = erc20interface.encodeFunctionData(
            "balanceOf",
            ["0x6d80113e533a2C0fe82EaBD35f1875DcEA89Ea97"]
        );
        const balanceOfRpcGas = await provider.estimateGas({ from, to, data: balanceOfCalldata });
        const balanceOfForkGas = await fork.estimateGas({ to, from, data: balanceOfCalldata });

        assert.ok(balanceOfRpcGas.eq(balanceOfForkGas));

        const symbolCalldata = erc20interface.encodeFunctionData("symbol", []);
        const symbolRpcGas = await provider.estimateGas({ from, to, data: symbolCalldata });
        const symbolForkGas = await fork.estimateGas({ to, from, data: symbolCalldata });

        assert.ok(symbolRpcGas.eq(symbolForkGas));
    });
});