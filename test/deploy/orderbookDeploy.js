const { OrderbookMeta, OrderBookV3Meta } = require("./meta");
const { basicDeploy } = require("../utils");
const OrderbookArtifact = require("../abis/OrderBook.json");
const OrderbookV3Artifact = require("../abis/OrderBookV3.json");


exports.deployOrderBook = async(expressionDeployer, v3 = false) => {
    return await basicDeploy(
        v3 ? OrderbookV3Artifact : OrderbookArtifact,
        {
            meta: v3 ? OrderBookV3Meta : OrderbookMeta,
            deployer: expressionDeployer.address,
        }
    );
};