const { ethers } = require("hardhat");
const { ContractMeta } = require("./meta");
const OrderbookArtifact = require("../abis/OrderBook.json");


exports.deployOrderBook = async (expressionDeployer) => {
    const config = {
        meta: ContractMeta,
        deployer: expressionDeployer.address,
    };
    const factory = await ethers.getContractFactory(
        OrderbookArtifact.abi,
        OrderbookArtifact.bytecode
    );
    const contract = await factory.deploy(config);
    await contract.deployed();
    return contract;
};