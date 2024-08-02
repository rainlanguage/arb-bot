require("dotenv").config();
require("@nomiclabs/hardhat-waffle");
require("@nomiclabs/hardhat-ethers");
require("@nomicfoundation/hardhat-viem");

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more
/**
 * import('hardhat/config').HardhatUserConfig
 */
module.exports = {
    networks: {
        hardhat: {
            forking: {
                url: process?.env?.TEST_POLYGON_RPC ?? "https://rpc.ankr.com/polygon", // avalanche network to run the test on
                blockNumber: 56738134
            },
            mining: {
                auto: true,
                interval: 50
            },
            gasPrice: "auto",
            blockGasLimit: 100000000,
            allowUnlimitedContractSize: true
        },
    },
    mocha: {
        // explicit test configuration, just in case
        asyncOnly: true,
        bail: false,
        parallel: false,
        timeout: 5000000,
    },
    paths: {
        tests: "./test/e2e"
    }
};