const { ethers } = require("hardhat");
const { OpMeta } = require("./meta");
const ExpressionDeployerArtifact = require("../abis/RainterpreterExpressionDeployer.json");
const { rainterpreterDeploy, rainterpreterStoreDeploy } = require("./rainterpreter");
// const { basicDeploy } = require("../utils");


exports.rainterpreterExpressionDeployerDeploy = async(interpreter, store) => {
    console.log(ethers.utils.keccak256(OpMeta));
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
    // return await basicDeploy(
    //     ExpressionDeployerArtifact,
    //     config
    // );
};

exports.getTouchDeployer = async() => {
    const interpreter = await rainterpreterDeploy();
    const store = await rainterpreterStoreDeploy();
    return await this.rainterpreterExpressionDeployerDeploy(
        interpreter,
        store
    );
};
