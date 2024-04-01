const {
    getIncome,
    processLps,
    getEthPrice,
    getDataFetcher,
    getActualPrice,
    visualizeRoute,
    promiseTimeout,
    bundleTakeOrders,
    getActualClearAmount,
    getRouteForTokens,
    createViemClient
} = require("./src/utils.js");  
const ethers = require("ethers"); 

const { createPublicClient, http, fallback } = require("viem");

const ethers = require("ethers"); 
const { DataFetcher, Router, LiquidityProviders, ChainId, Token, viemConfig } = require("sushiswap-router");



async function test(){ 

    let val = ethers.BigNumber.from("1000000000000000000")
    let route = await getRouteForTokens(
        42161,
        val,
        "0x9cAAe40DCF950aFEA443119e51E821D6FE2437ca",
        18,
        "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",
        18,
        "0x669845c29D9B1A64FFF66a55aA13EB4adB889a88",
        "0x09bD2A33c47746fF03b86BCe4E885D03C74a8E8C",
        false
    ) 

    
    console.log(route)
} 
test() 