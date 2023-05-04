const { OpMeta } = require("./meta");
const { ethers } = require("hardhat");
const { rainterpreterDeploy, rainterpreterStoreDeploy } = require("./rainterpreter");
const ExpressionDeployerArtifact = require("../abis/RainterpreterExpressionDeployer.json");


exports.rainterpreterExpressionDeployerDeploy = async(interpreter, store) => {
    const config = {
        interpreter: interpreter.address,
        store: store.address,
        meta: OpMeta,
    };
    const factory = await ethers.getContractFactory(
        ExpressionDeployerArtifact.abi,
        ExpressionDeployerArtifact.bytecode
    );
    const contract = await factory.deploy(config);
    await contract.deployed();
    return contract;
};

exports.getTouchDeployer = async() => {
    const interpreter = await rainterpreterDeploy();
    const store = await rainterpreterStoreDeploy();
    return await this.rainterpreterExpressionDeployerDeploy(
        interpreter,
        store
    );
};
