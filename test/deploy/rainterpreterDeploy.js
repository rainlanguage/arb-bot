const { basicDeploy } = require("../utils");
const RainterpreterArtifact = require("../abis/Rainterpreter.json");
const RainterpreterNPArtifact = require("../abis/RainterpreterNP.json");
const RainterpreterStoreArtifact = require("../abis/RainterpreterStore.json");
const RainterpreterStoreNPArtifact = require("../abis/RainterpreterStoreNP.json");


exports.rainterpreterDeploy = async (np = false) => {
    return await basicDeploy(
        np ? RainterpreterNPArtifact : RainterpreterArtifact
    );
};

exports.rainterpreterStoreDeploy = async (np = false) => {
    return await basicDeploy(
        np ? RainterpreterStoreNPArtifact : RainterpreterStoreArtifact
    );
};