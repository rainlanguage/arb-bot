const { abi: obAbi } = require("./src/abis/orderbook/OrderBook.sol/OrderBook.json"); 
const { abi: interpreterAbi } = require("./src/abis/IInterpreterV1.sol/IInterpreterV1.json"); 
const { abi: arbAbi } = require("./src/abis/ZeroExOrderBookFlashBorrower.sol/ZeroExOrderBookFlashBorrower.json"); 
const axios = require("axios"); 
const { DefaultQuery } = require('./src/defaultQuery.js');

const {ethers} = require("ethers"); 
const { interpreterEval, toFixed18, bnFromFloat } = require("./src/utils");


const MAX_UINT_256 = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";  

async function main(){  

    const provider = new ethers.providers.JsonRpcProvider('https://polygon-mainnet.g.alchemy.com/v2/y3BXawVv5uuP_g8BaDlKbKoTBGHo9zD9');
    const signer = new ethers.Wallet('5c4638919d8be013f76dd370c33357bc3e1d8426a74ab40535c3fd1b0e8500d4', provider);

    let interpreter = new ethers.Contract(
        '0xc318bd7dBdAC1cE35aa4aA1443B41C53246c60e2',
        interpreterAbi,
        signer
    );    

    let orderbook = new ethers.Contract(
        '0x04a2903d24516d2556bbe6f0e06baa378aac9995' , 
        obAbi ,
        signer
    ) 

    let arb = new ethers.Contract(
        '0x57c8a54c37635f6feea837786860b9a02f0e66da' , 
        arbAbi ,
        signer
    ) 

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
    
                        const { stack: [ maxOutput, ratio ] } = await interpreterEval(
                            input,
                            output,
                            slosh,
                            interpreter,
                            arb,
                            orderbook
                        )   
    
                        // take minimum of maxOutput and output vault balance for 0x qouting amount
                        const quoteAmount = output.balance.lte(maxOutput)
                        ? output.balance
                        : maxOutput;  

                        if (!quoteAmount.isZero()) { 

                            const response = await axios.get(
                                `${
                                    'https://polygon.api.0x.org/'
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
        
                            if (txQuote && txQuote.guaranteedPrice) {
        
                                // compare the ratio against the quote price and try to clear if 
                                // quote price is greater or equal
                                if (ethers.utils.parseUnits(txQuote.price).gte(ratio)) { 
                                    // construct the take order config
                                    const takeOrder = {
                                        order: JSON.parse(slosh.orderJSONString),
                                        inputIOIndex: j,
                                        outputIOIndex: k,
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
                                        // const tx = await arb.arb(
                                        //     takeOrdersConfigStruct,
                                        //     txQuote.allowanceTarget,
                                        //     txQuote.data,
                                        //     { gasPrice: txQuote.gasPrice }
                                        // );
                                        // console.log(ETHERSCAN_TX_PAGE[chainId] + tx.hash, "\n");
                                        console.log("Transaction submitted successfully to the network, see the link above for details, waiting for tx to mine...\n");
                                        try {
                                            await tx.wait();
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

async function placeOrder(){

} 

function clearArray(){

}

main()