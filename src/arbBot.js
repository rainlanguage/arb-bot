// const fs = require('fs');
const axios = require('axios');
const cron = require('node-cron');
const dotenv = require('dotenv');
const ethers = require('ethers');
const timsort = require('timsort');
const config = require('./config');
const { DefaultQuery } = require('./defaultQuery');
const { bnFromFloat, toFixed18, interpreterEval, getIndex } = require('./utils');
const { abi: arbAbi } = require("./abis/ZeroExOrderBookFlashBorrower.sol/ZeroExOrderBookFlashBorrower.json"); 
const { abi: obAbi } = require("./abis/orderbook/OrderBook.sol/OrderBook.json"); 
const { abi: interpreterAbi } = require("./abis/IInterpreterV1.sol/IInterpreterV1.json"); 
//const { abi: ERC20ABI } = require('./abis/IERC20Upgradeable.sol/IERC20Upgradeable.json')
dotenv.config();


const MAX_UINT_256 = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"; 
const ETHERSCAN_TX_PAGE = {
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


(async () => {
    let signer
    let provider
    let chainId
    let trackedTokens
    let arbAddress
    let orderbookAddress
    let interpreterAddress
    // let proxyAddress
    let nativeToken
    let nativeTokenDecimals
    let api
    try {

        // check the env variables before starting
        if (process.env.BOT_WALLET_PRIVATEKEY) { 
            provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL)
            signer = new ethers.Wallet(process.env.BOT_WALLET_PRIVATEKEY, provider); 
            if (process.env.RPC_URL) {
                chainId = await signer.getChainId()
                let index = config.findIndex(v => Number(v.chainId) === chainId)
                if (chainId && index > -1) {
                    api = config[index].apiUrl
                    trackedTokens = config[index].trackedTokens
                    arbAddress = config[index].arbAddress
                    orderbookAddress = config[index].orderbookAddress
                    interpreterAddress = config[index].interpreterAddress
                    // proxyAddress = config[index].proxyAddress
                    nativeToken = config[index].nativeToken.address
                    nativeTokenDecimals = config[index].nativeToken.decimals
                }
                else throw new Error('network not supported')
            }
            else if (process.env.NETWORK) {
                let index = config.findIndex(v => v.network === process.env.NETWORK)
                if (index > -1) {
                    api = config[index].apiUrl
                    trackedTokens = config[index].trackedTokens
                    arbAddress = config[index].arbAddress
                    orderbookAddress = config[index].orderbookAddress
                    interpreterAddress = config[index].interpreterAddress
                    // proxyAddress = config[index].proxyAddress
                    nativeToken = config[index].nativeToken.address
                    nativeTokenDecimals = config[index].nativeToken.decimals
                }
                else throw new Error('network not supported')
            }
            else throw new Error('RPC or network not defined')
        }
        else throw new Error('bot wallet private key not defined')

        // instantiating arb contract
        const arb = new ethers.Contract(arbAddress, arbAbi, signer)  

        // instantiating orderbook contract
        const orderBook = new ethers.Contract(orderbookAddress, obAbi, signer)// instantiating arb contract 

        // instantiating arb contract
        const interpreter = new ethers.Contract(interpreterAddress, interpreterAbi, signer) 

        console.log('----------------------------Arb Bot------------------------------')
        console.log("Arb : " , arb.address)
        console.log("OrderBook : " , orderBook.address)
        console.log("Interpreter : " , interpreter.address)
        console.log('----------------------------------------')

        // //Cron Job for Reviweing Sloshed      
        // cron.schedule('*/5 * * * *', ()=>{ 
        //     findMatch2()
        // })  

        const findMatch2 = async() => { 

            console.log(('-------------------------Checking For Slosh Orders----------------------------'))
            const result = await axios.post(
                'https://api.thegraph.com/subgraphs/name/siddharth2207/rainorderbook',
                { query: DefaultQuery },
                { headers: { 'Content-Type': 'application/json' } }
        
            )   
        
            let sloshes = result.data.data.orders  

            for (let i = 0; i < sloshes.length; i++) {  

                let slosh = sloshes[i]   
        
                let inputs_ = slosh.validInputs.map(
                    e => { 
                        return {
                            address : e.token.id,
                            symbol : e.token.symbol,
                            decimals: e.token.decimals , 
                            vaultId : ethers.BigNumber.from(e.vault.id.split('-')[0]),
                            balance : ethers.BigNumber.from(e.tokenVault.balance)
                        }
                    }
                )  
                let outputs_ = slosh.validOutputs.map(
                    e => { 
                        return { 
                            address : e.token.id, 
                            symbol : e.token.symbol,
                            decimals: e.token.decimals,
                            vaultId : ethers.BigNumber.from(e.vault.id.split('-')[0]),
                            balance : ethers.BigNumber.from(
                                e.tokenVault.balance,
                            )
                        }
                    }
                )  
        
                for(let j = 0 ; j < inputs_.length ; j++){   
        
                    let input = inputs_[j] 
        
                    for(let k = 0 ; k < outputs_.length ; k++){
                        let output = outputs_[k]  
                        if (!output.balance.isZero()) {
                            if(input.address.toLowerCase() != output.address.toLowerCase()){ 
            
                                let { stack: [ maxOutput, ratio ] } = await interpreterEval(
                                    output,
                                    input,
                                    slosh,
                                    interpreter,
                                    arb,
                                    orderBook
                                )   
            
                                // take minimum of maxOutput and output vault balance for 0x qouting amount
                                const quoteAmount = output.balance.lte(maxOutput)
                                ? output.balance
                                : maxOutput;  
        
                                if (!quoteAmount.isZero()) { 
        
                                    const response = await axios.get(
                                        `${
                                            api
                                        }swap/v1/quote?buyToken=${
                                            input.address
                                        }&sellToken=${
                                            output.address
                                        }&sellAmount=${
                                            quoteAmount.toString()
                                        }`,
                                        { headers: { "accept-encoding": "null" } }
                                    );  
                
                                    // proceed if 0x quote is valid
                                    const txQuote = response?.data; 
                                        
                                    let quotePrice = ethers.utils.parseUnits(txQuote.price) 

                                    if (txQuote && txQuote.guaranteedPrice) { 

                                        // compare the ratio against the quote price and try to clear if 
                                        // quote price is greater or equal
                                        if (quotePrice.gte(ratio)) { 
                                            // construct the take order config
                                            const takeOrder = {
                                                order: JSON.parse(slosh.orderJSONString),
                                                inputIOIndex: getIndex(slosh,input.address),
                                                outputIOIndex: getIndex(slosh,output.address),
                                                signedContext: []
                                            }; 
        
                                            const takeOrdersConfigStruct = {
                                                output: input.address,
                                                input: output.address,
                                                // max and min input should be exactly the same as quoted sell amount
                                                // this makes sure the cleared order amount will exactly match the 0x quote
                                                minimumInput: quoteAmount,
                                                maximumInput: quoteAmount,
                                                maximumIORatio: MAX_UINT_256,
                                                orders: [ takeOrder ],
                                            }; 
        
                                            // submit the transaction
                                            try {
                                                const tx = await arb.arb(
                                                    takeOrdersConfigStruct,
                                                    txQuote.allowanceTarget,
                                                    txQuote.data,
                                                    { gasPrice: txQuote.gasPrice }
                                                );
                                                console.log(ETHERSCAN_TX_PAGE[chainId] + tx.hash, "\n");
                                                console.log("Transaction submitted successfully to the network, see the link above for details, waiting for tx to mine...\n");
                                                try {
                                                    // Transaction may require some time for confirmation which may interfere with next orders
                                                    // await tx.wait();
                                                    console.log(`Clear amount: ${ethers.utils.formatUnits(quoteAmount, output.decimals)}`);
                                                    console.log(`Clear guaranteed price: ${txQuote.guaranteedPrice}`);
                                                    console.log("Order cleared successfully, checking next order...\n");
                                                }
                                                catch (_e) {
                                                    console.log("Order did not clear, checking next order...");
                                                }
                                            }
                                            catch (_e) {
                                                console.log(_e, "\n");
                                                console.log( "Transaction failed, checking next order...\n");
                                            }
                                        }else{
                                            console.log(
                                                "Market price is lower than order's ratio, checking next order...\n"
                                            );
                                        }
                                    }
        
                                }
        
                                console.log('-----------------------------------------------------')
            
            
                            }
                        }
                    }
        
                }
        
            }



        } 
        findMatch2()

    }
    catch(err) {
        console.log(err)
    }
})()