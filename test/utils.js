const { ethers } = require("hardhat");


/**
 * Addresses with token balance to get from with impersonation
 */
exports.AddressWithBalance = {
    usdc:   "0xc47919bbF3276a416Ec34ffE097De3C1D0b7F1CD",
    usdt:   "0x555e179d64335945fc6b155b7235a31b0a595542",
    dai:    "0x4aac95EBE2eA6038982566741d1860556e265F8B",
    frax:   "0x97ee4eD562c7eD22F4Ff7dC3FC4A24B5F0B9627e"
};

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
 * @param {ethers.Contract} expressionDeployer - The ExpressionDeployer contract instance
 * @param {object} expressionConfig - The ExpressionConfig struct
 * @returns The evalubaleConfig struct
 */
exports.generateEvaluableConfig = (expressionDeployer, expressionConfig) => {
    return {
        deployer: expressionDeployer.address,
        ...expressionConfig
    };
};

/**
 * Encodes an string
 * @param {string} data - The data to encode
 * @returns The encoded data as hex string
 */
exports.encodeMeta = (data) => {
    return (
        "0x" +
        BigInt(0xff0a89c674ee7874n).toString(16).toLowerCase() +
        ethers.utils.hexlify(ethers.utils.toUtf8Bytes(data)).split("x")[1]
    );
};

/**
 * Constructs subgraph-like query results from an addOrder event
 *
 * @param {any} eventArgs - The addOrder event arguments
 * @param {ethers.Contract} orderbook - The orderbook contract instance
 * @param {ethers.Contract[]} tokens - The tokens contracts
 * @returns An array of order details in form of subgraph query result
 */
exports.mockSgFromEvent = async(eventArgs, orderbook, tokens) => {
    const inputDetails = [];
    const outputDetails = [];
    for (let i = 0; i < eventArgs.order.validInputs.length; i++) {
        inputDetails.push({
            symbol: await (tokens.find(e =>
                e.address.toLowerCase() === eventArgs.order.validInputs[i].token.toLowerCase()
            )).symbol(),
            balance: await orderbook.vaultBalance(
                eventArgs.order.owner,
                eventArgs.order.validInputs[i].token,
                eventArgs.order.validInputs[i].vaultId.toString()
            )
        });
    }
    for (let i = 0; i < eventArgs.order.validOutputs.length; i++) {
        outputDetails.push({
            symbol: await (tokens.find(e =>
                e.address.toLowerCase() === eventArgs.order.validOutputs[i].token.toLowerCase()
            )).symbol(),
            balance: await orderbook.vaultBalance(
                eventArgs.order.owner,
                eventArgs.order.validOutputs[i].token,
                eventArgs.order.validOutputs[i].vaultId.toString()
            )
        });
    }

    return {
        id: eventArgs.orderHash.toHexString().toLowerCase(),
        handleIO: eventArgs.order.handleIO,
        expression: eventArgs.order.evaluable.expression.toLowerCase(),
        interpreter: eventArgs.order.evaluable.interpreter.toLowerCase(),
        interpreterStore: eventArgs.order.evaluable.store.toLowerCase(),
        owner: {
            id: eventArgs.order.owner.toLowerCase()
        },
        validInputs: eventArgs.order.validInputs.map((v, i) => {
            return {
                index: i,
                token: {
                    id: v.token.toLowerCase(),
                    decimals: v.decimals,
                    symbol: inputDetails[i].symbol
                },
                tokenVault: {
                    balance: inputDetails[i].balance.toString()
                },
                vault: {
                    id: v.vaultId.toString() + "-" + eventArgs.order.owner.toLowerCase()
                }
            };
        }),
        validOutputs: eventArgs.order.validOutputs.map((v, i) => {
            return {
                index: i,
                token: {
                    id: v.token.toLowerCase(),
                    decimals: v.decimals,
                    symbol: outputDetails[i].symbol
                },
                tokenVault: {
                    balance: outputDetails[i].balance.toString()
                },
                vault: {
                    id: v.vaultId.toString() + "-" + eventArgs.order.owner.toLowerCase()
                }
            };
        })
    };
};