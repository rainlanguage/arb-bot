const { OpMeta, NPOpMeta } = require("./meta");
const { basicDeploy } = require("../utils");
const { rainterpreterDeploy, rainterpreterStoreDeploy } = require("./rainterpreterDeploy");
const ExpressionDeployerArtifact = require("../abis/RainterpreterExpressionDeployer.json");
const ExpressionDeployerNPArtifact = require("../abis/RainterpreterExpressionDeployerNP.json");


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

exports.getTouchDeployer = async() => {
    const interpreter = await rainterpreterDeploy();
    const store = await rainterpreterStoreDeploy();
    return await this.rainterpreterExpressionDeployerDeploy(
        interpreter,
        store
    );
};
