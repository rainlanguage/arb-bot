require("dotenv").config();
const { assert } = require("chai");
const testData = require("./data");
const { ChainKey } = require("sushi");
const { clear } = require("../../src");
const { arbAbis } = require("../../src/abis");
const { ethers, viem, network } = require("hardhat");
const { arbDeploy } = require("../deploy/arbDeploy");
const { getChainConfig } = require("../../src/utils");
const { Resource } = require("@opentelemetry/resources");
const { trace, context } = require("@opentelemetry/api");
const ERC20Artifact = require("../abis/ERC20Upgradeable.json");
const { abi: orderbookAbi } = require("../abis/OrderBook.json");
const helpers = require("@nomicfoundation/hardhat-network-helpers");
const { deployOrderBookNPE2 } = require("../deploy/orderbookDeploy");
const { ProcessPairReportStatus } = require("../../src/processOrders");
const { OTLPTraceExporter } = require("@opentelemetry/exporter-trace-otlp-http");
const { SEMRESATTRS_SERVICE_NAME } = require("@opentelemetry/semantic-conventions");
const { BasicTracerProvider, BatchSpanProcessor } = require("@opentelemetry/sdk-trace-base");
const { rainterpreterExpressionDeployerNPE2Deploy } = require("../deploy/expressionDeployer");
const { randomUint256, generateEvaluableConfig, mockSgFromEvent, getEventArgs, encodeMeta } = require("../utils");
const { rainterpreterNPE2Deploy, rainterpreterStoreNPE2Deploy, rainterpreterParserNPE2Deploy } = require("../deploy/rainterpreterDeploy");

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
                const viemClient = await viem.getPublicClient();
                const testSpan = tracer.startSpan("test-clearing");
                const ctx = trace.setSpan(context.active(), testSpan);

                // reset network before each test
                await helpers.reset(rpc, blockNumber);

                // get bot signer
                const bot = botAddress
                    ? await ethers.getImpersonatedSigner(botAddress)
                    : await ethers.getImpersonatedSigner("0x22025257BeF969A81eDaC0b343ce82d777931327");
                await network.provider.send("hardhat_setBalance", [bot.address, "0x4563918244F40000"]);

                // deploy contracts
                const interpreter = await rainterpreterNPE2Deploy();
                const store = await rainterpreterStoreNPE2Deploy();
                const parser = await rainterpreterParserNPE2Deploy();
                const expressionDeployer = await rainterpreterExpressionDeployerNPE2Deploy(
                    interpreter,
                    store,
                    parser
                );
                const orderbook = !orderbookAddress
                    ? await deployOrderBookNPE2(expressionDeployer)
                    : await ethers.getContractAt(orderbookAbi, orderbookAddress);

                const arb = !arbAddress
                    ? await arbDeploy(
                        expressionDeployer,
                        orderbook.address,
                        generateEvaluableConfig(
                            expressionDeployer,
                            {
                                constants: [],
                                bytecode: "0x01000000000000"
                            }
                        ),
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
                const EvaluableConfig = generateEvaluableConfig(
                    expressionDeployer,
                    {
                        constants: [ethers.constants.MaxUint256.toHexString(), "0"],
                        bytecode: "0x020000000c02020002010000000100000100000000"
                    }
                );

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
                        .deposit(
                            depositConfigStruct.token,
                            depositConfigStruct.vaultId,
                            depositConfigStruct.amount
                        );
                    const txData = {
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
                        evaluableConfig: EvaluableConfig,
                        meta: encodeMeta("some_order"),
                    };
                    const tx = await orderbook
                        .connect(owners[i])
                        .addOrder(txData);
                    orders.push(await mockSgFromEvent(
                        await getEventArgs(tx, "AddOrder", orderbook),
                        orderbook,
                        tokens.map(v => ({ ...v.contract, knownSymbol: v.symbol }))
                    ));
                }

                // run the clearing process
                config.isTest = true;
                config.rpc = [rpc];
                config.shuffle = false;
                config.signer = bot;
                config.hops = 2;
                config.bundle = true;
                config.retries = 1;
                config.lps = liquidityProviders;
                config.rpVersion = rpVersion;
                config.arbAddress = arb.address;
                config.orderbookAddress = orderbook.address;
                config.testViemClient = viemClient;
                config.testBlockNumber = BigInt(blockNumber);
                config.gasCoveragePercentage = "1";
                const reports = await clear(config, orders, tracer, ctx);

                // should have cleared correct number of orders
                assert.ok(
                    reports.length == tokens.length - 1,
                    "Failed to clear all given orders"
                );

                // validate each cleared order
                let profit = ethers.constants.Zero;
                for (let i = 0; i < reports.length; i++) {
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
                    assert.equal(reports[i].clearedOrders.length, 1);
                    assert.equal(reports[i].status, ProcessPairReportStatus.FoundOpportunity);

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

                    // collect all bot's income (bounty)
                    profit = profit.add(reports[i].income);
                }

                // all bounties (+ old balance) should be equal to current bot's balance
                assert.ok(
                    originalBotTokenBalances[0].add(profit).eq(
                        await tokens[0].contract.connect(bot).balanceOf(bot.address)
                    ),
                    "Unexpected bot bounty"
                );

                testSpan.end();
            });
        }
    });
}
