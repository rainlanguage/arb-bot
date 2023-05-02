const ethers = require("ethers");
const { basicDeploy } = require("../utils");
const ZeroExOrderBookFlashBorrowerArtifact = require("../abis/ZeroExOrderBookFlashBorrower.json");


exports.zeroExDeploy = async (orderbookAddress, proxyAddress, evaluableConfig) => {
    const arb = await basicDeploy(ZeroExOrderBookFlashBorrowerArtifact);
    const encodedConfig = ethers.utils.defaultAbiCoder.encode(
        [
            "tuple(address orderBook,address zeroExExchangeProxy,tuple(address deployer,bytes[] sources,uint256[] constants) evaluableConfig)",
        ],
        [{
            orderBook : orderbookAddress,
            zeroExExchangeProxy: proxyAddress,
            evaluableConfig
        }]
    );
    await arb.initialize(encodedConfig);
    return arb;
};