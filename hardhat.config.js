require("dotenv").config();
require("@nomiclabs/hardhat-waffle");
require("@nomiclabs/hardhat-ethers");
const { appGlobalLogger } = require("./src/utils");

// hide senstive data from test logs
if (process?.env?.API_KEY || process?.env?.TEST_POLYGON_RPC) appGlobalLogger(
    true,
    process?.env?.TEST_POLYGON_RPC,
    process?.env?.API_KEY
);

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more
/**
 * import('hardhat/config').HardhatUserConfig
 */
module.exports = {
    networks: {
        hardhat: {
            forking: {
                url: process?.env?.TEST_POLYGON_RPC, // avalanche network to run the test on
                blockNumber: 53559376
            },
            // mining: {
            //     auto: false,
            //     interval: 250
            // },
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
        timeout: 500000,
    },
};