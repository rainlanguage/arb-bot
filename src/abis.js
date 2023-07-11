/**
 * Minimal ABI for ERC20 contract only including Transfer event
 */
exports.erc20Abi = [
    "event Transfer(address indexed from, address indexed to, uint256 value)",
    "function symbol() public view returns (string memory)"
];

/**
* Minimal ABI for Orderbook contract only including vaultBalance() function
*/
exports.orderbookAbi = [
    `function vaultBalance(
        address owner,
        address token,
        uint256 id
    ) external view returns (uint256 balance)`
];

/**
* Minimal ABI for IInterpreterV1 contract only including eval() function
*/
exports.interpreterAbi = [
    `function eval(
      address store,
      uint256 namespace,
      uint256 dispatch,
      uint256[][] calldata context
  ) external view returns (uint256[] memory stack, uint256[] memory kvs)`
];

/**
* Minimal ABI for SushiSwap RouteProcessor3 contract only including processRoute() function
*/
exports.routeProcessor3Abi = [
    `function processRoute(
        address tokenIn,
        uint256 amountIn,
        address tokenOut,
        uint256 amountOutMin,
        address to,
        bytes memory route
    ) external payable returns (uint256 amountOut)`
];

/**
* Minimal ABI for Generic Arb contract only including arb() function
*/
exports.genericArbAbi = [
    {
        "inputs": [
            {
                "components": [
                    {
                        "internalType": "address",
                        "name": "output",
                        "type": "address"
                    },
                    {
                        "internalType": "address",
                        "name": "input",
                        "type": "address"
                    },
                    {
                        "internalType": "uint256",
                        "name": "minimumInput",
                        "type": "uint256"
                    },
                    {
                        "internalType": "uint256",
                        "name": "maximumInput",
                        "type": "uint256"
                    },
                    {
                        "internalType": "uint256",
                        "name": "maximumIORatio",
                        "type": "uint256"
                    },
                    {
                        "components": [
                            {
                                "components": [
                                    {
                                        "internalType": "address",
                                        "name": "owner",
                                        "type": "address"
                                    },
                                    {
                                        "internalType": "bool",
                                        "name": "handleIO",
                                        "type": "bool"
                                    },
                                    {
                                        "components": [
                                            {
                                                "internalType": "contract IInterpreterV1",
                                                "name": "interpreter",
                                                "type": "address"
                                            },
                                            {
                                                "internalType": "contract IInterpreterStoreV1",
                                                "name": "store",
                                                "type": "address"
                                            },
                                            {
                                                "internalType": "address",
                                                "name": "expression",
                                                "type": "address"
                                            }
                                        ],
                                        "internalType": "struct Evaluable",
                                        "name": "evaluable",
                                        "type": "tuple"
                                    },
                                    {
                                        "components": [
                                            {
                                                "internalType": "address",
                                                "name": "token",
                                                "type": "address"
                                            },
                                            {
                                                "internalType": "uint8",
                                                "name": "decimals",
                                                "type": "uint8"
                                            },
                                            {
                                                "internalType": "uint256",
                                                "name": "vaultId",
                                                "type": "uint256"
                                            }
                                        ],
                                        "internalType": "struct IO[]",
                                        "name": "validInputs",
                                        "type": "tuple[]"
                                    },
                                    {
                                        "components": [
                                            {
                                                "internalType": "address",
                                                "name": "token",
                                                "type": "address"
                                            },
                                            {
                                                "internalType": "uint8",
                                                "name": "decimals",
                                                "type": "uint8"
                                            },
                                            {
                                                "internalType": "uint256",
                                                "name": "vaultId",
                                                "type": "uint256"
                                            }
                                        ],
                                        "internalType": "struct IO[]",
                                        "name": "validOutputs",
                                        "type": "tuple[]"
                                    }
                                ],
                                "internalType": "struct Order",
                                "name": "order",
                                "type": "tuple"
                            },
                            {
                                "internalType": "uint256",
                                "name": "inputIOIndex",
                                "type": "uint256"
                            },
                            {
                                "internalType": "uint256",
                                "name": "outputIOIndex",
                                "type": "uint256"
                            },
                            {
                                "components": [
                                    {
                                        "internalType": "address",
                                        "name": "signer",
                                        "type": "address"
                                    },
                                    {
                                        "internalType": "uint256[]",
                                        "name": "context",
                                        "type": "uint256[]"
                                    },
                                    {
                                        "internalType": "bytes",
                                        "name": "signature",
                                        "type": "bytes"
                                    }
                                ],
                                "internalType": "struct SignedContextV1[]",
                                "name": "signedContext",
                                "type": "tuple[]"
                            }
                        ],
                        "internalType": "struct TakeOrderConfig[]",
                        "name": "orders",
                        "type": "tuple[]"
                    }
                ],
                "internalType": "struct TakeOrdersConfig",
                "name": "takeOrders_",
                "type": "tuple"
            },
            {
                "internalType": "uint256",
                "name": "minimumSenderOutput_",
                "type": "uint256"
            },
            {
                "internalType": "bytes",
                "name": "exchangeData_",
                "type": "bytes"
            }
        ],
        "name": "arb",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    }
];

/**
* Minimal ABI for 0x Arb contract only including arb() function
*/
exports.zeroExArbAbi = [
    {
        "inputs": [
            {
                "components": [
                    {
                        "internalType": "address",
                        "name": "output",
                        "type": "address"
                    },
                    {
                        "internalType": "address",
                        "name": "input",
                        "type": "address"
                    },
                    {
                        "internalType": "uint256",
                        "name": "minimumInput",
                        "type": "uint256"
                    },
                    {
                        "internalType": "uint256",
                        "name": "maximumInput",
                        "type": "uint256"
                    },
                    {
                        "internalType": "uint256",
                        "name": "maximumIORatio",
                        "type": "uint256"
                    },
                    {
                        "components": [
                            {
                                "components": [
                                    {
                                        "internalType": "address",
                                        "name": "owner",
                                        "type": "address"
                                    },
                                    {
                                        "internalType": "bool",
                                        "name": "handleIO",
                                        "type": "bool"
                                    },
                                    {
                                        "components": [
                                            {
                                                "internalType": "contract IInterpreterV1",
                                                "name": "interpreter",
                                                "type": "address"
                                            },
                                            {
                                                "internalType": "contract IInterpreterStoreV1",
                                                "name": "store",
                                                "type": "address"
                                            },
                                            {
                                                "internalType": "address",
                                                "name": "expression",
                                                "type": "address"
                                            }
                                        ],
                                        "internalType": "struct Evaluable",
                                        "name": "evaluable",
                                        "type": "tuple"
                                    },
                                    {
                                        "components": [
                                            {
                                                "internalType": "address",
                                                "name": "token",
                                                "type": "address"
                                            },
                                            {
                                                "internalType": "uint8",
                                                "name": "decimals",
                                                "type": "uint8"
                                            },
                                            {
                                                "internalType": "uint256",
                                                "name": "vaultId",
                                                "type": "uint256"
                                            }
                                        ],
                                        "internalType": "struct IO[]",
                                        "name": "validInputs",
                                        "type": "tuple[]"
                                    },
                                    {
                                        "components": [
                                            {
                                                "internalType": "address",
                                                "name": "token",
                                                "type": "address"
                                            },
                                            {
                                                "internalType": "uint8",
                                                "name": "decimals",
                                                "type": "uint8"
                                            },
                                            {
                                                "internalType": "uint256",
                                                "name": "vaultId",
                                                "type": "uint256"
                                            }
                                        ],
                                        "internalType": "struct IO[]",
                                        "name": "validOutputs",
                                        "type": "tuple[]"
                                    }
                                ],
                                "internalType": "struct Order",
                                "name": "order",
                                "type": "tuple"
                            },
                            {
                                "internalType": "uint256",
                                "name": "inputIOIndex",
                                "type": "uint256"
                            },
                            {
                                "internalType": "uint256",
                                "name": "outputIOIndex",
                                "type": "uint256"
                            },
                            {
                                "components": [
                                    {
                                        "internalType": "address",
                                        "name": "signer",
                                        "type": "address"
                                    },
                                    {
                                        "internalType": "uint256[]",
                                        "name": "context",
                                        "type": "uint256[]"
                                    },
                                    {
                                        "internalType": "bytes",
                                        "name": "signature",
                                        "type": "bytes"
                                    }
                                ],
                                "internalType": "struct SignedContextV1[]",
                                "name": "signedContext",
                                "type": "tuple[]"
                            }
                        ],
                        "internalType": "struct TakeOrderConfig[]",
                        "name": "orders",
                        "type": "tuple[]"
                    }
                ],
                "internalType": "struct TakeOrdersConfig",
                "name": "takeOrders_",
                "type": "tuple"
            },
            {
                "internalType": "uint256",
                "name": "minimumSenderOutput_",
                "type": "uint256"
            },
            {
                "internalType": "address",
                "name": "zeroExSpender_",
                "type": "address"
            },
            {
                "internalType": "bytes",
                "name": "zeroExData_",
                "type": "bytes"
            }
        ],
        "name": "arb",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    }
];