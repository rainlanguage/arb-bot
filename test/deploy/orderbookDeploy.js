const fs = require("fs");
const { ethers } = require("hardhat");
const { basicDeploy } = require("../utils");
const OrderbookArtifact = require("../abis/OrderBook.json");
const { OrderbookMeta, OrderBookV3Meta } = require("./meta");
const OrderbookV3Artifact = require("../abis/OrderBookV3.json");
const OrderbookV3NPE2Artifact = require("../abis/new/OrderBook.json");


exports.deployOrderBook = async(expressionDeployer, v3 = false) => {
    return await basicDeploy(
        v3 ? OrderbookV3Artifact : OrderbookArtifact,
        {
            meta: v3 ? OrderBookV3Meta : OrderbookMeta,
            deployer: expressionDeployer.address,
        }
    );
};

exports.deployOrderBookNPE2 = async(expressionDeployer) => {
    return await basicDeploy(
        OrderbookV3NPE2Artifact,
        {
            meta: ethers.utils.hexlify(fs.readFileSync("./test/abis/new/meta/OrderBook.rain.meta")),
            deployer: expressionDeployer.address,
        }
    );
};