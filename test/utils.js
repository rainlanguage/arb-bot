const hardhat = require('hardhat');
const utils = require('ethers').utils;
// eslint-disable-next-line no-unused-vars
const ethers = require('ethers');

/**
 * Rainterpreter Standard Opcodes
 */
const AllStandardOps = {
    CHAINLINK_PRICE: 0,
    CALL: 1,
    CONTEXT: 2,
    CONTEXT_ROW: 3,
    DEBUG: 4,
    DO_WHILE: 5,
    FOLD_CONTEXT: 6,
    LOOP_N: 7,
    READ_MEMORY: 8,
    SET: 9,
    HASH: 10,
    ERC20_BALANCE_OF: 11,
    ERC20_TOTAL_SUPPLY: 12,
    ERC20_SNAPSHOT_BALANCE_OF_AT: 13,
    ERC20_SNAPSHOT_TOTAL_SUPPLY_AT: 14,
    IERC721_BALANCE_OF: 15,
    IERC721_OWNER_OF: 16,
    IERC1155_BALANCE_OF: 17,
    IERC1155_BALANCE_OF_BATCH: 18,
    ENSURE: 19,
    BLOCK_NUMBER: 20,
    CALLER: 21,
    THIS_ADDRESS: 22,
    BLOCK_TIMESTAMP: 23,
    EXPLODE32: 24,
    SCALE18: 25,
    SCALE18_DIV: 26,
    SCALE18_MUL: 27,
    SCALE_BY: 28,
    SCALEN: 29,
    ANY: 30,
    EAGER_IF: 31,
    EQUAL_TO: 32,
    EVERY: 33,
    GREATER_THAN: 34,
    ISZERO: 35,
    LESS_THAN: 36,
    SATURATING_ADD: 37,
    SATURATING_MUL: 38,
    SATURATING_SUB: 39,
    ADD: 40,
    DIV: 41,
    EXP: 42,
    MAX: 43,
    MIN: 44,
    MOD: 45,
    MUL: 46,
    SUB: 47,
    IORDERBOOKV1_VAULT_BALANCE: 48,
    ISALEV2_REMAINING_TOKEN_INVENTORY: 49,
    ISALEV2_RESERVE: 50,
    ISALEV2_SALE_STATUS: 51,
    ISALEV2_TOKEN: 52,
    ISALEV2_TOTAL_RESERVE_RECEIVED: 53,
    ITIERV2_REPORT: 54,
    ITIERV2_REPORT_TIME_FOR_TIER: 55,
    SATURATING_DIFF: 56,
    SELECT_LTE: 57,
    UPDATE_TIMES_FOR_TIER_RANGE: 58,
    length: 59,
};

/**
 * READ_MEMORY operand types, ie STATE or STACK
 */
const MemoryType = {
    Stack: 0,
    Constant: 1,
};

/**
 * Deploys a simple contracts that takes no arguments for deployment
 * 
 * @param {string} name - Name of the contract (reference from artifacts)
 * @returns ethers Contract
 */
const basicDeploy = async (name) => {
    const factory = await hardhat.ethers.getContractFactory(name)

    const contract = await factory.deploy()
    await contract.deployed()

    return contract
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
const getEvents = async (
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
const getEventArgs = async (
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
 * Converts a value to raw bytes representation. Assumes `value` is less than or equal to 1 byte, unless a desired `bytesLength` is specified.
 *
 * @param {number | utils.Hexable | ethers.BytesLike} value - value to convert to raw bytes format
 * @param {number} bytesLength - (defaults to 1) number of bytes to left pad if `value` doesn't completely fill the desired amount of memory. 
 * Will throw `InvalidArgument` error if value already exceeds bytes length.
 * @returns {Uint8Array} - raw bytes representation
 */
const bytify = (
    value,
    bytesLength = 1
) => {
    return utils.zeroPad(utils.hexlify(value), bytesLength);
};

/**
 * Converts an opcode and operand to bytes, and returns their concatenation.
 * @param {number} code - the opcode
 * @param {number} erand - the operand, currently limited to 2 bytes (defaults to 0)
 */
const op = (
    code,
    erand = 0
) => {
    return utils.concat([bytify(code, 2), bytify(erand, 2)]);
};

/**
 * Construct a valid operand for READ_MEMORY opcode
 * 
 * @param {number} type - Specifies the type of the opcode, ie STATE or STACK
 * @param {number} offset - Index of the desired item
 * @returns A number in 1 bytes size
 */
const memoryOperand = (type, offset) => {
    return (offset << 1) + type;
};

exports.AllStandardOps = AllStandardOps;
exports.MemoryType = MemoryType;
exports.basicDeploy = basicDeploy;
exports.getEventArgs = getEventArgs;
exports.getEvents = getEvents;
exports.memoryOperand = memoryOperand;
exports.bytify = bytify;
exports.op = op;
