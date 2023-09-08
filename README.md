# Rain Orderbook Arbitrage Bot
NodeJS app that clears Rain orderbook orders against major DeFi platforms liquidity by finding arbitrage trades for token pairs of orders details queried from a subgraph or from file containing array of `Order Struct`, bundling them as `takeOrders` and submitting them to [Rain GenericPoolOrderBookFlashBorrower contract](https://github.com/rainprotocol/rain.orderbook.flashborrower.zeroex).

This app requires NodeJS v18 or higher to run and is docker ready.
This app can also be run in Github Actions with a cron job, please read below for more details.

## The Case for Profitability
Profitablity can be adjusted by using an integer ≥0 for `--gas-coverage` as the percentage of the gas cost of the transaction, denominated in receiving ERC20 token, the cost of the transaction is calculated in the receiving ERC20 token unit with current market best price.

- If set to 100, the receiving profit must be at least equal or greater than gas cost.
- If set above 100, the receiving profit must be more than the amount of gas cost, for example a transaction costs 0.01 USDT (calculated from network's gas token i.e. ETH to receiving ERC20 token i.e. USDT or USDC or ...) and a value of 500 means the profit must be at least 5x the amount of gas used i.e. ≥0.05 USDT for the transaction to be successfull.
- If set to 0, profitablity becomes irrevelant meaning any match will be submitted irrespective of whether or not the transaction will be profitable. 

## Tutorial
### CLI
Start by cloning the repo and then install the dependencies:
```bash
npm install
```
or
```bash
yarn install
```
If you have Nix installed on your machine you can run the app on nix environment:
```bash
nix-shell
```
<br>

For starting the app:
```bash
node arb-bot -k 12ab... -r https://... --orderbook-address 0x1a2b... --arb-address 0xab12... [other optional arguments]
```
The app requires these arguments (all arguments can be set in env variables alternatively, more details below):
- `-k` or `--key`, Private key of wallet that performs the transactions. Will override the 'BOT_WALLET_PRIVATEKEY' in env variables
- `-r` or `--rpc`, RPC URL(s) that will be provider for interacting with evm, use different providers if more than 1 is specified to prevent banning. Will override the 'RPC_URL' in env variables
- `-m` or `--mode`, Running mode of the bot, must be one of: `0x` or `curve` or `router` or `srouter`, Will override the 'MODE' in env variables
- `--orderbook-address`, Address of the deployed orderbook contract, Will override the 'ORDERBOOK_ADDRESS' in env variables
- `--arb-address`, Address of the deployed arb contract, Will override the 'ARB_ADDRESS' in env variables
- `--arb-contract-type`, Type of the Arb contract, can be either of `flash-loan-v2` or `flash-loan-v3` or `order-taker`, not availabe for `srouter` mode since it is a specialized mode, Will override the 'ARB_TYPE' in env variables

as well as at least one or both of below arguments:

- `-o` or `--orders`, The path to a local json file containing the orders details, can be used in combination with --subgraph, Will override the 'ORDERS' in env variables
 - `-s` or `--subgraph`, Subgraph URL(s) to read orders details from, can be used in combination with --orders, Will override the 'SUBGRAPH' in env variables

Other optional arguments are:
- `-l` or `--lps`, List of liquidity providers (dex) to use by the router as one quoted string seperated by a comma for each, example: 'SushiSwapV2,UniswapV3', Will override the 'LIQUIDITY_PROVIDERS' in env variables, if unset will use all available liquidty providers
- `-a` or `--api-key`, 0x API key, can be set in env variables, Will override the 'API_KEY' env variable
- `-g` or `--gas-coverage`, The percentage of gas to cover to be considered profitable for the transaction to be submitted, an integer greater than equal 0, default is 100 meaning full coverage, Will override the 'GAS_COVER' in env variables
- `--repetitions`, Option to run `number` of times, if unset will run for infinte number of times
- `--order-hash`, Option to filter the subgraph query results with a specific order hash, Will override the 'ORDER_HASH' in env variables
- `--order-owner`, Option to filter the subgraph query results with a specific order owner address, Will override the 'ORDER_OWNER' in env variables
- `--order-interpreter`, Option to filter the subgraph query results with a specific order's interpreter address, Will override the 'ORDER_INTERPRETER' in env variables
- `--monthly-ratelimit`, 0x monthly rate limit, if not specified will not respect any 0x monthly ratelimit, Will override the 'MONTHLY_RATELIMIT' in env variables
- `--sleep`, Seconds to wait between each arb round, default is 10, Will override the 'SLEPP' in env variables
- `--max-profit`, Option to maximize profit for 'srouter' mode, comes at the cost of more RPC calls, Will override the 'MAX_PROFIT' in env variables
- `--max-ratio`, Option to maximize maxIORatio for 'srouter' mode, Will override the 'MAX_RATIO' in env variables
- `-V` or `--version`, output the version number
- `-h` or `--help`, output usage information

<br>

### List of available liquidity providers (decentralized exchanges)
- all of the below names are case INSENSITIVE:
`SushiSwapV2`
`SushiSwapV3`
`UniswapV2`
`UniswapV3`
`Trident`
`QuickSwap`
`ApeSwap`
`PancakeSwap`
`TraderJoe`
`Dfyn`
`Elk`
`JetSwap`
`SpookySwap`
`NetSwap`
`NativeWrap`
`HoneySwap`
`UbeSwap`
`Biswap`
`CurveSwap`
`DovishV3`
`LaserSwap`

<br>

CLI options can be viewed by running:
```bash
node arb-bot -h
```
which will show:

    Usage: node arb-bot|arb-bot [options]

    A NodeJS app to find and take arbitrage trades for Rain Orderbook orders against some DeFi liquidity providers, requires NodeJS v18 or higher.
    - Use "node arb-bot [options]" command alias for running the app from its repository workspace
    - Use "arb-bot [options]" command alias when this app is installed as a dependency in another project

    Options:
      -k, --key <private-key>        Private key of wallet that performs the transactions. Will override the 'BOT_WALLET_PRIVATEKEY' in env variables
      -r, --rpc <url...>                RPC URL(s) that will be provider for interacting with evm, use different providers if more than 1 is specified to prevent banning. Will override the 'RPC_URL' in env variables
      -m, --mode <string>            Running mode of the bot, must be one of: `0x` or `curve` or `router` or `srouter`, Will override the 'MODE' in env variables
      -o, --orders <path>            The path to a local json file containing the orders details, can be used in combination with --subgraph, Will override the 'ORDERS' in env variables
      -s, --subgraph <url...>        Subgraph URL(s) to read orders details from, can be used in combination with --orders, Will override the 'SUBGRAPH' in env variables
      --orderbook-address <address>  Address of the deployed orderbook contract, Will override the 'ORDERBOOK_ADDRESS' in env variables
      --arb-address <address>        Address of the deployed arb contract, Will override the 'ARB_ADDRESS' in env variables
      --arb-contract-type <string>   Type of the Arb contract, can be either of `flash-loan-v2` or `flash-loan-v3` or `order-taker`, not availabe for `srouter` mode since it is a specialized mode, Will override the 'ARB_TYPE' in env variables
      -l, --lps <string>             List of liquidity providers (dex) to use by the router as one quoted string seperated by a comma for each, example: 'SushiSwapV2,UniswapV3', Will override the 'LIQUIDITY_PROVIDERS' in env variables, if unset will use all available liquidty providers
      -a, --api-key <key>            0x API key, can be set in env variables, Will override the 'API_KEY' env variable
      -g, --gas-coverage <integer>   The percentage of gas to cover to be considered profitable for the transaction to be submitted, an integer greater than equal 0, default is 100 meaning full coverage, Will override the 'GAS_COVER' in env variables
      --repetitions <integer>        Option to run `number` of times, if unset will run for infinte number of times
      --order-hash <hash>            Option to filter the subgraph query results with a specific order hash, Will override the 'ORDER_HASH' in env variables
      --order-owner <address>        Option to filter the subgraph query results with a specific order owner address, Will override the 'ORDER_OWNER' in env variables
      --order-interpreter <address>  Option to filter the subgraph query results with a specific order's interpreter address, Will override the 'ORDER_INTERPRETER' in env variables
      --monthly-ratelimit <integer>  0x monthly rate limit, if not specified will not respect any 0x monthly ratelimit, Will override the 'MONTHLY_RATELIMIT' in env variables
      --sleep <integer>              Seconds to wait between each arb round, default is 10, Will override the 'SLEPP' in env variables
      --max-profit                   Option to maximize profit for 'srouter' mode, comes at the cost of more RPC calls, Will override the 'MAX_PROFIT' in env variables
      --max-ratio                    Option to maximize maxIORatio for 'srouter' mode, Will override the 'MAX_RATIO' in env variables
      -V, --version                  output the version number
      -h, --help                     display help for command
<br>

Alternatively all variables can be specified in env variables with below keys:
```bash
# private key of the matchmaker bot's wallet
BOT_WALLET_PRIVATEKEY="123..."

# RPC URL(s) that will be provider for interacting with evm, use different providers if more than 1 is specified to prevent banning. 
# for specifying more than 1 RPC in the env, separate them by a comma and a space
RPC_URL="https://polygon-mainnet.g.alchemy.com/v2/{API_KEY}, https://rpc.ankr.com/polygon/{API_KEY}"

# bot running mode, one of "router", "0x", "curve", "srouter"
MODE="router"

# arb contract address
ARB_ADDRESS="0x123..."

# orderbook contract address
ORDERBOOK_ADDRESS="0x123..."

# one or more subgraph urls to read orders details from, can be used in combination with ORDERS
# for more than 1 subgraphs, seperate them by comma and a space
SUBGRAPH="https://api.thegraph.com/subgraphs/name/org1/sg1, https://api.thegraph.com/subgraphs/name/org2/sg2"

# path to a .json file containing orders details, can be used in combination with SUBGRAPH 
# OR e.g. the path to the volume mounted by docker compose
ORDERS="/etc/rainprotocol/arb-bot/orders.json"

# 0x API key
API_KEY=

# list of liquidity providers names seperated by a comma for each
LIQUIDITY_PROVIDERS="sushiswapv2,uniswapv3,quickswap"

# gas coverage percentage for each transaction to be considered profitable to be submitted
GAS_COVER="100"

# 0x monthly rate limit number, if not specified will not respect 0x monthly rate limit
MONTHLY_RATELIMIT=200000

# an integer used for specifiying the number repetitions for the app to run, if not set will run for infinite number of times
REPETITIONS=1

# Option to filter the subgraph query results with a specific order hash
ORDER_HASH=""

# Option to filter the subgraph query results with a specific order owner address
ORDER_OWNER=""

# Option to filter the subgraph query results with a specific order interpreter address
ORDER_INTERPRETER=""

# Type of the Arb contract, can be either of 'flash-loan-v2' or 'flash-loan-v3' or 'order-taker', not availabe for 'srouter' mode since it is a specialized mode
ARB_TYPE="flash-loan-v2"

# Option to maximize profit for 'srouter' mode, comes at the cost of more RPC calls
MAX_PROFIT="true"

# Seconds to wait between each arb round, default is 10, Will override the 'SLEPP' in env variables
SLEEP=10

# Option to maximize maxIORatio for 'srouter' mode
MAX_RATIO="true"
```
If both env variables and CLI argument are set, the CLI arguments will be prioritized and override the env variables.

If you install this app as a dependency for your project you can run it by (All the above arguments apply here as well):
```bash
arb-bot [arguments]
```
<br>

### API
The app can be executed through API:
```javascript
// to import
const RainArbBot = require("@rainprotocol/arb-bot");

// to run the app:
// options (all properties are optional)
const configOptions = {
  zeroExApiKey          : "...",   // required for '0x' mode
  monthlyRatelimit      : 1000000, // 0x monthly rate limit, only used for 0x mode
  hideSensitiveData     : true,    // set to true to hide sensitive data such as wallet private key or rpc url from apearing in logs
  maxProfit             : true,    // option to maximize profit for 'srouter' mode
  maxRatio              : true     // option to maximize the maxIORatio in "srouter" mode
  liquidityProviders    : [        // list of liquidity providers for "router" mode to get quotes from (optional)
    "sushiswapv2",
    "uniswapv2"
  ]
}
const clearOptions = {
  prioritization        : true,    // clear better deals first
  gasCoveragePercentage : "500"    // percentage of the transaction gas cost denominated in receiving ERC20 to be earned from the transaction in order for it to be successfull, as an example a value of 500 means atleast 5x the amount of transaction gas cost needs to be earned for the transaction to be successfull
}

// to get the configuration object
const config = await RainArbBot.getConfig(rpcUrl, walletPrivateKey, orderbookAddress, arbAddress, arbType, ...[configOptions]);

// to get the order details, one or both of subgraph and json file can be used simultaneously
const ordersJson    = "/home/orders.json"                                 // path to a local json file 
const subgraphs     = ["https://api.thegraph.com/subgraphs/name/xxx/yyy"] // array of subgraph URLs
const sgFilters     = {                                                   // filters for subgraph query (each filter is optional)
  orderHash         : "0x1234...",
  orderOwner        : "0x1234...",
  orderInterpreter  : "0x1234..."
}

// get the order details from the sources
const orderDetails = await RainArbBot.getOrderDetails(subgraphs, ordersJson, config.signer, sgFilters);

// to run the clearing process and get the report object which holds the report of cleared orders
const mode = "srouter" // mode can be one of "router", "0x" or "curve" or "srouter"
const reports = await RainArbBot.clear(mode, config, orderDetails, ...[clearOptions])
```
<br>

## Running On Github Actions
In order to run this app periodically to clear orders in Github Actions, first you need to fork this repository, then you can modify the `./.github/workflows/take-orders.yaml` file with your desired configuration so the app run periodically. You can set the schedule for the app to run by modifying the cron syntax of the mentioned file and in the last line of the file, you can pass the required/optional arguments for the app to run. All the mentioned CLI arguments can be applied, for wallet private key and rpc url, you can set up Github Secrets.

Please be aware that schediled Github Actions can only be run at minimum once every 5 minutes and even that is not guarateed because it depends on Github resource availability at that time, so it is recommended to run the app on personal/reliable host if there is sensitivity with running on a schedule.

## Developers Guide
To run the tests:
```bash
npm test
```
for nix users:
```bash
ci-test
```
which runs on hardhat forked polygon network while using the 0x live price quotes.

To run doc generation:
```bash
npm run docgen
```
for nix users:
```bash
docgen
```

To lint/lint and fix:
```bash
npm run lint
```
```bash
npm run lint-fix
```
for nix users:
```bash
lint
```
```bash
lint-fix
```

## Docker

Use docker compose if possible as it handles several things for you:

- Restart policy
- Rebuild policy
- Volume management
- Log rotation/policy
- Potentially other stuff like networking

### .env

Docker compose natively supports .env so configure it as per example.env and above.

Notably `DOCKER_CHANNEL` MUST be set to the git branch that you're currently on,
and you should be at the HEAD of said branch when attempting to interact with it.

This ensures that you'll download a docker image compatible with the current code
in your repository.

### Up & volumes

Run `docker compose up -d` to bring the container up. If this is the first time
you are doing this for the current channel you will likely see a complaint about
a missing volume.

You can create the volume however you want using `docker volume` but if you want
to map a specific path on the host to the volume mounted in the guest you'll need
to tell Docker to do so. The default behaviour of Docker is that it manages
volumes opaquely within its own system files, which has pros and cons. Either way
the default behaviour won't give you a predictable path on the host to work with.

To create a bind mount to a specific absolute path on the host

```
docker volume create --driver local --opt type=none --opt device=<absolute-host-path> --opt o=bind <volume-name>
```