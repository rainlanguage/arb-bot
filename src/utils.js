const { ethers, BigNumber } = require("ethers");


/**
 * Transaction page of etherscan websites paired with their chain id
 */
exports.ETHERSCAN_TX_PAGE = {
    1:          "https://etherscan.io/tx/",
    5:          "https://goerli.etherscan.io/tx/",
    10:         "https://optimistic.etherscan.io/tx/",
    56:         "https://bscscan.com/tx/",
    137:        "https://polygonscan.com/tx/",
    250:        "https://ftmscan.com/tx/",
    42161:      "https://arbiscan.io/tx/",
    42220:      "https://celoscan.io/tx/",
    43114:      "https://snowtrace.io/tx/",
    524289:     "https://mumbai.polygonscan.com/tx/"
};

/**
 * convert float numbers to big number
 *
 * @param {*} float - any form of number
 * @param {number} decimals - Decimals point of the number
 * @returns ethers BigNumber with decimals point
 */
exports.bnFromFloat = (float, decimals = 18) => {
    if (typeof float == "string") {
        if (float.startsWith("0x")) {
            const num = BigInt(float).toString();
            return BigNumber.from(num.padEnd(num.length + decimals), "0");
        }
        else {
            if (float.includes(".")) {
                const offset = decimals - float.slice(float.indexOf(".") + 1).length;
                float = offset < 0 ? float.slice(0, offset) : float;
            }
            return ethers.utils.parseUnits(float, decimals);
        }
    }
    else {
        try {
            float = float.toString();
            return this.bnFromFloat(float, decimals);
        }
        catch {
            return undefined;
        }

    }
};

/**
 * Convert a BigNumber to a fixed 18 point BigNumber
 *
 * @param {BigNumber} bn - The BigNumber to convert
 * @param {number} decimals - The decimals point of the given BigNumber
 * @returns A 18 fixed point BigNumber
 */
exports.toFixed18 = (bn, decimals) => {
    const num = bn.toBigInt().toString();
    return BigNumber.from(
        num + "0".repeat(18 - decimals)
    );
};

/**
 * Convert a 18 fixed point BigNumber to a  BigNumber with some other decimals point
 *
 * @param {BigNumber} bn - The BigNumber to convert
 * @param {number} decimals - The decimals point of convert the given BigNumber
 * @returns A decimals point BigNumber
 */
exports.fromFixed18 = (bn, decimals) => {
    if (decimals != 18) {
        const num = bn.toBigInt().toString();
        return BigNumber.from(
            num.slice(0, decimals - 18)
        );
    }
    else return bn;
};

/**
 * Calls eval for a specific order to get its max output and ratio
 *
 * @param {ethers.Contract} interpreter - The interpreter ethersjs contract instance
 * @param {string} arbAddress - Arb contract address
 * @param {string} obAddress - OrderBook contract address
 * @param {object} order - The order details fetched from sg
 * @param {number} inputIndex - The input token index
 * @param {number} outputIndex - The ouput token index
 * @returns The ratio and maxOuput as BigNumber
*/
exports.interpreterEval = async(
    interpreter,
    arbAddress,
    obAddress,
    order,
    inputIndex,
    outputIndex
) => {
    try {
        const { stack: [ maxOutput, ratio ] } = await interpreter.eval(
            order.interpreterStore,
            order.owner.id,
            order.expression + "00000002",
            // construct the context for eval
            [
                [
                    // base column
                    arbAddress,
                    obAddress
                ],
                [
                    // calling context column
                    order.id,
                    order.owner.id,
                    arbAddress
                ],
                [
                    // calculateIO context column
                ],
                [
                    // input context column
                    order.validInputs[inputIndex].token.id,
                    order.validInputs[inputIndex].token.decimals,
                    order.validInputs[inputIndex].vault.id.split("-")[0],
                    order.validInputs[inputIndex].tokenVault.balance,
                    "0"
                ],
                [
                    // output context column
                    order.validOutputs[outputIndex].token.id,
                    order.validOutputs[outputIndex].token.decimals,
                    order.validOutputs[outputIndex].vault.id.split("-")[0],
                    order.validOutputs[outputIndex].tokenVault.balance,
                    "0"
                ],
                [
                    // empty context column
                ],
                [
                    // signed context column
                ]
            ]
        );
        return { ratio, maxOutput };
    }
    catch {
        return {
            ratio: undefined,
            maxOutput: undefined
        };
    }
};

/**
 * Constructs Order struct from the result of sg default query
 *
 * @param {object} orderDetails - The order details fetched from sg
 * @returns The order struct as js object
 */
exports.getOrderStruct = (orderDetails) => {
    return {
        owner: orderDetails.owner.id,
        handleIO: orderDetails.handleIO,
        evaluable: {
            interpreter: orderDetails.interpreter,
            store: orderDetails.interpreterStore,
            expression: orderDetails.expression
        },
        validInputs: orderDetails.validInputs.map(v => {
            return {
                token: v.token.id,
                decimals: Number(v.token.decimals),
                vaultId: v.vault.id.split("-")[0]
            };
        }),
        validOutputs: orderDetails.validOutputs.map(v => {
            return {
                token: v.token.id,
                decimals: Number(v.token.decimals),
                vaultId: v.vault.id.split("-")[0]
            };
        })
    };
};

/**
 * Waits for provided miliseconds
 * @param ms - Miliseconds to wait
 */
exports.sleep = async(ms) => {
    return new Promise(resolve => setTimeout(resolve, ms));
};