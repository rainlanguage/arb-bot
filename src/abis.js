/**
 * Minimal ABI for ERC20 contract only including Transfer event
 */
const erc20Abi = [
    "event Transfer(address indexed from, address indexed to, uint256 value)",
    "function symbol() public view returns (string memory)",
    "function transfer(address to, uint256 amount) external returns (bool)"
];

/**
 * Minimal ABI for Orderbook contract only including vaultBalance() function
 */
const orderbookAbi = [
    "function vaultBalance(address owner, address token, uint256 id) external view returns (uint256 balance)"
];

/**
 * Minimal ABI for IInterpreterV2 contract only including eval() function
 */
const interpreterV2Abi = [
    `function eval2(
        address store,
        uint256 namespace,
        uint256 dispatch,
        uint256[][] calldata context,
        uint256[] calldata inputs
    ) external view returns (uint256[] calldata stack, uint256[] calldata writes)`
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
 * Minimal ABI for Arb contracts paired with "types" keys only including arb() function
 */
const arbAbis = [
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
];

module.exports = {
    arbAbis,
    erc20Abi,
    orderbookAbi,
    routeProcessor3Abi,
    interpreterV2Abi
};