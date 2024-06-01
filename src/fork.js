const ethers = require("ethers");
const { HardhatNode } = require("hardhat/internal/hardhat-network/provider/node");

/**
 * Creates a fork evm from the given rpc at the given block number
 * @param {string} jsonRpcUrl - the rpc url
 * @param {number} block - the block details
 * @param {number} chainId - the network chain id
 */
async function createFork(jsonRpcUrl, block, chainId) {
    // hardhat node config, this fields are default,
    // except forkConfig, blockGasLimit, networkId, chainId and initialDate
    const hardhatNodeConfig = {
        automine: true,
        blockGasLimit: block.gasLimit,
        genesisAccounts: [],
        mempoolOrder: "priority",
        hardfork: "shanghai",
        chainId,
        networkId: chainId,
        initialDate: new Date(),
        forkConfig: {
            jsonRpcUrl,
            blockNumber: block.number,
        },
        forkCachePath: undefined,
        coinbase: "0xc014ba5ec014ba5ec014ba5ec014ba5ec014ba5e",
        chains: new Map(),
        allowBlocksWithSameTimestamp: false
    };
    const [common, hardhatNode] = await HardhatNode.create(hardhatNodeConfig);
    return [block, hardhatNodeConfig, common, hardhatNode];
}

class Fork {
    block;
    common;
    hardhatNode;
    hardhatNodeConfig;
    constructor() {}

    /**
     * Creates a fork evm from the given rpc at the given block number
     * @param {string} rpcUrl - the rpc url
     * @param {number} block - the block details
     * @param {number} chainId - the network's chain id
     * @returns a Fork instance
     */
    static async create(rpcUrl, block, chainId) {
        const fork = new Fork();
        [
            fork.block,
            fork.hardhatNodeConfig,
            fork.common,
            fork.hardhatNode,
        ] = await createFork(rpcUrl, block, chainId);
        return fork;
    }

    /**
     * Estimates gas for a given tx
     * @param tx - The raw transaction
     */
    async estimateGas({ to, from, data, gasPrice }) {
        if (!to || !ethers.utils.isAddress(to)) throw "invalid to address";
        if (!data || !ethers.utils.isBytesLike(data)) throw "invalid data";
        if (!from || !ethers.utils.isAddress(from)) throw "invalid from address";

        const tx = {
            to: Buffer.from(ethers.utils.arrayify(to)),
            from: Buffer.from(ethers.utils.arrayify(from)),
            data: Buffer.from(ethers.utils.arrayify(data)),
            gasLimit: this.hardhatNode.getBlockGasLimit(),
            value: 0n,
        };
        if (gasPrice && ethers.BigNumber.isBigNumber(gasPrice)) tx.gasPrice = gasPrice.toBigInt();
        return ethers.BigNumber.from(
            (await this.hardhatNode.estimateGas(tx, "pending")).estimation
        );
    }

}

module.exports = {
    createFork,
    Fork
};