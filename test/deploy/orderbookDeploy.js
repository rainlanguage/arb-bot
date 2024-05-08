const fs = require("fs");
const { ethers } = require("hardhat");
const { basicDeploy } = require("../utils");
const OrderbookV3NPE2Artifact = require("../abis/OrderBook.json");

exports.deployOrderBookNPE2 = async(expressionDeployer) => {
    return await basicDeploy(
        OrderbookV3NPE2Artifact,
        {
            meta: ethers.utils.hexlify(fs.readFileSync("./test/abis/meta/OrderBook.rain.meta")),
            deployer: expressionDeployer.address,
        }
    );
};