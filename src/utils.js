const { ethers, BigNumber } = require('ethers');

/**
 * convert float numbers to big number
 * 
 * @param {*} float - any form of number
 * @param {number} decimals - Decimals point of the number
 * @returns ethers BigNumber with decimals point
 */
exports.bnFromFloat = (float, decimals) => {
    if (typeof float == 'string') {
        if (float.startsWith('0x')) {
            const num = BigInt(float).toString()
            return BigNumber.from(num.padEnd(num.length + decimals), '0')
        }
        else {
            if (float.includes('.')) {
                const offset = decimals - float.slice(float.indexOf('.') + 1).length
                float = offset < 0 ? float.slice(0, offset) : float;
            }
            return ethers.utils.parseUnits(float, decimals) 
        }
    }
    else {
        try {
            float = float.toString()
            return this.bnFromFloat(float, decimals)
        }
        catch {
            return undefined
        }
    
    }
},

/**
 * Convert a BigNumber to a fixed 18 point BigNumber
 * 
 * @param {BigNumber} bn - The BigNumber to convert
 * @param {number} decimals - The decimals point of the given BigNumber
 * @returns A 18 fixed point BigNumber
 */
exports.toFixed18 = (bn, decimals) => {
    const num = bn.toBigInt().toString()
    return BigNumber.from(
        num + '0'.repeat(18 - decimals)
    )
},

/**
 * Convert a 18 fixed point BigNumber to a  BigNumber with some other decimals point
 * 
 * @param {BigNumber} bn - The BigNumber to convert
 * @param {number} decimals - The decimals point of convert the given BigNumber
 * @returns A decimals point BigNumber
 */
exports.fromFixed18 = (bn, decimals) => {
    if (decimals != 18) {
        const num = bn.toBigInt().toString()
        return BigNumber.from(
            num.slice(0, decimals - 18)
        )
    }
    else return bn
} 
/** 
* Gets orderMaxOutput and ratio for a particular order. 
* @param {inputDetails} - Input Token details from validInputs Array
* @param {outputDetails} - Ouput Token details from validInputs Array
* @param {slosh} - Slosh Order
* @param {arb} - Arb Contract Address
* @param {orderbook} - OrderBook contract address
* @returns An array containing maxOutput and ratio

*/
exports.interpreterEval = async (
    inputDetails ,
    outputDetails ,
    slosh ,
    interpreter,
    arb , 
    orderbook
) => { 

    const stack = await interpreter.eval(
        slosh.interpreterStore,
        slosh.owner.id,
        slosh.expression + "00000002",
        // construct the context for eval
        [
            [ 
                // base column 
                arb.address, 
                orderbook.address 
            ], 
            [
                // calling context column 
                slosh.id, 
                slosh.owner.id, 
                arb.address 
            ], 
            [
                // calculateIO context column 
            ], 
            [
                // input context column 
                inputDetails.address, 
                inputDetails.decimals, 
                inputDetails.vaultId , 
                inputDetails.balance, 
                "0" 
            ], 
            [
                // output context column 
                outputDetails.address, 
                outputDetails.decimals, 
                outputDetails.vaultId , 
                outputDetails.balance, 
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
    return stack

}
