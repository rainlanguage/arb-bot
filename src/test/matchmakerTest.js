// const cron = require('node-cron');
const axios = require('axios');
const ethers = require('ethers');
const timsort = require('timsort');
const { bnFromFloat, toFixed18 } = require('../utils');
const interpreter = require('@beehiveinnovation/rain-interpreter-ts');
const { avaxTokens } = require('./avaxTokens');
// eslint-disable-next-line no-unused-vars
const { SignerWithAddress } = require('@nomiclabs/hardhat-ethers/signers');
require('dotenv').config();

/**
 * Exposing the Matchmaker Bot as function for running tests. Bot runns until it
 * finds one match for the givven orders and then will return the results.
 *
 * @param {SignerWithAddress} signer - Bot wallet as signer
 * @param {ethers.Contract} borrower - Address of the 0x Flash Borrower contract
 * @param {string} proxyAddress - Address of the 0x proxy contract
 * @param {object} orders - Orders to run the tests for
 * @param {object} ordersStruct - TakeOrder Structs for posting into arb contract
 * @returns {string} A success or failure
 */
exports.matchmakerTest = async (signer, borrower, proxyAddress, orders, ordersStruct, ss) => {

    //Tokens and their addresses
    let tokenSymbolArray = avaxTokens;

    //inital value for price array
    let priceDescending = []
    let priceAscending = []

    //Cron Job to for Updating Price
    // cron.schedule('*/1 * * * *', async()=>{
    //     await updatePriceArray()
    // })

    // cron.schedule('*/1 * * * *', async()=>{
    //     const result = await findMatch()
    //     if (result === 'good') return 'good'
    //     else return 'bad'
    // })

    const updatePriceArray = async function () {
        try {
            let zexPriceArray = []
            zexPriceArray = await Promise.all(
                tokenSymbolArray.map(
                    async(e) => {
                        let priceData = await axios.get(
                            `https://avalanche.api.0x.org/swap/v1/quote?buyToken=${
                                e.tokenAddress
                            }&sellToken=AVAX&sellAmount=1000000000000000000`,
                            {headers: {'accept-encoding': 'null'}}
                        )
                        return {
                            p: priceData.data.price,
                            symbol : e.symbol,
                            tokenAddress: e.tokenAddress,
                            price : e.decimals < 18
                                ? toFixed18(
                                    bnFromFloat(
                                        priceData.data.price,
                                        e.decimals,
                                        true
                                    ),
                                    e.decimals
                                )
                                : bnFromFloat(priceData.data.price, e.decimals, true),
                            decimals: e.decimals
                        }
                    }
                )
            )
            timsort.sort(
                zexPriceArray,
                (a, b) => a.price.gt(b.price) ? -1 : a.price.lt(b.price) ? 1 : 0
            )

            priceDescending = zexPriceArray
            Object.assign(priceAscending, zexPriceArray);
            priceAscending.reverse()
            // console.log(JSON.stringify(priceDescending))
            // console.log(JSON.stringify(priceAscending))
        } 
        catch (error) {
            console.log('error : ', error)
        }
    }

    async function findMatch() {
        let threshold;
        let sloshes = orders
        for (let i = 0; i < sloshes.length; i++) {

            let slosh = sloshes[i]

            // run interpreterTS to get the threshold
            let state = new interpreter.RainInterpreterTs({
                sources: slosh.stateConfig.sources,
                constants: slosh.stateConfig.constants
            })
            threshold = (await state.run())[1]

            // map the sg mocked data
            let inputs_ = slosh.validInputs.map(
                e => {
                    return {
                        tokenAddress : e.tokenVault.token.id,
                        symbol : e.tokenVault.token.symbol,
                        balance : e.tokenVault.balance,
                    }
                }
            )
            let outputs_ = slosh.validOutputs.map(
                e => {
                    return {
                        tokenAddress : e.tokenVault.token.id,
                        symbol : e.tokenVault.token.symbol,
                        balance : e.tokenVault.balance,
                    }
                }
            )

            // // sort the outputs based on vault balance
            // timsort.sort(
            //     outputs_,
            //     (a, b) => a.balance.gt(b.balance) ? -1 : a.balance.lt(b.balance) ? 1 : 0
            // )

            // initiate searching for match
            for (let j = 0 ; j < outputs_.length ; j++) {
                let output_ = outputs_[j];

                if (output_.balance.gt(0)) {
                    for (let k = 0 ; k < inputs_.length ; k++ ) {
                        if (inputs_[k].symbol != output_.symbol) {
                            let inputPrice = priceAscending.filter(
                                e => {
                                    return e.symbol == inputs_[k].symbol
                                }
                            )[0]
                            let outputPrice = priceDescending.filter(
                                e => {
                                    return e.symbol == output_.symbol
                                }
                            )[0]
                            console.log(output_.symbol, inputs_[k].symbol)
                            // calculate the ratio from WETH based prices
                            let ratio = interpreter.fixedPointDiv(
                                outputPrice.price,
                                inputPrice.price,
                                18
                            )

                            if (!ratio.lt(threshold)) {
                                let txQuote = (await axios.get(
                                    `https://avalanche.api.0x.org/swap/v1/quote?buyToken=${
                                        inputs_[k].tokenAddress
                                    }&sellToken=${
                                        output_.tokenAddress
                                    }&sellAmount=${
                                        output_.balance.toString()
                                    }&takerAddress${ss.address}`,
                                    {headers: {'accept-encoding': 'null'}}
                                )).data

                                const livePrice = toFixed18(
                                    bnFromFloat(
                                        txQuote.price,
                                        inputPrice.decimals
                                    )
                                )

                                if (!livePrice.lt(threshold)) {
                                    const takeOrder = {
                                        order: ordersStruct[i],
                                        inputIOIndex: k,
                                        outputIOIndex: j,
                                    };
                                    const takeOrdersConfigStruct = {
                                        output: inputs_[k].tokenAddress,
                                        input: output_.tokenAddress,
                                        minimumInput: output_.balance,
                                        maximumInput: ethers.constants.MaxUint256,
                                        maximumIORatio: threshold,
                                        orders: [takeOrder],
                                    };
                                    // const data = {
                                    //     sellToken: txQuote.sellTokenAddress,
                                    //     buyToken: txQuote.buyTokenAddress,
                                    //     spender: txQuote.allowanceTarget,
                                    //     swapTarget: txQuote.to,
                                    //     swapCalldata: txQuote.data
                                    // };

                                    // call the arb contract if there is a match
                                    // console.log(txQuote)
                                    await placeOrder(
                                        takeOrdersConfigStruct,
                                        txQuote.data
                                    );
                                    console.log('an was order submited');
                                    return 'success'
                                }
                            }
                        }
                    }
                }
            }
        }
        return 'failure'
    } 

    // post the possible match to arb contract
    async function placeOrder(config, data) {
        // console.log('takeOrder conf: ', config)
        // console.log('0x data: ', data)
        // console.log('allowenceTarget/proxy add: ', proxyAddress)
        await borrower.arb(
            config,
            proxyAddress,
            data
        )
    }

    // run the functions
    await updatePriceArray();
    const result = await findMatch();
    if (result == 'success') return 'success';
    else return 'failure'
}