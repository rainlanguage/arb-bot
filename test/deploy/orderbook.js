
// const { ethers } = require("hardhat");
const { ContractMeta } = require("./meta");
const { OrderbookArtifact } = require("../abis/OrderBook.json");
// const { DeployerDiscoverableMetaV1ConstructionConfigStruct } = require("../../../typechain/contracts/factory/CloneFactory");

// const { getRainMetaDocumentFromContract } = require("../../meta");
// const { getTouchDeployer } = require("./expressionDeployer");
const { basicDeploy } = require("../utils");

exports.deployOrderBook = async (expressionDeployer) => {
    // const touchDeployer = await getTouchDeployer();
    const config_ = {
        meta: ContractMeta,
        deployer: expressionDeployer.address,
    };

    return await basicDeploy(OrderbookArtifact, config_);
};