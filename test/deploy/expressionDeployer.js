const { OpMeta } = require("./meta");
const { basicDeploy } = require("../utils");
const { rainterpreterDeploy, rainterpreterStoreDeploy } = require("./rainterpreterDeploy");
const ExpressionDeployerArtifact = require("../abis/RainterpreterExpressionDeployer.json");


exports.rainterpreterExpressionDeployerDeploy = async(interpreter, store) => {
    return await basicDeploy(
        ExpressionDeployerArtifact,
        {
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
