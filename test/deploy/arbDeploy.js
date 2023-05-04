const { ethers } = require("hardhat");
const { strict: assert } = require("assert");
const { cloneFactoryDeploy } = require("./cloneDeploy");
const { getEventArgs, basicDeploy } = require("../utils");
const ZeroExOrderBookFlashBorrowerArtifact = require("../../src/abis/ZeroExOrderBookFlashBorrower.json");


exports.zeroExCloneDeploy = async(
    expressionDeployer,
    orderbookAddress,
    proxyAddress,
    evaluableConfig
) => {
    const encodedConfig = ethers.utils.defaultAbiCoder.encode(
        [
            "tuple(address orderBook,address zeroExExchangeProxy,tuple(address deployer,bytes[] sources,uint256[] constants) evaluableConfig)",
        ],
        [{
            orderBook : orderbookAddress,
            zeroExExchangeProxy: proxyAddress,
            evaluableConfig
        }]
    );

    const cloneFactory = await cloneFactoryDeploy(expressionDeployer);
    const arb = await basicDeploy(ZeroExOrderBookFlashBorrowerArtifact);

    const zeroExClone = await cloneFactory.clone(
        arb.address,
        encodedConfig
    );
    const cloneEvent = await getEventArgs(
        zeroExClone,
        "NewClone",
        cloneFactory
    );

    const zeroEx = new ethers.Contract(
        ethers.utils.hexZeroPad(
            ethers.utils.hexStripZeros(cloneEvent.clone),
            20 // address bytes length
        ),
        ZeroExOrderBookFlashBorrowerArtifact.abi
    );

    assert(!(cloneEvent.clone === ethers.constants.zeroAddress), "zeroEx clone zero address");

    return zeroEx;
};