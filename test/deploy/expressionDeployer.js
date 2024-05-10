const fs = require("fs");
const { ethers } = require("hardhat");
const { basicDeploy } = require("../utils");
const { rainterpreterDeploy, rainterpreterStoreDeploy } = require("./rainterpreterDeploy");
const ExpressionDeployerNPE2Artifact = require("../abis/RainterpreterExpressionDeployerNPE2.json");

exports.rainterpreterExpressionDeployerNPE2Deploy = async(interpreter, store, parser) => {
    return await basicDeploy(
        ExpressionDeployerNPE2Artifact,
        {
            interpreter: interpreter.address,
            store: store.address,
            parser: parser.address,
            meta: ethers.utils.hexlify(Uint8Array.from(fs.readFileSync("./test/abis/meta/RainterpreterExpressionDeployerNPE2.rain.meta"))),
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
