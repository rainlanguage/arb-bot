const { ethers } = require("hardhat");
const { basicDeploy } = require("../utils");
const { DefaultArbEvaluable } = require("../../src/abis");
const RouteProcessorOrderBookV4ArbOrderTakerArtifact = require("../abis/RouteProcessorOrderBookV4ArbOrderTaker.json");

exports.arbDeploy = async(
    orderbookAddress,
    rpAddress,
) => {
    return await basicDeploy(
        RouteProcessorOrderBookV4ArbOrderTakerArtifact,
        {
            orderBook: orderbookAddress,
            evaluable: DefaultArbEvaluable,
            implementationData: ethers.utils.defaultAbiCoder.encode(["address"], [rpAddress])
        }
    );
};
