const { ethers } = require("hardhat");


/**
 * Deploys a simple contracts that takes no arguments for deployment
 *
 * @param {object} artifact - The compiled contract artifact
 * @param {any[]} args - (optional) The arguments for deploying this contract
 * @returns ethers Contract
 */
exports.basicDeploy = async (artifact, args = []) => {
    const factory = await ethers.getContractFactory(artifact.abi, artifact.bytecode);
    const contract = await factory.deploy(...args);
    await contract.deployed();
    return contract;
};

/**
 * Extracts an emitted event from a contract
 *
 * @param {ethers.ContractTransaction} tx - transaction where event occurs
 * @param {string} eventName - name of event
 * @param {ethers.Contract} contract - contract object holding the address, filters, interface
 * @param {string} contractAddressOverride - (optional) override the contract address which emits this event
 * @returns Array of events with their arguments, which can each be deconstructed by array index or by object key
 */
exports.getEvents = async (
    tx,
    eventName,
    contract,
    contractAddressOverride = null
) => {
    const address = contractAddressOverride
        ? contractAddressOverride
        : contract.address;

    const eventObjs = (await tx.wait()).events.filter((x) =>
        x.topics[0] == contract.filters[eventName]().topics[0] && x.address == address
    );

    if (!eventObjs.length) {
        throw new Error(`Could not find event ${eventName} at address ${address}`);
    }

    return eventObjs.map((eventObj) =>
        contract.interface.decodeEventLog(eventName, eventObj.data, eventObj.topics)
    );
};

/**
 * Extracts arguments of an emitted event from a contract
 *
 * @param {ethers.ContractTransaction} tx - transaction where event occurs
 * @param {string} eventName - name of event
 * @param {ethers.Contract} contract - contract object holding the address, filters, interface
 * @param {string} contractAddressOverride - (optional) override the contract address which emits this event
 * @returns Event arguments of first matching event, can be deconstructed by array index or by object key
 */
exports.getEventArgs = async (
    tx,
    eventName,
    contract,
    contractAddressOverride = null
) => {
    const address = contractAddressOverride
        ? contractAddressOverride
        : contract.address;

    const eventObj = (await tx.wait()).events.find((x) =>
        x.topics[0] == contract.filters[eventName]().topics[0] && x.address == address
    );

    if (!eventObj) {
        throw new Error(`Could not find event ${eventName} at address ${address}`);
    }

    return contract.interface.decodeEventLog(
        eventName,
        eventObj.data,
        eventObj.topics
    );
};

/**
 * @returns a random 32 byte number in hexstring format
 */
exports.randomUint256 = () => {
    return ethers.utils.hexZeroPad(ethers.utils.randomBytes(32), 32);
};

/**
 * Builds an EvaluableConfig struct with expressionConfig and a store.
 *
 * @param expressionDeployer - The ExpressionDeployer contract instance
 * @param expressionConfig - The ExpressionConfig struct
 * @returns The evalubaleConfig struct
 */
exports.generateEvaluableConfig = (expressionDeployer, expressionConfig) => {
    return {
        deployer: expressionDeployer.address,
        ...expressionConfig
    };
};