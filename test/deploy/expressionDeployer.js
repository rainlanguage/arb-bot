const fs = require("fs");
const { ethers } = require("hardhat");
const { basicDeploy } = require("../utils");
const { OpMeta, NPOpMeta } = require("./meta");
const { rainterpreterDeploy, rainterpreterStoreDeploy } = require("./rainterpreterDeploy");
const ExpressionDeployerArtifact = require("../abis/RainterpreterExpressionDeployer.json");
const ExpressionDeployerNPArtifact = require("../abis/RainterpreterExpressionDeployerNP.json");
const ExpressionDeployerNPE2Artifact = require("../abis/new/RainterpreterExpressionDeployerNPE2.json");


exports.rainterpreterExpressionDeployerDeploy = async(interpreter, store, np = false) => {
    return await basicDeploy(
        np ? ExpressionDeployerNPArtifact : ExpressionDeployerArtifact,
        np ? {
            interpreter: interpreter.address,
            store: store.address,
            authoringMeta: NPOpMeta,
        }
        : {
            interpreter: interpreter.address,
            store: store.address,
            meta: OpMeta,
        }
    );
};

exports.rainterpreterExpressionDeployerNPE2Deploy = async(interpreter, store, parser) => {
    return await basicDeploy(
        ExpressionDeployerNPE2Artifact,
        {
            interpreter: interpreter.address,
            store: store.address,
            parser: parser.address,
            meta: ethers.utils.hexlify(Uint8Array.from(fs.readFileSync("./test/abis/new/meta/RainterpreterExpressionDeployerNPE2.rain.meta"))),
        }
    );
};

exports.getTouchDeployer = async() => {
    const interpreter = await rainterpreterDeploy();
    const store = await rainterpreterStoreDeploy();
    return await this.rainterpreterExpressionDeployerDeploy(
        interpreter,
        store
    );
};
