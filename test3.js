
const {
    getIncome,
    processLps,
    getEthPrice,
    getDataFetcher,
    getActualPrice,
    visualizeRoute,
    promiseTimeout,
    bundleTakeOrders,
    getActualClearAmount
} = require("./src/utils.js");
const { createPublicClient, http, fallback } = require("viem");

const ethers = require("ethers"); 
const { DataFetcher, Router, LiquidityProviders, ChainId, Token, viemConfig } = require("sushiswap-router");


async function test(){  

    const provider = new ethers.providers.JsonRpcProvider("https://arbitrum.llamarpc.com");
    const gasPrice = await provider.getGasPrice(); 

    let chainId = 42161
     // get pools and data for a token pair
     const fromToken = new Token({
        chainId : chainId,
        address : "0x9cAAe40DCF950aFEA443119e51E821D6FE2437ca",
        decimals : 18,
    });
    const toToken = new Token({
        chainId : chainId,
        address : "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
        decimals : 6,
    }); 

    let rpcs = ['https://arbitrum.llamarpc.com',"https://1rpc.io/arb"] 

    let transport = fallback(rpcs.map(v => http(v)))
    const dataFetcher = new DataFetcher(
        chainId,
        createPublicClient({
            chain: 42161,
            transport
        })
    );  

    const liquidityProviders = processLps(['uniswapv2','camelot'],chainId) 
    console.log(liquidityProviders)

    dataFetcher.startDataFetching(liquidityProviders);

    await dataFetcher.fetchPoolsForToken(fromToken, toToken); 

    const pcMap = dataFetcher.getCurrentPoolCodeMap(
        fromToken,
        toToken
    ); 
    
    let val = ethers.BigNumber.from("1000000000000000000")
    const route = Router.findBestRoute(
        pcMap,
        chainId,
        fromToken,
        val,
        toToken,
        gasPrice.toNumber(),
        // 30e9,
        // providers,
        // poolFilter
    ); 
    console.log(route)
} 

test() 
