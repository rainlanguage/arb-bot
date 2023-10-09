/**
 * Minimal ABI for ERC20 contract only including Transfer event
 */
const erc20Abi = [
    "event Transfer(address indexed from, address indexed to, uint256 value)",
    "function symbol() public view returns (string memory)"
];

/**
 * Minimal ABI for Orderbook contract only including vaultBalance() function
 */
const orderbookAbi = [
    `function vaultBalance(
        address owner,
        address token,
        uint256 id
    ) external view returns (uint256 balance)`
];

/**
 * Minimal ABI for IInterpreterV1 contract only including eval() function
 */
const interpreterAbi = [
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
const routeProcessor3Abi = [
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
 * Curve pools function signatures
 */
const CURVE_POOLS_FNS = [
    "function get_dy(int128 i, int128 j, uint256 dx) view returns (uint256)",
    "function get_dy_underlying(int128 i, int128 j, uint256 dx) view returns (uint256)",
    "function exchange(int128 i, int128 j, uint256 dx, uint256 min_dy) returns (uint256)",
    "function exchange_underlying(int128 i, int128 j, uint256 dx, uint256 min_dy) returns (uint256)"
];

/**
 * Curve Zap contract function signatures
 */
const CURVE_ZAP_FNS = [
    [`function exchange_underlying(
        address _pool,
        int128 _i,
        int128 _j,
        uint256 _dx,
        uint256 _min_dy
    ) returns (uint256)`],

    [`function exchange_underlying(
        address _pool,
        int128 _i,
        int128 _j,
        uint256 _dx,
        uint256 _min_dy,
        address _receiver
    ) returns (uint256)`],

    [`function exchange_underlying(
        address _pool,
        int128 _i,
        int128 _j,
        uint256 _dx,
        uint256 _min_dy,
        address _receiver,
        bool _use_underlying
    ) returns (uint256)`]
];

/**
 * Minimal ABI for UniswapV2Route02 contract only including getAmountsOut() and get AmountsIn() functions
 */
const uniswapV2Route02Abi = [
    `function getAmountsOut(
        uint amountIn, 
        address[] calldata path
    ) external view returns (uint[] memory amounts)`,
    `function getAmountsIn(
        uint amountOut, 
        address[] calldata path
    ) external view returns (uint[] memory amounts)`
];

/**
 * Minimal ABI for Arb contracts paired with "types" keys only including arb() function
 */
const arbAbis = {
    // old generic flash borrower, obv2
    "flash-loan-v2": [
        `function arb(
            (
                address output, 
                address input, 
                uint256 minimumInput, 
                uint256 maximumInput, 
                uint256 maximumIORatio, 
                (
                    (
                        address owner, 
                        bool handleIO, 
                        (
                            address interpreter, 
                            address store, 
                            address expression
                        ) evaluable, 
                        (
                            address token, 
                            uint8 decimals, 
                            uint256 vaultId
                        )[] validInputs, 
                        (
                            address token, 
                            uint8 decimals, 
                            uint256 vaultId
                        )[] validOutputs
                    ) order, 
                    uint256 inputIOIndex, 
                    uint256 outputIOIndex, 
                    (
                        address signer, 
                        uint256[] context, 
                        bytes signature
                    )[] signedContext
                )[] orders
            ) takeOrders, 
            uint256 minimumSenderOutput, 
            bytes exchangeData
        ) external payable`
    ],

    // new flash borrower, obv3
    "flash-loan-v3": [
        `function arb(
            (
                uint256 minimumInput, 
                uint256 maximumInput, 
                uint256 maximumIORatio, 
                (
                    (
                        address owner, 
                        bool handleIO, 
                        (
                            address interpreter, 
                            address store, 
                            address expression
                        ) evaluable, 
                        (
                            address token, 
                            uint8 decimals, 
                            uint256 vaultId
                        )[] validInputs, 
                        (
                            address token, 
                            uint8 decimals, 
                            uint256 vaultId
                        )[] validOutputs
                    ) order, 
                    uint256 inputIOIndex, 
                    uint256 outputIOIndex, 
                    (
                        address signer, 
                        uint256[] context, 
                        bytes signature
                    )[] signedContext
                )[] orders,
                bytes data
            ) takeOrders, 
            uint256 minimumSenderOutput, 
            bytes exchangeData
        ) external payable`
    ],

    // arb order taker, obv3
    "order-taker": [
        `function arb(
            (
                uint256 minimumInput, 
                uint256 maximumInput, 
                uint256 maximumIORatio, 
                (
                    (
                        address owner, 
                        bool handleIO, 
                        (
                            address interpreter, 
                            address store, 
                            address expression
                        ) evaluable, 
                        (
                            address token, 
                            uint8 decimals, 
                            uint256 vaultId
                        )[] validInputs, 
                        (
                            address token, 
                            uint8 decimals, 
                            uint256 vaultId
                        )[] validOutputs
                    ) order, 
                    uint256 inputIOIndex, 
                    uint256 outputIOIndex, 
                    (
                        address signer, 
                        uint256[] context, 
                        bytes signature
                    )[] signedContext
                )[] orders,
                bytes data
            ) takeOrders, 
            uint256 minimumSenderOutput
        ) external payable`
    ],

    // router arb tpye
    "srouter": [
        `function arb(
            (
                uint256 minimumInput, 
                uint256 maximumInput, 
                uint256 maximumIORatio, 
                (
                    (
                        address owner, 
                        bool handleIO, 
                        (
                            address interpreter, 
                            address store, 
                            address expression
                        ) evaluable, 
                        (
                            address token, 
                            uint8 decimals, 
                            uint256 vaultId
                        )[] validInputs, 
                        (
                            address token, 
                            uint8 decimals, 
                            uint256 vaultId
                        )[] validOutputs
                    ) order, 
                    uint256 inputIOIndex, 
                    uint256 outputIOIndex, 
                    (
                        address signer, 
                        uint256[] context, 
                        bytes signature
                    )[] signedContext
                )[] orders,
                bytes data
            ) takeOrders, 
            uint256 minimumSenderOutput
        ) external payable`
    ]
};

module.exports = {
    arbAbis,
    erc20Abi,
    orderbookAbi,
    interpreterAbi,
    routeProcessor3Abi,
    uniswapV2Route02Abi,
    CURVE_POOLS_FNS,
    CURVE_ZAP_FNS
    // genericArbAbi,
    // zeroExArbAbi,
    // arbTakerAbi
};