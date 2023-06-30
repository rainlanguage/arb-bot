# Rain Orderbook Arbitrage Bot
NodeJS app that clears Rain orderbook orders against 0x liquididty by finding 0x trades for token pairs of order details queried from a subgraph, bundling the `takeOrders` and submitting them to [Rain GenericPoolOrderBookFlashBorrower contract](https://github.com/rainprotocol/rain.orderbook.flashborrower.zeroex).
Clearing bundled orders should cover the gas cost of the transaction at least so the transactions gets submitted, otherwise they will be skipped.
The cost of the transaction is calculated in the profit token currency.

This app requires NodeJS v18 to run.
This app can also be run in Github Actions with a cron job, please read below for more details.

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
The app requires these 4 arguments:
- `-k` or `--key`, Private key of wallet that performs the transactions. Will override the 'BOT_WALLET_PRIVATEKEY' in env variables
- `-r` or `--rpc`, RPC URL that will be provider for interacting with evm. Will override the 'RPC_URL' in env variables
- `-m` or `--mode`, Running mode of the bot, must be one of: `0x` or `curve` or `router`, default is `router`, Will override the 'MODE' in env variables
- `-o` or `--orders`, The ABSOLUTE path to a local json file containing the orders details, can be used in combination with --subgraph, Will override the 'ORDERS' in env variables
 - `-s` or `--subgraph`, Subgraph URL to read orders details from, can be used in combination with --orders, Will override the 'SUBGRAPH' in env variables
- `--orderbook-address`, Address of the deployed orderbook contract, Will override the 'ORDERBOOK_ADDRESS' in env variables
- `--arb-address`, Address of the deployed arb contract, Will override the 'ARB_ADDRESS' in env variables

Other optional arguments are:
- `-l` or `--lps`, List of liquidity providers (dex) to use by the router as one quoted string seperated by a comma for each, example: 'SushiSwapV2,UniswapV3', Will override the 'LIQUIDITY_PROVIDERS' in env variables
- `-a` or `--api-key`, 0x API key, can be set in env variables, Will override the 'API_KEY' env variable
- `-g` or `--gas-coverage`, The percentage of gas to cover to be considered profitable for the transaction to be submitted, an integer greater than equal 0, default is 100 meaning full coverage, Will override the 'GAS_COVER' in env variables
- `--no-monthly-ratelimit`, Option to make the app respect 200k 0x API calls per month rate limit, mainly used when not running this app on a bash loop, Will override the 'MONTHLY_RATELIMIT' in env variables
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

    Usage: node arb-bot [options]

    Options:
      -k, --key <private-key>        Private key of wallet that performs the transactions. Will override the 'BOT_WALLET_PRIVATEKEY' in env variables
      -r, --rpc <url>                RPC URL that will be provider for interacting with evm. Will override the 'RPC_URL' in env variables
      -m, --mode <string>            Running mode of the bot, must be one of: `0x` or `curve` or `router`, default is `router`, Will override the 'MODE' in env variables
      -o, --orders <path>            The ABSOLUTE path to a local json file containing the orders details, can be used in combination with --subgraph, Will override the 'ORDERS' in env variables
      -s, --subgraph <url>           Subgraph URL to read orders details from, can be used in combination with --orders, Will override the 'SUBGRAPH' in env variables
      --orderbook-address <address>  Address of the deployed orderbook contract, Will override the 'ORDERBOOK_ADDRESS' in env variables
      --arb-address <address>        Address of the deployed arb contract, Will override the 'ARB_ADDRESS' in env variables
      -l, --lps <string>             List of liquidity providers (dex) to use by the router as one quoted string seperated by a comma for each, example: 'SushiSwapV2,UniswapV3', Will override the 'LIQUIDITY_PROVIDERS' in env variables
      -a, --api-key <key>            0x API key, can be set in env variables, Will override the 'API_KEY' env variable
      -g, --gas-coverage <integer>    The percentage of gas to cover to be considered profitable for the transaction to be submitted, an integer greater than equal 0, default is 100 meaning full coverage, Will override the 'GAS_COVER' in env variables
      --no-monthly-ratelimit         Option to make the app respect 200k 0x API calls per month rate limit, mainly used when not running this app on a bash loop, Will override the 'MONTHLY_RATELIMIT' in env variables
      -V, --version                  output the version number
      -h, --help                     output usage information
<br>

Alternatively all variables can be specified in env variables with below keys:
```bash
# private key of the matchmaker bot's wallet
BOT_WALLET_PRIVATEKEY="123..."

# RPC URL of the desired network, personal RPC API endpoints are preferened
RPC_URL="https://polygon-mainnet.g.alchemy.com/v2/{API_KEY}"

# bot running mode, one of "router", "0x", "curve"
MODE="router"

# arb contract address
ARB_ADDRESS="0x123..."

# orderbook contract address
ORDERBOOK_ADDRESS="0x123..."

# a subgraph url to read orders details from, can be used in combination with ORDERS
SUBGRAPH="https://api.thegraph.com/subgraphs/name/siddharth2207/slsohysubgraph"

# path to a .json file containing orders details, can be used in combination with SUBGRAPH 
# OR e.g. the path to the volume mounted by docker compose
ORDERS="/etc/rainprotocol/arb-bot/orders.json"

# 0x API key
API_KEY=

# list of liquidity providers names seperated by a comma for each
LIQUIDITY_PROVIDERS="sushiswapv2,uniswapv3,quickswap"

# gas coverage percentage for each transaction to be considered profitable to be submitted
GAS_COVER="100"

# respect 0x monthly rate limit
MONTHLY_RATELIMIT="true"
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
const arb = require("@rainprotocol/arb-bot");

// to run the app:
// options (all properties are optional)
const configOptions = {
  zeroExApiKey: "123..", // required for '0x' mode
  liquidityProviders: ["sushiswapv2", "uniswapv2"],  // optional for specifying liquidity providers
  monthlyRatelimit: false  // option for 0x mode to respect its monthly rate limit
  hideSensitiveData: true  // hides sensitive data such as wallet private key or rpc url from apearing in logs
}
const clearOptions = {
  gasCoveragePercentage: "100", // how much gas cost to cover on each transaction
  prioritization: true // clear better deals first
}

// to get the configuration object
const config = await arb.getConfig(rpcUrl, walletPrivateKey, orderbookAddress, arbAddress, ...[configOptions]);

// to get the order details, one or both of subgraph and json file can be used simultaneously
const subgraph = "https://api.thegraph.com/subgraphs/name/xxx/yyy" // subgraph URL
const ordersJson = "/home/orders.json" // path to a local json file 
const orderDetails = await arb.getOrderDetails(subgraph, ordersJson, config.signer);

// to run the clearing process and get the report object which holds the report of cleared orders
const mode = "router" // mode can be one of "router", "0x" or "curve"
const reports = await arb.clear(mode, config, orderDetails, ...[clearOptions])
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