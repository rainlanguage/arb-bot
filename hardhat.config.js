require('dotenv').config();
require('@nomiclabs/hardhat-waffle');
require('@nomiclabs/hardhat-ethers');

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more
/**
 * import('hardhat/config').HardhatUserConfig
 */
module.exports = {
    solidity: {
        compilers: [
            {
                version: '0.8.17',
                settings: {
                    optimizer: {
                        enabled: true,
                        runs: 1000000000,
                        details: {
                            peephole: true,
                            inliner: true,
                            jumpdestRemover: true,
                            orderLiterals: true,
                            deduplicate: true,
                            cse: true,
                            constantOptimizer: true,
                        },
                    },
                    metadata: {
                        useLiteralContent: true,
                    },
                },
            },
        ],
    },
    networks: {
        hardhat: {
            forking: {
                url: 'https://api.avax.network/ext/bc/C/rpc', // avalanche network to run the test on
            },
            blockGasLimit: 100000000,
            allowUnlimitedContractSize: true,
        },
    },
    // mocha: {
    //     // explicit test configuration, just in case
    //     asyncOnly: true,
    //     bail: false,
    //     parallel: false,
    //     timeout: 0,
    // },
}
