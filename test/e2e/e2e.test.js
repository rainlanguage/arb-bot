require("dotenv").config();
const { assert } = require("chai");
const testData = require("./data");
const { ChainKey } = require("sushi");
const { clear } = require("../../src");
const { arbAbis } = require("../../src/abis");
const { ethers, viem, network } = require("hardhat");
const { Resource } = require("@opentelemetry/resources");
const { trace, context } = require("@opentelemetry/api");
const ERC20Artifact = require("../abis/ERC20Upgradeable.json");
const { abi: orderbookAbi } = require("../abis/OrderBook.json");
const helpers = require("@nomicfoundation/hardhat-network-helpers");
const { ProcessPairReportStatus } = require("../../src/processOrders");
const { getChainConfig, getDataFetcher } = require("../../src/config");
const { OTLPTraceExporter } = require("@opentelemetry/exporter-trace-otlp-http");
const { SEMRESATTRS_SERVICE_NAME } = require("@opentelemetry/semantic-conventions");
const { BasicTracerProvider, BatchSpanProcessor } = require("@opentelemetry/sdk-trace-base");
const {
    arbDeploy,
    encodeMeta,
    getEventArgs,
    randomUint256,
    mockSgFromEvent,
    deployOrderBookNPE2,
    rainterpreterNPE2Deploy,
    rainterpreterStoreNPE2Deploy
} = require("../utils");


// run tests on each network in the provided data
for (let i = 0; i < testData.length; i++) {
    const [
        chainId,
        rpc,
        blockNumber,
        tokens,
        addressesWithBalance,
        liquidityProviders,
        deposits,
        orderbookAddress,
        arbAddress,
        botAddress,
    ] = testData[i];

    // if rpc is not defined for a network go to next test
    if (!rpc) continue;

    describe(`Rain Arb Bot E2E Tests on "${ChainKey[chainId]}" Network`, async function () {
        // get config for the chain
        const config = getChainConfig(chainId);

        // get available route processor versions for the chain (only RP4)
        const rpVersions = Object.keys(config.routeProcessors).filter(v => v === "4");
        if (rpVersions.length === 0) assert.fail(
            `Found no known RP4 contract address on ${ChainKey[chainId]} chain`
        );

        const exporter = new OTLPTraceExporter();
        const provider = new BasicTracerProvider({
            resource: new Resource({
                [SEMRESATTRS_SERVICE_NAME]: "arb-bot-test"
            }),
        });
        provider.addSpanProcessor(new BatchSpanProcessor(exporter));
        provider.register();
        const tracer = provider.getTracer("arb-bot-tracer");

        // run tests on each rp version
        for (let j = 0; j < rpVersions.length; j++) {
            const rpVersion = rpVersions[j];

            it(`should clear orders successfully using route processor v${rpVersion}`, async function () {
                config.rpc = [rpc];
                const viemClient = await viem.getPublicClient();
                const dataFetcher = getDataFetcher(config, liquidityProviders, false);
                const testSpan = tracer.startSpan("test-clearing");
                const ctx = trace.setSpan(context.active(), testSpan);

                // reset network before each test
                await helpers.reset(rpc, blockNumber);

                // get bot signer
                const bot = botAddress
                    ? await ethers.getImpersonatedSigner(botAddress)
                    : await ethers.getImpersonatedSigner("0x22025257BeF969A81eDaC0b343ce82d777931327");
                await network.provider.send("hardhat_setBalance", [bot.address, "0x4563918244F40000"]);
                bot.BALANCE = ethers.BigNumber.from("0x4563918244F40000");
                bot.BOUNTY = [];

                // deploy contracts
                const interpreter = await rainterpreterNPE2Deploy();
                const store = await rainterpreterStoreNPE2Deploy();
                const orderbook = !orderbookAddress
                    ? await deployOrderBookNPE2()
                    : await ethers.getContractAt(orderbookAbi, orderbookAddress);

                const arb = !arbAddress
                    ? await arbDeploy(
                        orderbook.address,
                        config.routeProcessors[rpVersion],
                    )
                    : await ethers.getContractAt(arbAbis, arbAddress);

                // set up tokens contracts and impersonate owners
                const owners = [];
                for (let i = 0; i < tokens.length; i++) {
                    tokens[i].contract = await ethers.getContractAt(
                        ERC20Artifact.abi,
                        tokens[i].address
                    );
                    tokens[i].vaultId = ethers.BigNumber.from(randomUint256());
                    tokens[i].depositAmount = ethers.BigNumber.from(
                        (deposits[i] ?? "100") + "0".repeat(tokens[i].decimals)
                    );
                    owners.push(await ethers.getImpersonatedSigner(addressesWithBalance[i]));
                    await network.provider.send(
                        "hardhat_setBalance",
                        [addressesWithBalance[i], "0x4563918244F40000"]
                    );
                }

                // bot original token balances
                const originalBotTokenBalances = [];
                for (const t of tokens) {
                    originalBotTokenBalances.push(await t.contract.balanceOf(bot.address));
                }

                // dposit and add orders for each owner and return
                // the deployed orders in format of a sg query.
                // all orders have WETH as output and other specified
                // tokens as input
                const orders = [];
                for (let i = 1; i < tokens.length; i++) {
                    const depositConfigStruct = {
                        token: tokens[i].address,
                        vaultId: tokens[i].vaultId,
                        amount: tokens[i].depositAmount.toString()
                    };
                    await tokens[i]
                        .contract
                        .connect(owners[i])
                        .approve(orderbook.address, depositConfigStruct.amount);
                    await orderbook
                        .connect(owners[i])
                        .deposit2(
                            depositConfigStruct.token,
                            depositConfigStruct.vaultId,
                            depositConfigStruct.amount,
                            []
                        );

                    // prebuild bytecode: "_ _: 0 max; :;"
                    const ratio = "0".repeat(64); // 0
                    const maxOutput = "f".repeat(64); // max
                    const bytecode = `0x0000000000000000000000000000000000000000000000000000000000000002${maxOutput}${ratio}0000000000000000000000000000000000000000000000000000000000000015020000000c02020002011000000110000100000000`;
                    const addOrderConfig = {
                        evaluable: {
                            interpreter: interpreter.address,
                            store: store.address,
                            bytecode,
                        },
                        nonce: "0x" + "0".repeat(63) + "1",
                        secret: "0x" + "0".repeat(63) + "1",
                        validInputs: [{
                            token: tokens[0].address,
                            decimals: tokens[0].decimals,
                            vaultId: tokens[0].vaultId
                        }],
                        validOutputs: [{
                            token: tokens[i].address,
                            decimals: tokens[i].decimals,
                            vaultId: tokens[i].vaultId
                        }],
                        meta: encodeMeta("some_order"),
                    };
                    const tx = await orderbook
                        .connect(owners[i])
                        .addOrder2(addOrderConfig, []);
                    orders.push(await mockSgFromEvent(
                        await getEventArgs(tx, "AddOrderV2", orderbook),
                        orderbook,
                        tokens.map(v => ({ ...v.contract, knownSymbol: v.symbol }))
                    ));
                }

                // run the clearing process
                config.isTest = true;
                config.shuffle = false;
                config.signer = bot;
                config.hops = 2;
                config.bundle = true;
                config.retries = 1;
                config.lps = liquidityProviders;
                config.rpVersion = rpVersion;
                config.arbAddress = arb.address;
                config.orderbookAddress = orderbook.address;
                config.testBlockNumber = BigInt(blockNumber);
                config.gasCoveragePercentage = "1";
                config.viemClient = viemClient;
                config.dataFetcher = dataFetcher;
                config.accounts = [];
                config.mainAccount = bot;
                config.mockedQuotes = tokens.slice(1).map(v => ({
                    maxOutput: v.depositAmount,
                    ratio: ethers.constants.Zero
                }));
                const { reports } = await clear(config, orders, tracer, ctx);

                // should have cleared correct number of orders
                assert.ok(
                    reports.length == tokens.length - 1,
                    "Failed to clear all given orders"
                );

                // validate each cleared order
                let profit = ethers.constants.Zero;
                let gasSpent = ethers.constants.Zero;
                for (let i = 0; i < reports.length; i++) {
                    assert.equal(reports[i].status, ProcessPairReportStatus.FoundOpportunity);
                    assert.equal(reports[i].clearedOrders.length, 1);

                    const pair = `${tokens[0].symbol}/${tokens[i + 1].symbol}`;
                    const clearedAmount = ethers.BigNumber.from(reports[i].clearedAmount);
                    const outputVault = await orderbook.vaultBalance(
                        owners[i + 1].address,
                        tokens[i + 1].address,
                        tokens[i + 1].vaultId
                    );
                    const inputVault = await orderbook.vaultBalance(
                        owners[0].address,
                        tokens[0].address,
                        tokens[0].vaultId
                    );
                    const botTokenBalance = await tokens[i + 1].contract
                        .connect(bot)
                        .balanceOf(bot.address);

                    assert.equal(reports[i].tokenPair, pair);

                    // should have cleared equal to vault balance or lower
                    assert.ok(
                        tokens[i + 1].depositAmount.gte(clearedAmount),
                        `Did not clear expected amount for: ${pair}`
                    );
                    assert.ok(
                        outputVault.eq(tokens[i + 1].depositAmount.sub(clearedAmount)),
                        `Unexpected current output vault balance: ${pair}`
                    );
                    assert.ok(
                        inputVault.eq(0),
                        `Unexpected current input vault balance: ${pair}`
                    );
                    assert.ok(
                        originalBotTokenBalances[i + 1].eq(botTokenBalance),
                        `Unexpected current bot ${tokens[i + 1].symbol} balance`
                    );

                    // collect all bot's income (bounty) and gas cost
                    profit = profit.add(reports[i].income);
                    gasSpent = gasSpent.add(ethers.utils.parseUnits(reports[i].actualGasCost));
                }

                // all bounties (+ old balance) should be equal to current bot's balance
                assert.ok(
                    originalBotTokenBalances[0].add(profit).eq(
                        await tokens[0].contract.connect(bot).balanceOf(bot.address)
                    ),
                    "Unexpected bot bounty"
                );

                // bot's gas token balance and bounty tokens should be correct
                assert.deepEqual(bot.BOUNTY, [tokens[0].address.toLowerCase()]);
                assert.equal(bot.BALANCE.toString(), (await bot.getBalance()).toString());
                assert.equal(gasSpent.toString(), ethers.BigNumber.from("0x4563918244F40000").sub(bot.BALANCE).toString());

                testSpan.end();
            });
        }
    });
}
