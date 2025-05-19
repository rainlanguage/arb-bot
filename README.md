# Rain Solver
Rain Solver (also known as Rain Orderbook Arbitrage Bot) is a NodeJS app that solves (clears) Rain orderbook orders against major DeFi platforms liquidity, other Rain Orderbooks and opposite orders of the same Rain Orderbook, by finding arbitrage trades for token pairs of the active orders that are queried from a subgraph, once an opportunity is found a transaction is submitted to one of [Rain Arb Contracts](https://github.com/rainprotocol/rain.orderbook/tree/main/src/concrete) which handles the clearing process from there.

This app requires NodeJS v18 or higher to run and is docker ready.
This app can also be run in Github Actions with a cron job, please read below for more details.

## The Case for Profitability
Profitablity can be adjusted by using an integer ≥0 for `gasCoveragePercentage` config arg as the percentage of the gas cost of the transaction, denominated in receiving ERC20 token, the cost of the transaction is calculated in the receiving ERC20 token unit with current market price of that token against chain's native token.

for example:
- If set to 100, the receiving profit must be at least equal or greater than tx gas cost.
- If set above 100, the receiving profit must be more than the amount of gas cost, for example a transaction costs 0.01 USDT (calculated by current market price of ETH/USDT) and a value of 500 means the profit must be at least 5x the amount of gas used i.e. ≥0.05 USDT for the transaction to be successfull, so at least 0.04 USDT profit will be guaranteed.
- If set to 0, profitablity becomes irrevelant meaning any match will be submitted irrespective of whether or not the transaction will be profitable. 

## Tutorial
### Setup
Start by cloning the repo and then:
- with nix package manager (recommended way):

first you need to run `./prep-sushi.sh` which would need nix package manager installed on your system:
```bash
./prep-sushi.sh
```
next enter nix shell:
```bash
nix develop
```
and then:
```bash
npm install
npm run build
```
  or without entering the nix shell
```bash
nix develop -c npm install
nix develop -c npm run build
```

<br>
- without nix package manager:

you need to have pnpm `>= v8.15.3` and then run the following:
```bash
git submodule update --init --recursive
cd lib/sushiswap
pnpm install --frozen-lockfile
pnpm exec turbo run build --filter=./packages/sushi
cd ../..
```
and then install the dependencies, requires `>= nodejs v18`:
```bash
npm install
npm run build
```
<br>

### CLI
For starting the app:
- with nix package manager (recommended way):

from nix shell:
if you are not already in nix shell, enter by following command:
```bash
nix develop
```
and then:
```bash
node arb-bot <OPTIONS>
```

out of nix shell:

run the following if you don't want to enter nix shell
```bash
nix develop -c node arb-bot <OPTIONS>
```
<br>

- without nix package manager (requires `>= nodejs v18`):

```bash
node arb-bot <OPTIONS>
```

<br>

The app requires a config yaml file to operate and by default it looks in `./config.yaml`, however the path of the config file can be passed by using `-c` or `--config` flag on cli or set in `CONFIG` env variable, for more details about config file, please see `./config.example.yaml`.

<br>

### List of available supported dexes (decentralized exchanges)
- all of the below names are case INSENSITIVE:
`SushiSwapV2`,
`SushiSwapV3`,
`UniswapV2`,
`UniswapV3`,
`Trident`,
`QuickSwap`,
`ApeSwap`,
`PancakeSwapV2`,
`PancakeSwapV3`,
`TraderJoe`,
`Dfyn`,
`Elk`,
`JetSwap`,
`SpookySwapV2`,
`SpookySwapV3`,
`NetSwap`,
`NativeWrap`,
`HoneySwap`,
`UbeSwap`,
`Biswap`,
`CurveSwap`,
`DovishV3`,
`Wagmi`,
`LaserSwap`,
`BaseSwap`,
`AlgebraIntegral`,
`Solarbeam`,
`Swapsicle`,
`VVSStandard`,
`Fraxswap`,
`SwapBlast`,
`BlastDEX`,
`MonoswapV2`,
`MonoswapV3`,
`ThrusterV2`,
`ThrusterV3`,
`DyorV2`,
`HyperBlast`,
`KinetixV2`,
`KinetixV3`,
`Enosys`,
`BlazeSwap`,

<br>

CLI options can be viewed by running:
```bash
node arb-bot -h
```
<br>

Alternatively all variables can be specified in env variables with below keys:
```bash
# path to config yaml file
CONFIG=

# Git branch to track for docker compose
DOCKER_CHANNEL=master

# api key for heyperDx platfomr to send spans to, if not set will send traces to localhost
HYPERDX_API_KEY=""

# trace/spans service name, defaults to "arb-bot" if not set
TRACER_SERVICE_NAME=""
```
If both env variables and CLI argument are set, the CLI arguments will be prioritized and override the env variables.

If you install this app as a dependency for your project you can run it by (All the above arguments apply here as well):

```bash
arb-bot <OPTIONS>
```

<br>

## Running On Github Actions
In order to run this app periodically to clear orders in Github Actions, first you need to fork this repository, then you can modify the `./.github/workflows/take-orders.yaml` file with your desired configuration so the app run periodically. You can set the schedule for the app to run by modifying the cron syntax of the mentioned file and in the last line of the file, you can pass the required/optional arguments for the app to run. All the mentioned CLI arguments can be applied, for wallet private key and rpc url, you can set up Github Secrets.

Please be aware that schediled Github Actions can only be run at minimum once every 5 minutes and even that is not guarateed because it depends on Github resource availability at that time, so it is recommended to run the app on personal/reliable host if there is sensitivity with running on a schedule.

## Developers Guide
First run the [setup](#setup) section and then you can use following commands either from nix shell (`nix develop -c <COMMAND>`) or normally from your commandline.
To run the tests:
```bash
npm test
```
which runs on hardhat forked polygon network.

To lint or lint and fix:
```bash
npm run lint
```
```bash
npm run lint-fix
```
<br>

## Diag Order
Read this [document](./DiagOrder.md) in order to diag what happenes when an order is being tried to find an opportunity to clear against onchain liquidity, you would find the onchain liquidity price at the time the order is being executed against it as well as the what the order evals to, ie its `maxouput` and `ratio`.

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
