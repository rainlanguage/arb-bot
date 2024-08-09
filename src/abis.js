/**
 * Minimal ABI for ERC20 contract only including Transfer event
 */
const erc20Abi = [
    "event Transfer(address indexed from, address indexed to, uint256 value)",
    "function symbol() public view returns (string memory)",
    "function transfer(address to, uint256 amount) external returns (bool)",
    "function balanceOf(address account) external view returns (uint256)",
    "function approve(address spender, uint256 amount) external returns (bool)"
];

// structs used in the orderbook and arb abis
const IO = "(address token, uint8 decimals, uint256 vaultId)";
const EvaluableV3 = "(address interpreter, address store, bytes bytecode)";
const SignedContextV1 = "(address signer, uint256[] context, bytes signature)";
const ActionV1 = `(${EvaluableV3} evaluable, ${SignedContextV1}[] signedContext)`;
const OrderV3 = `(address owner, ${EvaluableV3} evaluable, ${IO}[] validInputs, ${IO}[] validOutputs, bytes32 nonce)`;
const TakeOrderConfigV3 = `(${OrderV3} order, uint256 inputIOIndex, uint256 outputIOIndex, ${SignedContextV1}[] signedContext)`;
const OrderConfigV3 = `(${EvaluableV3} evaluable, ${IO}[] validInputs, ${IO}[] validOutputs, bytes32 nonce, bytes32 secret, bytes meta)`;
const TakeOrdersConfigV3 = `(uint256 minimumInput, uint256 maximumInput, uint256 maximumIORatio, ${TakeOrderConfigV3}[] orders, bytes data)`;

/**
 * Minimal ABI for Orderbook contract only including vaultBalance() function
 */
const orderbookAbi = [
    `event AddOrderV2(address sender, bytes32 orderHash, ${OrderV3} order)`,
    "function vaultBalance(address owner, address token, uint256 vaultId) external view returns (uint256 balance)",
    `function deposit2(address token, uint256 vaultId, uint256 amount, ${ActionV1}[] calldata post) external`,
    `function addOrder2(${OrderConfigV3} calldata config, ${ActionV1}[] calldata post) external returns (bool stateChanged)`,
    `function enact(${ActionV1}[] calldata actions) external`,
    `function withdraw2(address token, uint256 vaultId, uint256 targetAmount, ${ActionV1}[] calldata post) external`,
    "function orderExists(bytes32 orderHash) external view returns (bool exists)",
    `function removeOrder2(${OrderV3} calldata order, ${ActionV1}[] calldata post) external returns (bool stateChanged)`,
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
 * Minimal ABI for Arb contract
 */
const arbAbis = [
    `function arb2(${TakeOrdersConfigV3} calldata takeOrders, uint256 minimumSenderOutput, ${EvaluableV3} calldata evaluable) external payable`
];

const multicall3Abi = [
    "function getEthBalance(address addr) external view returns (uint256 balance)"
];

// an empty evaluable mainly used as default evaluable for arb contracts
const DefaultArbEvaluable = {
    interpreter: "0x" + "0".repeat(40),
    store: "0x" + "0".repeat(40),
    bytecode: "0x"
};

module.exports = {
    arbAbis,
    erc20Abi,
    orderbookAbi,
    routeProcessor3Abi,
    interpreterV2Abi,
    IO,
    EvaluableV3,
    SignedContextV1,
    ActionV1,
    OrderV3,
    TakeOrderConfigV3,
    OrderConfigV3,
    TakeOrdersConfigV3,
    DefaultArbEvaluable,
    multicall3Abi,
};