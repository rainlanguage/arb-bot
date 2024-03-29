const fs = require("fs");
const { ethers } = require("hardhat");
const { basicDeploy } = require("../utils");
const CloneFactoryArtifact = require("../abis/CloneFactory.json");
const CloneFactoryNewArtifact = require("../abis/CloneFactoryNew.json");
const CloneFactoryNewNewArtifact = require("../abis/new/CloneFactory.json");


exports.cloneFactoryDeploy = async(expressionDeployer, np = false, np2 = false) => {
    const meta = "0xff0a89c674ee7874a4005901be789ce5563d4fc33010ddfb2ba2cc59288281b51d608001010355852ece158c1c3bf2476984f8ef38491d92d429ae5a8981a1529abb7beff99dcfce6212459ff6174531e585d12abe8a16f57ff7be8e1191178223efc5fb395b0c8d92037b280bb49931649944a5e2a49fc621afc319164c942887713d28ef44bf9270f6b4d438ca9da38631dea6b0cbda3e2f7f4a76f8949686e868be5dd59c2a22d6282165786bd99ece668237395470fbbca2af1d05ad3252475eba21274c9b82a113d688da0ab2e4a0f1d6684829a3baacb2b9e0059415fd16abc5214e8890155a6d6ac036f8cde07609860fecf55bdb5f812bbe13fa1e286f2c1b2a47294fa0f97cea538d9b0289c6ec1ad4dba8765bead42747b101d106582897d7a947ee24576675a042ed1a023ea31437b9dd63b99d75a8b6691020d89d56e6c254982b600a9390be64b8c1ac5fe1f570f71069f52ab428d2e7dfe0e8f0f72a5481b12fa617975e05267db71df04970552791303a6a470cdac884ad6defff5b87f728a0be79f8132584d93b384480ff58c58f5907607fbf0f395183bdf35e6941e605ce42061abc2401c3d0353716469f64fd0737eba05b7c6578fd2951376fb29c7c039909768e011bffe5ffb4a3ff2cde02706170706c69636174696f6e2f6a736f6e03676465666c617465";
    const metaNew = "0xff0a89c674ee7874a500590180cd543d4fc33010fd2b2873178a60606d85e85006be0650874b7c0523c78eec73698afadfb9b4094eda244415039b3feebd7777efecd7af48eacc938bae79999834331a75b9959ad06a508f7986d175044258742e1a451ad2e24060a64c8e964fa819b21d1da1e39cb0864d9120e0f697dbc5e810e5c8fa84cea6a5d254bac4acd042ac70ce0ccfe389d1fb186934af97f22d6824d5be54219f29dca93802c2b92788a59294f39d363a83bce00df149c56d6c5951d9a9c58fc44c4b92a0e4068a046e402a148100ad3d84fed617afbb3a5306dc19ba07a977d59f9f2075310e62b8ce302114b7e0de0f2439accbc43a0324e44175e043d24fba922af26e86b7641e802f68cd2c65db529e4ad89b2cf0416eb08d00d8c53c359e3996a01c8e9acd10b86677c255ff743b6440e76cf77279de8f2faf6a5c3efee0f203591531806ce0c329af8fe662c58dfb57cd39e2920d7fff863351fc8fb550d5de117e4e9a41a155dd4fe8c4e4fb0c15d06b685589f13438a9f6c2877d7a4baf779f2943be01011bffe5ffb4a3ff2cde02706170706c69636174696f6e2f6a736f6e03676465666c6174650462656e";
    const npe2meta = ethers.utils.hexlify(fs.readFileSync("./test/abis/new/meta/CloneFactory.rain.meta"));

    return await basicDeploy(
        np
            ? np2
                ? CloneFactoryNewNewArtifact
                : CloneFactoryNewArtifact
            : CloneFactoryArtifact,
        {
            meta: np ? np2 ? npe2meta : metaNew : meta,
            deployer: expressionDeployer.address,
        }
    );
};
