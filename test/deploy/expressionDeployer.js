const { basicDeploy } = require("../utils");
const RainterpreterExpressionDeployerNPE2Artifact = require("../abis/RainterpreterExpressionDeployerNPE2.json");

exports.rainterpreterExpressionDeployerNPE2Deploy = async(interpreter, store, parser) => {
    return await basicDeploy(
        RainterpreterExpressionDeployerNPE2Artifact,
        {
            interpreter: interpreter.address,
            store: store.address,
            parser: parser.address,
        }
    );
};