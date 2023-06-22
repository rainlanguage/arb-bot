# Rain Orderbook Arbitrage Bot
NodeJS app that clears Rain orderbook orders against 0x liquididty by finding 0x trades for token pairs of order details queried from a subgraph, bundling the `takeOrders` and submitting them to [Rain ZeroExOrderBookFlashBorrower contract](https://github.com/rainprotocol/rain.orderbook.flashborrower.zeroex).
Clearing bundled orders should cover the gas cost of the transaction at least so the transactions gets submitted, otherwise they will be skipped.
The cost of the transaction is calculated in the profit token currency.

This app requires NodeJS to run.
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
If you have Nix installed on your machine you can tun the app on nix environment:
```bash
nix-shell
```
<br>

For starting the app:
```bash
node arb-bot -k 12ab... -r https://... --orderbook-address 0x1a2b... --arb-address 0xab12... [other optional arguments]
```
The app requires these 4 arguments:
- `-k` or `--key` A wallet private with eth balance to cover transaction costs, this wallet also receives the profits from submitting the transactions. A wallet private key is 64 length hex string. This can be set as environment variables too, see below.
- `-r` or `--rpc` An RPC URL, such as from Alchemy or Infura required for interacting with the working network. This can be set as environment variables too, see below.
- `--orderbook-address` The Rain Orderbook contract address deployed on the working network.
- `--arb-address` The Arb (ZeroExOrderBookFlashBorrower) contract address deployed on the working network.

Other optional arguments are:
- `-m` or `--mode` Running mode of the bot, must be one of: `0x` or `curve` or `router`, default is `router`
- `-l` or `--lps`, List of liquidity providers (dex) to use by the router as one quoted string seperated by a comma for each, example: `"SushiSwapV2,UniswapV3"`, available liquidity providers are: `SushiSwapV2` `SushiSwapV3` `UniswapV2` `UniswapV3` `Trident` `QuickSwap` `ApeSwap` `PancakeSwap` `TraderJoe` `Dfyn` `Elk` `JetSwap` `SpookySwap` `NetSwap` `NativeWrap` `HoneySwap` `UbeSwap` `Biswap` `CurveSwap` `DovishV3` `LaserSwap`
- `-a` or `--api-key` The 0x API key to use for quoting 0x with. Can also be set in env variables as `API_KEY`, see below.
- `-s` or `--slippage` The slippage that can be set for the trades, the default is 0.001 which is 0.1%
- `-g` or `--gas-coverage` The percentage of gas to cover to be considered profitable for the transaction to be submitted, between 0 - 100, default is 100 meaning full coverage
- `--subgraph-url` A custom subgraph endpoint URL, used to read order details from, the default is Rain Orderbook Subgraph. The custom subgraph should follow the Rain Orderbook Subgraph schema.
- `--no-monthly-ratelimit` Used to respect monthly 200k 0x API calls, mainly used when not running this app on a bash loop, e.g. Github Actions
- `-h` or `--help` To show the CLI command's help
- `-v` or `--version` To show the app's version
<br>

CLI options can be viewed by running:
```bash
node arb-bot -h
```
which will show:

    Usage: node arb-bot [options]

    Options:
      -k, --key <private-key>        Private key of wallet that performs the transactions. Will override the 'BOT_WALLET_PRIVATEKEY' in '.env' file
      -r, --rpc <url>                RPC URL that will be provider for interacting with evm. Will override the 'RPC_URL' in '.env' file
      -m, --mode <string>            Running mode of the bot, must be one of: `0x` or `curve` or `router`, default is `router`
      -l, --lps <string>             List of liquidity providers (dex) to use by the router as one quoted string seperated by a comma for each, example: 'SushiSwapV2,UniswapV3'
      -s, --slippage <number>        Sets the slippage percentage for the clearing orders, default is 0.001 which is 0.1%
      -a, --api-key <key>            0x API key, can be set in env variables, Will override the API_KEY env variable
      -g, --gas-coverage <number>    The percentage of gas to cover to be considered profitable for the transaction to be submitted, between 0 - 100, default is 100 meaning full coverage
      --orderbook-address <address>  Address of the deployed orderbook contract
      --arb-address <address>        Address of the deployed arb contract
      --subgraph-url <url>           The subgraph endpoint url used to fetch order details from
      --no-monthly-ratelimit         Pass to make the app respect 200k 0x API calls per month rate limit, mainly used when not running this app on a bash loop
      -V, --version                  output the version number
      -h, --help                     output usage information
<br>

Alternatively wallet private key and RPC URL can be set in a `.env` file or set as environment variables with:
```bash
## private key of the wallet
BOT_WALLET_PRIVATEKEY="1234567890..."

## RPC URL of the desired network
RPC_URL="https://alchemy...."

# 0x API key
API_KEY="1234..."
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
const ethers = require("ethers");


// to instantiate a valid ethers wallet instance from your wallet private key and rpc url:
// instantiate the ethers provider with rpc url
const provider = new ethers.providers.JsonRpcProvider(rpcUrl);

// alternatively the provider can be instantiated with specific ethers API for rpc providers such as Alchemy
// this is prefered if you know the provider organization
const provider = new ethers.providers.AlchemyProvider(rpcUrl)

// instantiate the ethers wallet instance with private key
const wallet = new ethers.Wallet(walletPrivateKey, provider)


// to run the app:
// to get the order details from a subgraph
const queryResult = await arb.query(subgraphUrl);

// to get the configuration object
const config = await arb.getConfig(wallet, orderbookAddress, arbAddress, ...[zeroExApiKey]);

// to run the clearing process and get the report object which holds the report of cleared orders
const reports = await arb.clear(mode, wallet, config, queryResult, ...[slippage, gasCoveragePercenatge, prioritization])
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