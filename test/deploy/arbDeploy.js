const { ethers } = require("hardhat");
const { strict: assert } = require("assert");
const { cloneFactoryDeploy } = require("./cloneDeploy");
const { getEventArgs, basicDeploy } = require("../utils");
const ZeroExOrderBookFlashBorrowerArtifact = require("../abis/ZeroExOrderBookFlashBorrower.json");
const GenericPoolOrderBookFlashBorrowerArtifact = require("../abis/GenericPoolOrderBookFlashBorrower.json");


exports.arbDeploy = async(
    expressionDeployer,
    orderbookAddress,
    evaluableConfig,
    // proxyAddress = "",
) => {
    const artifact = GenericPoolOrderBookFlashBorrowerArtifact;
    const implementationData = "0x";
    // if (proxyAddress) {
    //     implementationData = ethers.utils.defaultAbiCoder.encode(["address"], [proxyAddress]);
    //     artifact = ZeroExOrderBookFlashBorrowerArtifact;
    // }
    const encodedConfig = ethers.utils.defaultAbiCoder.encode(
        [
            "tuple(address orderBook,tuple(address deployer,bytes[] sources,uint256[] constants) evaluableConfig,bytes implementationData)",
        ],
        [{
            orderBook: orderbookAddress,
            evaluableConfig,
            implementationData,
        }]
    );

    const cloneFactory = await cloneFactoryDeploy(expressionDeployer);
    const arbImplementation = await basicDeploy(artifact);

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
        ZeroExOrderBookFlashBorrowerArtifact.abi
    );

    assert(!(cloneEvent.clone === ethers.constants.zeroAddress), "zeroEx clone zero address");

    return arb;
};