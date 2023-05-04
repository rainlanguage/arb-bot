const { basicDeploy } = require("../utils");
const RainterpreterArtifact = require("../abis/Rainterpreter.json");
const RainterpreterStoreArtifact = require("../abis/RainterpreterStore.json");


exports.rainterpreterDeploy = async () => {
    return await basicDeploy(RainterpreterArtifact);
};

exports.rainterpreterStoreDeploy = async () => {
    return await basicDeploy(RainterpreterStoreArtifact);
};