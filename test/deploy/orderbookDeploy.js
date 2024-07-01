const { basicDeploy } = require("../utils");
const OrderbookArtifact = require("../abis/OrderBook.json");

exports.deployOrderBookNPE2 = async() => {
    return await basicDeploy(OrderbookArtifact);
};