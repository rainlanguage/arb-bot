const { basicDeploy } = require("../utils");
const RainterpreterNPE2Artifact = require("../abis/RainterpreterNPE2.json");
const RainterpreterStoreNPE2Artifact = require("../abis/RainterpreterStoreNPE2.json");
const RainterpreterParserNPE2Artifact = require("../abis/RainterpreterParserNPE2.json");

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