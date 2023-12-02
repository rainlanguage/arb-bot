const fs = require("fs");
const { ethers } = require("hardhat");
const { strict: assert } = require("assert");
const { GenericArbV3Meta } = require("./meta");
const { cloneFactoryDeploy } = require("./cloneDeploy");
const { getEventArgs, basicDeploy } = require("../utils");
const GenericPoolOrderBookFlashBorrowerArtifact = require("../abis/GenericPoolOrderBookFlashBorrower.json");
const GenericPoolOrderBookV3FlashBorrowerArtifact = require("../abis/GenericPoolOrderBookV3FlashBorrower.json");
const GenericPoolOrderBookV3ArbOrderTakerArtifact = require("../abis/GenericPoolOrderBookV3ArbOrderTaker.json");
const GenericPoolOrderBookV3ArbOrderTakerNewArtifact = require("../abis/new/GenericPoolOrderBookV3ArbOrderTaker.json");
const GenericPoolOrderBookV3FlashBorrowerNewArtifact = require("../abis/new/GenericPoolOrderBookV3FlashBorrower.json");
const RouteProcessor3OrderBookV3ArbOrderTakerArtifact = require("../abis/RouteProcessor3OrderBookV3ArbOrderTaker.json");
const RouteProcessor3OrderBookV3ArbOrderTakerNewArtifact = require("../abis/new/RouteProcessorOrderBookV3ArbOrderTaker.json");


exports.arbDeploy = async(
    expressionDeployer,
    orderbookAddress,
    evaluableConfig,
    mode,
    address,
    np2 = false
) => {
    let implementationData = "0x";
    let artifact = GenericPoolOrderBookFlashBorrowerArtifact;
    let encodedConfig;
    let meta = GenericArbV3Meta;

    if (!mode) encodedConfig = ethers.utils.defaultAbiCoder.encode(
        [
            "tuple(address orderBook,tuple(address deployer,bytes[] sources,uint256[] constants) evaluableConfig,bytes implementationData)",
        ],
        [{
            orderBook: orderbookAddress,
            evaluableConfig,
            implementationData,
        }]
    );
    if (mode === "srouter") {
        if (np2) {
            meta = ethers.utils.hexlify(fs.readFileSync(
                "./test/abis/new/meta/RouteProcessorOrderBookV3ArbOrderTaker.rain.meta"
            ));
        }
        artifact = np2
            ? RouteProcessor3OrderBookV3ArbOrderTakerNewArtifact
            : RouteProcessor3OrderBookV3ArbOrderTakerArtifact;
        implementationData = ethers.utils.defaultAbiCoder.encode(["address"], [address]);
    }
    if (mode === "flash-loan-v3") {
        if (np2) {
            meta = ethers.utils.hexlify(fs.readFileSync(
                "./test/abis/new/meta/GenericPoolOrderBookV3FlashBorrower.rain.meta"
            ));
        }
        artifact = np2
            ? GenericPoolOrderBookV3FlashBorrowerNewArtifact
            : GenericPoolOrderBookV3FlashBorrowerArtifact;
    }
    if (mode === "order-taker") {
        if (np2) {
            meta = ethers.utils.hexlify(fs.readFileSync(
                "./test/abis/new/meta/GenericPoolOrderBookV3ArbOrderTaker.rain.meta"
            ));
        }
        artifact = np2
            ? GenericPoolOrderBookV3ArbOrderTakerNewArtifact
            : GenericPoolOrderBookV3ArbOrderTakerArtifact;
    }
    if (mode) encodedConfig = ethers.utils.defaultAbiCoder.encode(
        [
            "tuple(address orderBook,tuple(address deployer,bytes bytecode,uint256[] constants) evaluableConfig,bytes implementationData)",
        ],
        [{
            orderBook: orderbookAddress,
            evaluableConfig,
            implementationData,
        }]
    );

    let arbImplementation;
    const _isNew = /flash-loan-v3|order-taker|srouter/.test(mode);
    const cloneFactory = await cloneFactoryDeploy(
        expressionDeployer,
        _isNew,
        np2
    );

    if (_isNew) arbImplementation = await basicDeploy(
        artifact,
        {
            deployer: expressionDeployer.address,
            meta
        }
    );
    else arbImplementation = await basicDeploy(artifact);

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