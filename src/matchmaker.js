// const fs = require('fs');
const axios = require('axios');
const cron = require('node-cron');
const dotenv = require('dotenv');
const ethers = require('ethers');
const timsort = require('timsort');
const config = require('./config');
const { DefaultQuery } = require('./defaultQuery');
const { bnFromFloat, toFixed18 } = require('./utils');
const interpreter = require('@beehiveinnovation/rain-interpreter-ts');
const { abi: FlashBorrowerABI } = require('./abis/arb/ZeroExOrderBookFlashBorrower.sol/ZeroExOrderBookFlashBorrower.json');
//const { abi: ERC20ABI } = require('./abis/IERC20Upgradeable.sol/IERC20Upgradeable.json')
dotenv.config();



(async () => {
    let signer
    let chainId
    let trackedTokens
    let arbAddress
    // let proxyAddress
    let nativeToken
    let nativeTokenDecimals
    let api
    try {

        // check the env variables before starting
        if (process.env.BOT_WALLET_PRIVATEKEY) {
            signer = new ethers.Wallet(process.env.BOT_WALLET_PRIVATEKEY)
            if (process.env.RPC_URL) {
                signer.connect(new ethers.providers.JsonRpcProvider(process.env.RPC_URL))
                chainId = await signer.getChainId()
                let index = config.findIndex(v => Number(v.chainId) === chainId)
                if (chainId && index > -1) {
                    api = config[index].apiUrl
                    trackedTokens = config[index].trackedTokens
                    arbAddress = config[index].arbAddress
                    // proxyAddress = config[index].proxyAddress
                    nativeToken = config[index].nativeToken.address
                    nativeTokenDecimals = config[index].nativeToken.decimals
                }
                else throw new Error('network not supported')
            }
            else if (process.env.NETWORK) {
                let index = config.findIndex(v => v.network === process.env.NETWORK)
                if (index > -1) {
                    signer.connect(new ethers.providers.JsonRpcProvider(config[index].defaultRpc))
                    api = config[index].apiUrl
                    trackedTokens = config[index].trackedTokens
                    arbAddress = config[index].arbAddress
                    // proxyAddress = config[index].proxyAddress
                    nativeToken = config[index].nativeToken.address
                    nativeTokenDecimals = config[index].nativeToken.decimals
                }
                else throw new Error('network not supported')
            }
            else throw new Error('RPC or network not defined')
        }
        else throw new Error('bot wallet private key not defined')

        // instantiating orderbook contract
        const arb = new ethers.Contract(arbAddress, FlashBorrowerABI, signer)

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
                const responses = await Promise.allSettled(
                    trackedTokens.map(
                        async(e) => {
                            const response = await axios.get(
                                `${
                                    api
                                }swap/v1/quote?buyToken=${
                                    e.address.toLowerCase()
                                }&sellToken=${
                                    nativeToken.toLowerCase()
                                }&sellAmount=${
                                    '1' + '0'.repeat(nativeTokenDecimals)
                                }`,
                                { 
                                    headers: {
                                        'accept-encoding': 'null'
                                    } 
                                }
                            )
                            return {
                                symbol : e.symbol,
                                address: e.address.toLowerCase(),
                                decimals: e.decimals,
                                price : e.decimals < 18 
                                    ? toFixed18(
                                        bnFromFloat(
                                            response.data.price,
                                            e.decimals,
                                            true
                                        ),
                                        e.decimals
                                    )
                                    : bnFromFloat(
                                        response.data.price,
                                        e.decimals,
                                        true
                                    ),
                            }
                        }
                    )
                )

                for (let i = 0; i < responses.length; i++) {
                    if (responses[i].status == 'fulfilled') zexPriceArray.push(
                        responses[i].value
                    )
                }

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

        const findMatch = async() => {  

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
                            address : e.tokenVault.token.id,
                            symbol : e.tokenVault.token.symbol,
                            decimals: e.tokenVault.token.decimals
                        }
                    }
                )  
                let outputs_ = slosh.validOutputs.map(
                    e => { 
                        return { 
                            address : e.tokenVault.token.id, 
                            symbol : e.tokenVault.token.symbol,
                            decimals: e.tokenVault.token.decimals,
                            balance : ethers.BigNumber.from(
                                e.tokenVault.balance,
                            )
                        }
                    }
                ) 

                let possibleMatches = []
                let inputPrice
                for (let j = 0 ; j < outputs_.length ; j++) {
                    let output_ = outputs_[j];

                    if (output_.balance.gt(0)) { 
                        for (let k = 0 ; k < inputs_.length ; k++ ) { 
                            if (inputs_[k].symbol != output_.symbol) {
                                inputPrice = priceDescending.filter(
                                    e => e.address == output_.address
                                )[0]
                                let outputPrice = priceAscending.filter(
                                    e => e.address == inputs_[k].address
                                )[0]

                                // calculate the ratio from WETH based prices
                                let ratio = interpreter.fixedPointDiv(
                                    inputPrice.price,
                                    outputPrice.price,
                                    18
                                )

                                if (!ratio.lt(threshold)) {
                                    possibleMatches.push({
                                        outputToken : output_,
                                        inputToken : inputs_[k],
                                        inputIndex: k,
                                        outputIndex: j
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
                    for (let j = 0; j < possibleMatches.length; j++) {
                        let bestPossibleMatch = possibleMatches[j]
                        let res = (await axios.get(
                            `${
                                api
                            }swap/v1/quote?buyToken=${
                                bestPossibleMatch.inputToken.address
                            }&sellToken=${
                                bestPossibleMatch.outputToken.address
                            }&sellAmount=${
                                bestPossibleMatch.outputToken.balance.toString()
                            }&takerAddress=${
                                signer.address
                            }`,
                            {
                                headers: {
                                    'accept-encoding': 'null'
                                }
                            }
                        ))
                        let txQuote = res?.data
                        if (txQuote && txQuote.guaranteedPrice) {
                            const guaranteedPrice = toFixed18(
                                bnFromFloat(
                                    txQuote.guaranteedPrice,
                                    bestPossibleMatch.inputToken.decimals
                                ),
                                18
                            )
                            const gasCost = (inputPrice.price.mul(
                                toFixed18(
                                    ethers.BigNumber.from(txQuote.gas).mul(txQuote.gasPrice),
                                    nativeTokenDecimals
                                )
                            )).div(
                                '1000000000000000000'
                            )

                            if (!(guaranteedPrice.sub(gasCost)).lt(threshold)) {
                                console.log('found a match, submiting the transaction now...') 
                                const takeOrder = {
                                    order: {
                                        owner: slosh.owner,
                                        interpreter: slosh.interpreter,
                                        dispatch: slosh.dispatch,
                                        handleIODispatch: slosh.handleIODispatch,
                                        validInputs: slosh.validInputs,
                                        validOutputs: slosh.validOutputs
                                    },
                                    inputIOIndex: bestPossibleMatch.inputIndex,
                                    outputIOIndex: bestPossibleMatch.outputIndex,
                                };
                                const takeOrdersConfigStruct = {
                                    output: bestPossibleMatch.inputToken,
                                    input: bestPossibleMatch.outputToken,
                                    minimumInput: bestPossibleMatch.balance,
                                    maximumInput: bestPossibleMatch.balance,
                                    // @TODO: handle threshold conversion based on decimals
                                    maximumIORatio: threshold,
                                    orders: [takeOrder],
                                };
                                const spender = txQuote.allowanceTarget;
                                const data = txQuote.data;

                                placeOrder(takeOrdersConfigStruct, spender, data)
                            }
                        }
                    }
                }
            }
        } 

        const placeOrder = async(takeOrdersConfig, spender, data) => { 
            await arb.connect(signer).arb(
                takeOrdersConfig,
                spender,
                data
            )
        }
    }
    catch(err) {
        console.log(err)
    }
})()