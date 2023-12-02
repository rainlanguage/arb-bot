const { basicDeploy } = require("../utils");
const RainterpreterArtifact = require("../abis/Rainterpreter.json");
const RainterpreterNPArtifact = require("../abis/RainterpreterNP.json");
const RainterpreterStoreArtifact = require("../abis/RainterpreterStore.json");
const RainterpreterNPE2Artifact = require("../abis/new/RainterpreterNPE2.json");
const RainterpreterStoreNPArtifact = require("../abis/RainterpreterStoreNP.json");
const RainterpreterStoreNPE2Artifact = require("../abis/new/RainterpreterStoreNPE2.json");
const RainterpreterParserNPE2Artifact = require("../abis/new/RainterpreterParserNPE2.json");


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

exports.rainterpreterNPE2Deploy = async () => {
    return await basicDeploy(
        RainterpreterNPE2Artifact
    );
};

exports.rainterpreterStoreNPE2Deploy = async () => {
    return await basicDeploy(
        RainterpreterStoreNPE2Artifact
    );
};

exports.rainterpreterParserNPE2Deploy = async () => {
    return await basicDeploy(
        RainterpreterParserNPE2Artifact
    );
};