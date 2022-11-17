const axios = require('axios')
const cron = require('node-cron')  

//Tokens and their addresses
let tokenSymbolArray = [
    {
        symbol : 'USDT',
        tokenAddress : '0xdac17f958d2ee523a2206206994597c13d831ec7'
    } ,
    {
        symbol : 'USDC',
        tokenAddress : '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
    },
    {
        symbol : 'BUSD',
        tokenAddress : '0x4fabb145d64652a948d72533023f6e7a623c7c53'
    },
    {
        symbol : 'DAI',
        tokenAddress : '0x6b175474e89094c44da98b954eedeac495271d0f'
    },
    {
        symbol : 'USDP',
        tokenAddress : '0x8e870d67f660d95d5be530380d0ec0bd388289e1'
    },
    {
        symbol : 'TUSD',
        tokenAddress : '0x0000000000085d4780b73119b644ae5ecd22b376'
    },
    {
        symbol : 'GUSD',
        tokenAddress : '0x056fd409e1d7a124bd7017459dfea2f387b6d5cd'
    },
    {
        symbol : 'FRAX',
        tokenAddress : '0xc2544a32872a91f4a553b404c6950e89de901fdb'
    },
    {
        symbol : 'LUSD',
        tokenAddress : '0x5f98805a4e8be255a32880fdec7f6728c6568ba0'
    },
    // {
    //     symbol : 'CUSD',
    //     tokenAddress : '0xc285b7e09a4584d027e5bc36571785b515898246'
    // },
    {
        symbol : 'MUSD',
        tokenAddress : '0xe2f2a5c287993345a840db3b0845fbc70f5935a5'
    },
    {
        symbol : 'MAI',
        tokenAddress : '0x8d6cebd76f18e1558d4db88138e2defb3909fad6'
    },
    {
        symbol : 'STAKE',
        tokenAddress : '0x0ae055097c6d159879521c384f1d2123d1f195e6'
    },
    {
        symbol : 'ALUSD',
        tokenAddress : '0xbc6da0fe9ad5f3b0d58160288917aa56653660e9'
    },
    {
        symbol : 'FEI',
        tokenAddress : '0x956f47f50a910163d8bf957cf5846d573e7f87ca'
    },
    {
        symbol : 'USDD',
        tokenAddress : '0x0c10bf8fcb7bf5412187a595ab97a3609160b5c6'
    },
    {
        symbol : 'MIM',
        tokenAddress : '0x99d8a9c45b2eca8864373a26d1459e3dff1e17f3'
    },
] 

//inital value for price array
let priceArray = [{"token":"USDD","price":"1244.3311386362016"},{"token":"MAI","price":"1241.537373408903749204"},{"token":"ALUSD","price":"1232.7058123722853"},{"token":"USDT","price":"1230.246883"},{"token":"MIM","price":"1230.0473284087801"},{"token":"DAI","price":"1229.7490477631933"},{"token":"FEI","price":"1229.6239678919682"},{"token":"USDC","price":"1229.193724"},{"token":"TUSD","price":"1229.087770859480799623"},{"token":"GUSD","price":"1228.71"},{"token":"MUSD","price":"1228.297155796577586541"},{"token":"BUSD","price":"1226.350292765507265182"},{"token":"USDP","price":"1226.05537491047590799"},{"token":"LUSD","price":"1184.964704729589"},{"token":"STAKE","price":"1176.7421673080784"},{"token":"FRAX","price":"1071.085214257352"}]

//Cron Job to for Updating Price       
cron.schedule('*/1 * * * *', ()=>{
	updatePriceArray()
}) 

//Cron Job to for Reviweing Sloshed      
cron.schedule('*/5 * * * *', ()=>{ 
    console.log("generateOrders")
	generateOrders()
})  

async function updatePriceArray(){  

   try { 

    let zexPriceArray = []  
    zexPriceArray = await Promise.all(
        tokenSymbolArray.map(async (e) => {
            let priceData = await axios.get(`https://api.0x.org/swap/v1/quote?buyToken=${e.tokenAddress}&sellToken=WETH&sellAmount=1000000000000000000`) 
            return {
                token : e.symbol , 
                price : priceData.data.price
            }
        })
    )   

    zexPriceArray = zexPriceArray.sort((a,b) => {return  b.price - a.price}) 
    priceArray = zexPriceArray 
    
   } catch (error) {
    console.log("error : " , error )
   }

}  

async function generateOrders(){  

    let threshold = 1.02   // currently hard coded , to be fetched from sg for a slosh
    const result = await axios.post(
        'https://api.thegraph.com/subgraphs/name/siddharth2207/orderbook',
        {
            query: `{
                orders(where : {owner : "0x7850cA0DdB9dF2125F1DA2fb2F5317790BbA3441" , orderLive : true}){
                    id 
                    owner
                    orderLive 
                    expression 
                    interpreter
                    transactionHash
                    validInputs{ 
                     
                      tokenVault{ 
                        vaultId
                        token{
                          id
                          symbol
                        }
                        balance
                      }
                    } 
                    validOutputs{
                        tokenVault{ 
                            vaultId
                            token{
                              id
                              symbol
                            }
                            balance
                          }
                    }
                  }
          } `,
        },
        {
            headers: {
                'Content-Type': 'application/json',
            },
        },
    ) // fetching orders that fit the definition of slosh. 

    let sloshes = result.data.data.orders  
   

    for(let i = 0 ; i < sloshes.length ; i++ ){  

        let slosh = sloshes[i]
        let sloshVaultId = slosh.validInputs[0].tokenVault.vaultId
        let sloshOwner = slosh.owner

        let inputs_ = slosh.validInputs.map(e => {return{ tokenAddress : e.tokenVault.token.id , symbol : e.tokenVault.token.symbol , balance : e.tokenVault.balance }})  
        let outputs_ = slosh.validOutputs.map(e => {return {tokenAddress : e.tokenVault.token.id  , symbol : e.tokenVault.token.symbol , balance : e.tokenVault.balance  }}) 

        let inputRatioArray = []
        for(let j = 0 ; j < inputs_.length ; j++){
            let input_ = inputs_[j] 
           
            if(input_.balance > 0) { 
                for(let k = 0 ; k < outputs_.length ; k++ ){ 
                    if(outputs_[k].symbol != input_.symbol) {
                        let cur1 = priceArray.filter(e => {return e.token == input_.symbol})[0]
                        let cur2 = priceArray.filter(e => {return e.token == outputs_[k].symbol})[0]  
                         
                        let ratio = parseFloat(cur2.price) / parseFloat(cur1.price) 
                        console.log(`${cur2.token}-${cur1.token} ratio : ` , ratio)  // output by input .

                        if(ratio > threshold ) {  
                           
                            inputRatioArray.push({
                                inputToken : input_ ,
                                outputToken : outputs_[k] ,
                                ratio : ratio
                            })
                        }
                    }
                }
            } 
        }  

        if(inputRatioArray.length > 0 ){
            inputRatioArray = inputRatioArray.sort((a,b) => {return a - b}) 
            await placeOrder(inputRatioArray[inputRatioArray.length - 1])
        }else{
            console.log("No Good")
        } 

     } 

    

} 

async function placeOrder(order_){ 

    //Bot signer places order.

    //console.log("order_ : " , order_) 

    return new Promise(resolve => setTimeout(resolve, 2000))

}