const { ethers } = require("hardhat");
const CloneFactoryArtifact = require("../abis/CloneFactory.json");


exports.cloneFactoryDeploy = async (expressionDeployer) => {
    const meta = "0xff0a89c674ee7874a4005901be789ce5563d4fc33010ddfb2ba2cc59288281b51d608001010355852ece158c1c3bf2476984f8ef38491d92d429ae5a8981a1529abb7beff99dcfce6212459ff6174531e585d12abe8a16f57ff7be8e1191178223efc5fb395b0c8d92037b280bb49931649944a5e2a49fc621afc319164c942887713d28ef44bf9270f6b4d438ca9da38631dea6b0cbda3e2f7f4a76f8949686e868be5dd59c2a22d6282165786bd99ece668237395470fbbca2af1d05ad3252475eba21274c9b82a113d688da0ab2e4a0f1d6684829a3baacb2b9e0059415fd16abc5214e8890155a6d6ac036f8cde07609860fecf55bdb5f812bbe13fa1e286f2c1b2a47294fa0f97cea538d9b0289c6ec1ad4dba8765bead42747b101d106582897d7a947ee24576675a042ed1a023ea31437b9dd63b99d75a8b6691020d89d56e6c254982b600a9390be64b8c1ac5fe1f570f71069f52ab428d2e7dfe0e8f0f72a5481b12fa617975e05267db71df04970552791303a6a470cdac884ad6defff5b87f728a0be79f8132584d93b384480ff58c58f5907607fbf0f395183bdf35e6941e605ce42061abc2401c3d0353716469f64fd0737eba05b7c6578fd2951376fb29c7c039909768e011bffe5ffb4a3ff2cde02706170706c69636174696f6e2f6a736f6e03676465666c617465";

    const config_ = {
        meta: meta,
        deployer: expressionDeployer.address,
    };

    const factory = await ethers.getContractFactory(
        CloneFactoryArtifact.abi,
        CloneFactoryArtifact.bytecode
    );
    const contract = await factory.deploy(config_);
    await contract.deployed();

    return contract;
};
