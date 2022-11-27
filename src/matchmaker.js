// const fs = require('fs');
const axios = require('axios');
const cron = require('node-cron');
const dotenv = require('dotenv');
const ethers = require('ethers');
const timsort = require('timsort');
const { TrackedTokens } = require('./trackedTokens');
const { DefaultQuery } = require('./defaultQuery');
const { bnFromFloat, toFixed18 } = require('./utils');
const interpreter = require('@beehiveinnovation/rain-interpreter-ts');

dotenv.config();
// const { abi: OrderBookABI } = JSON.parse(fs.readFileSync('abis/OrderBook.sol/OrderBook.json'));
// import { abi as FlashLenderABI } from './artifacts/contracts/orderbook/OrderBookFlashLender.sol/OrderBookFlashLender.json';
const { abi: FlashBorrowerABI } = require('./abis/arb/ZeroExOrderBookFlashBorrower.sol/ZeroExOrderBookFlashBorrower.json');

const arbAddress = '';

// Connect to bot's wallet on goerli
const signer = new ethers.Wallet(process.env.BOT_WALLET_PRIVATEKEY)
signer.connect(new ethers.providers.JsonRpcProvider(process.env.RPC_URL))

// instantiating orderbook contract
const arb = new ethers.Contract(arbAddress, FlashBorrowerABI, signer)

//Tokens and their addresses
let tokenSymbolArray = TrackedTokens;

// arrays of token initial token prices based oon WETH for initial match finding
let priceDescending = [];
let priceAscending = [];

//Cron Job to for Updating Price
cron.schedule('*/1 * * * *', ()=>{
    updatePriceArray()
})

//Cron Job for Reviweing Sloshed
cron.schedule('*/2 * * * *', ()=>{
    console.log('findMatch')
    findMatch()
})

const updatePriceArray = async function () {
    try {
        let zexPriceArray = []
        zexPriceArray = await Promise.all(
            tokenSymbolArray.map(
                async(e) => {
                    let priceData = await axios.get(
                        `https://api.0x.org/swap/v1/quote?buyToken=${
                            e.tokenAddress
                        }&sellToken=WETH&sellAmount=1000000000000000000`
                    )
                    return {
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

    }
    catch (error) {
        console.log('error : ', error)
    }

}

async function findMatch() {

    let threshold;

    // fetching orders that fit the definition of slosh.
    const result = await axios.post(
        'https://api.thegraph.com/subgraphs/name/siddharth2207/orderbook',
        { query: DefaultQuery },
        { headers: { 'Content-Type': 'application/json' } },
    )

    let sloshes = result.data.data.orders

    for (let i = 0; i < sloshes.length; i++) {

        let slosh = sloshes[i]

        // run interpreterTS to get the threshold
        let state = new interpreter.RainInterpreterTs({
            sources: slosh.stateConfig.sources,
            constants: slosh.stateConfig.constants
        })
        threshold = (await state.run())[1]

        let inputs_ = slosh.validInputs.map(
            e => {
                return {
                    tokenAddress : e.tokenVault.token.id,
                    symbol : e.tokenVault.token.symbol,
                    balance : ethers.BigNumber.from(
                        e.tokenVault.balance,
                    )
                }
            }
        )
        let outputs_ = slosh.validOutputs.map(
            e => {
                return {
                    tokenAddress : e.tokenVault.token.id,
                    symbol : e.tokenVault.token.symbol,
                    balance : ethers.BigNumber.from(
                        e.tokenVault.balance,
                    )
                }
            }
        )

        let possibleMatches = []
        for (let j = 0 ; j < outputs_.length ; j++) {
            let output_ = outputs_[j];

            if (output_.balance.gt(0)) {
                for (let k = 0 ; k < inputs_.length ; k++ ) {
                    if (inputs_[k].symbol != output_.symbol) {
                        let outputPrice = priceDescending.filter(
                            e => {
                                return e.symbol == output_.symbol
                            }
                        )[0]
                        let inputPrice = priceAscending.filter(
                            e => {
                                return e.symbol == inputs_[k].symbol
                            }
                        )[0]

                        // calculate the ratio from WETH based prices
                        let ratio = interpreter.fixedPointDiv(
                            outputPrice.price,
                            inputPrice.price,
                            18
                        )

                        // output by input .
                        // console.log(
                        //     `${inputPrice.symbol}-${outputPrice.symbol} ratio : `, ratio.toNumber()
                        // )

                        if (!ratio.lt(threshold)) {
                            possibleMatches.push({
                                outputToken : output_,
                                inputToken : inputs_[k],
                                inputIndex: k,
                                outputIndex: j,
                                balance: output_.balance,
                                inputTokenDecimals: inputPrice.decimals,
                                outputtokenDecimals: outputPrice.decimals
                            })
                        }
                    }
                }
            }
        }

        if (possibleMatches.length > 1) {
            timsort.sort(
                possibleMatches,
                (a, b) => a.ratio.gt(b.ratio) ? -1 : a.ratio.lt(b.ratio) ? 1 : 0
            )
            let bestPossibleMatch = possibleMatches[0]
            let txQuote = (await axios.get(
                `https://avalanche.api.0x.org/swap/v1/quote?buyToken=${
                    bestPossibleMatch.inputToken
                }&sellToken=${
                    bestPossibleMatch.outputToken
                }&sellAmount=${
                    bestPossibleMatch.balance.toString()
                }`,
                {headers: {'accept-encoding': 'null'}}
            )).data

            const livePrice = toFixed18(
                bnFromFloat(
                    txQuote.price,
                    bestPossibleMatch.inputTokenDecimals
                )
            )

            if (!livePrice.lt(threshold)) {
                const takeOrder = {
                    order: {
                        owner: slosh.owner,
                        interpreter: slosh.interpreter,
                        dispatch: slosh.dispatch,
                        handleIODispatch: slosh.handleIODispatch,
                        validInputs: slosh.validInputs,
                        validOutputs: slosh.validOutputs
                    },
                    inputIOIndex: bestPossibleMatch.outputIndex,
                    outputIOIndex: bestPossibleMatch.inputIndex,
                };
                const takeOrdersConfigStruct = {
                    output: bestPossibleMatch.inputToken,
                    input: bestPossibleMatch.outputToken,
                    minimumInput: bestPossibleMatch.balance,
                    maximumInput: bestPossibleMatch.balance,
                    maximumIORatio: threshold,
                    orders: [takeOrder],
                };
                const spender = txQuote.allowanceTarget;
                const data = txQuote.data;
                placeOrder(takeOrdersConfigStruct, spender, data)
            }
        }
        else {
            console.log('no match found, checking next order')
        }
    }
}

async function placeOrder(takeOrdersConfig, spender, data) {
    await arb.connect(signer).arb(
        takeOrdersConfig,
        spender,
        data
    )
}


