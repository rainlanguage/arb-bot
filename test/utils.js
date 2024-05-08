const { ethers } = require("hardhat");
const { assert } = require("chai");


/**
 * Addresses with token balance to get from with impersonation
 */
exports.AddressWithBalance = {
    usdc:   "0xe7804c37c13166fF0b37F5aE0BB07A3aEbb6e245",
    usdt:   "0xF977814e90dA44bFA03b6295A0616a897441aceC",
    dai:    "0x4aac95EBE2eA6038982566741d1860556e265F8B",
    frax:   "0xda86DaECd8c56Ec266872F2f0978ac8705C43959",
    busd:   "0x51bfacfcE67821EC05d3C9bC9a8BC8300fB29564",
};

/**
 * Deploys a simple contracts that takes no arguments for deployment
 *
 * @param {object} artifact - The compiled contract artifact
 * @param {any[]} args - (optional) The arguments for deploying this contract
 * @returns ethers Contract
 */
exports.basicDeploy = async (artifact, ...args) => {
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
        id: typeof eventArgs.orderHash === "string"
            ? eventArgs.orderHash.toLowerCase()
            : eventArgs.orderHash.toHexString().toLowerCase(),
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

/**
 * Prepares orders to be in usable format for arb
 */
exports.prepareOrders = async(
    owners,
    tokens,
    tokensDecimals,
    vaultIds,
    orderbook,
    expressionDeployer
) => {
    // topping up owners 1 2 3 vaults with 100 of each token
    for (let i = 0; i < 3; i++) {
        const depositConfigStruct = {
            token: tokens[0].address,
            vaultId: vaultIds[0],
            amount: "100" + "0".repeat(tokensDecimals[0]),
        };
        await tokens[0]
            .connect(owners[i])
            .approve(orderbook.address, depositConfigStruct.amount);
        await orderbook
            .connect(owners[i])
            .deposit(
                depositConfigStruct.token,
                depositConfigStruct.vaultId,
                depositConfigStruct.amount
            );
    }
    for (let i = 0; i < 3; i++) {
        const depositConfigStruct = {
            token: tokens[1].address,
            vaultId: vaultIds[1],
            amount: "100" + "0".repeat(tokensDecimals[1]),
        };
        await tokens[1]
            .connect(owners[i])
            .approve(orderbook.address, depositConfigStruct.amount);
        await orderbook
            .connect(owners[i])
            .deposit(
                depositConfigStruct.token,
                depositConfigStruct.vaultId,
                depositConfigStruct.amount
            );
    }
    for (let i = 0; i < 3; i++) {
        const depositConfigStruct = {
            token: tokens[2].address,
            vaultId: vaultIds[2],
            amount: "100" + "0".repeat(tokensDecimals[2]),
        };
        await tokens[2]
            .connect(owners[i])
            .approve(orderbook.address, depositConfigStruct.amount);
        await orderbook
            .connect(owners[i])
            .deposit(
                depositConfigStruct.token,
                depositConfigStruct.vaultId,
                depositConfigStruct.amount
            );
    }
    for (let i = 0; i < 3; i++) {
        const depositConfigStruct = {
            token: tokens[3].address,
            vaultId: vaultIds[3],
            amount: "100" + "0".repeat(tokensDecimals[3]),
        };
        await tokens[3]
            .connect(owners[i])
            .approve(orderbook.address, depositConfigStruct.amount);
        await orderbook
            .connect(owners[i])
            .deposit(
                depositConfigStruct.token,
                depositConfigStruct.vaultId,
                depositConfigStruct.amount
            );
    }

    const sgOrders = [];
    // order expression config
    const expConfig = {
        constants: [
            ethers.constants.MaxUint256.toHexString(),  // max output
            "5" + "0".repeat(17)                        // ratio 0.5, for testing purpose to ensure clearance
        ],
        bytecode: "0x020000000c02020002010000000100000100000000"
    };

    const EvaluableConfig = this.generateEvaluableConfig(
        expressionDeployer,
        expConfig
    );

    // add orders
    const owner1_order1 = {
        validInputs: [
            { token: tokens[1].address, decimals: tokensDecimals[1], vaultId: vaultIds[1] },
            { token: tokens[3].address, decimals: tokensDecimals[3], vaultId: vaultIds[3] },
        ],
        validOutputs: [
            { token: tokens[0].address, decimals: tokensDecimals[0], vaultId: vaultIds[0] },
        ],
        evaluableConfig: EvaluableConfig,
        meta: this.encodeMeta("owner1_order1"),
    };
    const tx_owner1_order1 = await orderbook.connect(owners[0]).addOrder(owner1_order1);

    // get sg-like order details from tx event
    sgOrders.push(await this.mockSgFromEvent(
        await this.getEventArgs(
            tx_owner1_order1,
            "AddOrder",
            orderbook
        ),
        orderbook,
        tokens
    ));

    const owner1_order2 = {
        validInputs: [
            { token: tokens[2].address, decimals: tokensDecimals[2], vaultId: vaultIds[2] },
        ],
        validOutputs: [
            { token: tokens[0].address, decimals: tokensDecimals[0], vaultId: vaultIds[0] },
        ],
        evaluableConfig: EvaluableConfig,
        meta: this.encodeMeta("owner1_order2"),
    };
    const tx_owner1_order2 = await orderbook.connect(owners[0]).addOrder(owner1_order2);
    sgOrders.push(await this.mockSgFromEvent(
        await this.getEventArgs(
            tx_owner1_order2,
            "AddOrder",
            orderbook
        ),
        orderbook,
        tokens
    ));

    const owner2_order1 = {
        validInputs: [
            { token: tokens[2].address, decimals: tokensDecimals[2], vaultId: vaultIds[2] },
        ],
        validOutputs: [
            { token: tokens[0].address, decimals: tokensDecimals[0], vaultId: vaultIds[0] },
        ],
        evaluableConfig: EvaluableConfig,
        meta: this.encodeMeta("owner2_order1"),
    };
    const tx_owner2_order1 = await orderbook.connect(owners[1]).addOrder(owner2_order1);
    sgOrders.push(await this.mockSgFromEvent(
        await this.getEventArgs(
            tx_owner2_order1,
            "AddOrder",
            orderbook
        ),
        orderbook,
        tokens
    ));

    const owner3_order1 = {
        validInputs: [
            { token: tokens[1].address, decimals: tokensDecimals[1], vaultId: vaultIds[1] },
        ],
        validOutputs: [
            { token: tokens[0].address, decimals: tokensDecimals[0], vaultId: vaultIds[0] },
        ],
        evaluableConfig: EvaluableConfig,
        meta: this.encodeMeta("owner3_order1"),
    };
    const tx_owner3_order1 = await orderbook.connect(owners[2]).addOrder(owner3_order1);
    sgOrders.push(await this.mockSgFromEvent(
        await this.getEventArgs(
            tx_owner3_order1,
            "AddOrder",
            orderbook
        ),
        orderbook,
        tokens
    ));

    return sgOrders;
};

exports.assertError = async function (f, s, e) {
    let didError = false;
    try {
        await f();
    } catch (e) {
        assert.ok(
            JSON.stringify(e).includes(s),
            `error string ${JSON.stringify(e)} does not include ${s}`,
        );
        didError = true;
    }
    assert.ok(didError, e);
};