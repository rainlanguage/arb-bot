const fs = require("fs");
const { ethers } = require("hardhat");
const { strict: assert } = require("assert");
const { cloneFactoryDeploy } = require("./cloneDeploy");
const { getEventArgs, basicDeploy } = require("../utils");
const RouteProcessor3OrderBookV3ArbOrderTakerNewArtifact = require("../abis/RouteProcessorOrderBookV3ArbOrderTaker.json");


exports.arbDeploy = async(
    expressionDeployer,
    orderbookAddress,
    evaluableConfig,
    address,
) => {
    const  artifact = RouteProcessor3OrderBookV3ArbOrderTakerNewArtifact;
    const meta = ethers.utils.hexlify(fs.readFileSync(
        "./test/abis/meta/RouteProcessorOrderBookV3ArbOrderTaker.rain.meta"
    ));
    const implementationData = ethers.utils.defaultAbiCoder.encode(["address"], [address]);
    const encodedConfig = ethers.utils.defaultAbiCoder.encode(
        [
            "tuple(address orderBook,tuple(address deployer,bytes bytecode,uint256[] constants) evaluableConfig,bytes implementationData)",
        ],
        [{
            orderBook: orderbookAddress,
            evaluableConfig,
            implementationData,
        }]
    );

    const cloneFactory = await cloneFactoryDeploy(expressionDeployer);
    const arbImplementation = await basicDeploy(
        artifact,
        {
            deployer: expressionDeployer.address,
            meta
        }
    );

    const arbClone = await cloneFactory.clone(
        arbImplementation.address,
        encodedConfig
    );

    const cloneEvent = await getEventArgs(
        arbClone,
        "NewClone",
        cloneFactory
    );

    const arb = new ethers.Contract(
        ethers.utils.hexZeroPad(
            ethers.utils.hexStripZeros(cloneEvent.clone),
            20 // address bytes length
        ),
        artifact.abi
    );

    assert(!(cloneEvent.clone === ethers.constants.zeroAddress), "zeroEx clone zero address");

    return arb;
};