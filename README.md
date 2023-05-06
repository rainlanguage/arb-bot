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
- `-s` or `--slippage` The slippage that can be set for the trades, the default is 0.001 which is 0.1%
- `--subgraph-url` A custom subgraph endpoint URL, used to read order details from, the default is Rain Orderbook Subgraph. The custom subgraph should follow the Rain Orderbook Subgraph schema.
- `--interpreter-abi` The path to IInterpreter ABI json file used for instantiating ethers contract instances, should be absolute path, default is the `./src/abis/IInerpreterV1.json`.
- `--arb-abi` The path to Arb (ZeroExOrderBookFlashBorrower) ABI json file used for instantiating ethers contract instances, should be absolute path, default is the `./src/abis/ZeroExOrderBookFlashBorrower.json`.
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
      -k, --key <private-key>        Private key of wallet that performs the transactions. Will override the 'WALLET_KEY' in '.env' file
      -r, --rpc <url>                RPC URL that will be provider for interacting with evm. Will override the 'RPC_URL' in '.env' file
      -s, --slippage <number>        Sets the slippage percentage for the clearing orders, default is 0.001 which is 0.1%
      --subgraph-url <url>           The subgraph endpoint url used to fetch order details from
      --orderbook-address <address>  Address of the deployed orderbook contract. Will override 'orderbookAddress' field in './config.json' file
      --arb-address <address>        Address of the deployed arb contract. Will override 'arbAddress' field in './config.json' file
      --interpreter-abi <path>       Path to the IInterpreter contract ABI, default is the ABI in the './stc/abis' folder
      --arb-abi <path>               Path to the Arb (ZeroExOrderBookFlashBorrower) contract ABI, default is the ABI in the './stc/abis' folder
      -V, --version                  output the version number
      -h, --help                     output usage information
<br>

Alternatively wallet private key and RPC URL can be set in a `.env` file or set as environment variables with:
```bash
## private key of the wallet
WALLET_PRIVATEKEY="1234567890..."

## RPC URL of the desired network
RPC_URL="https://alchemy...."
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
const config = await arb.getConfig(wallet, orderbookAddress, arbAddress, ...[ arbAbiPath, interpreterAbiPath ]);

// to run the clearing process and get the report object which holds the report of cleared orders
const reports = await arb.clear(wallet, config, queryResult, ...[ slippage, prioritization ])
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