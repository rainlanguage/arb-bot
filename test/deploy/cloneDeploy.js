const fs = require("fs");
const { ethers } = require("hardhat");
const { basicDeploy } = require("../utils");
const CloneFactoryNewNewArtifact = require("../abis/CloneFactory.json");


exports.cloneFactoryDeploy = async(expressionDeployer) => {
    const npe2meta = ethers.utils.hexlify(fs.readFileSync("./test/abis/meta/CloneFactory.rain.meta"));

    return await basicDeploy(
        CloneFactoryNewNewArtifact,
        {
            meta: npe2meta,
            deployer: expressionDeployer.address,
        }
    );
};
