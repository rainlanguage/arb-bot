const { ContractMeta } = require("./meta");
const { basicDeploy } = require("../utils");
const OrderbookArtifact = require("../abis/OrderBook.json");


exports.deployOrderBook = async(expressionDeployer) => {
    return await basicDeploy(
        OrderbookArtifact,
        {
            meta: ContractMeta,
            deployer: expressionDeployer.address,
        }
    );
};