require("dotenv").config();
const { assert } = require("chai");
const { clear } = require("../../src");
const { ethers, viem, network } = require("hardhat");
const { arbDeploy } = require("../deploy/arbDeploy");
const { getChainConfig } = require("../../src/utils");
const { Resource } = require("@opentelemetry/resources");
const { trace, context } = require("@opentelemetry/api");
const { orderbookAbi, arbAbis } = require("../../src/abis");
const ERC20Artifact = require("../abis/ERC20Upgradeable.json");
const { ChainId, LiquidityProviders, ChainKey } = require("sushi");
const helpers = require("@nomicfoundation/hardhat-network-helpers");
const { deployOrderBookNPE2 } = require("../deploy/orderbookDeploy");
const { ProcessPairReportStatus } = require("../../src/processOrders");
const { OTLPTraceExporter } = require("@opentelemetry/exporter-trace-otlp-http");
const { SEMRESATTRS_SERVICE_NAME } = require("@opentelemetry/semantic-conventions");
const { USDT, WNATIVE, USDC, ENOSYS_BNZ, ENOSYS_HLN, Token } = require("sushi/currency");
const { BasicTracerProvider, BatchSpanProcessor } = require("@opentelemetry/sdk-trace-base");
const { rainterpreterExpressionDeployerNPE2Deploy } = require("../deploy/expressionDeployer");
const { randomUint256, generateEvaluableConfig, mockSgFromEvent, getEventArgs, encodeMeta } = require("../utils");
const { rainterpreterNPE2Deploy, rainterpreterStoreNPE2Deploy, rainterpreterParserNPE2Deploy } = require("../deploy/rainterpreterDeploy");


const testChains = [
    [
        // chain id
        ChainId.POLYGON,

        // fork rpc url
        process?.env?.TEST_POLYGON_RPC,

        // block number of fork network
        56738134,

        // tokens to test with
        [
            WNATIVE[ChainId.POLYGON],
            USDC[ChainId.POLYGON],
            new Token({
                chainId: ChainId.POLYGON,
                address: "0xd0e9c8f5Fae381459cf07Ec506C1d2896E8b5df6",
                decimals: 18,
                symbol: "IOEN"
            }),
        ],

        // addresses with token balance, in order with specified tokens
        [
            "0xdF906eA18C6537C6379aC83157047F507FB37263",
            "0xe7804c37c13166fF0b37F5aE0BB07A3aEbb6e245",
            "0xdFB5396f06bE50eAA745094ff51d272C292cc218",
        ],

        // liq providers to use for test
        // ideally specify at least one for each univ2 and univ3 protocols
        [
            LiquidityProviders.QuickSwap,
            LiquidityProviders.SushiSwapV3,
            LiquidityProviders.UniswapV3,
        ],

        // deposist amounts per token pair order
        ["1", "100", "100"]
    ],
    [
        ChainId.ARBITRUM,
        process?.env?.TEST_ARBITRUM_RPC,
        226810501,
        [
            WNATIVE[ChainId.ARBITRUM],
            USDT[ChainId.ARBITRUM],
            new Token({
                chainId: ChainId.ARBITRUM,
                address: "0x9cAAe40DCF950aFEA443119e51E821D6FE2437ca",
                decimals: 18,
                symbol: "BJ"
            }),
        ],
        [
            "0xc3e5607cd4ca0d5fe51e09b60ed97a0ae6f874dd",
            "0x8f9c79B9De8b0713dCAC3E535fc5A1A92DB6EA2D",
            "0x9f29801ac82befe279786e5691b0399b637c560c",
        ],
        [
            LiquidityProviders.UniswapV3,
            LiquidityProviders.Camelot,
        ],
        ["1", "100", "100"]
    ],
    [
        ChainId.FLARE,
        process?.env?.TEST_FLARE_RPC,
        25902360,
        [
            WNATIVE[ChainId.FLARE],
            USDT[ChainId.FLARE],
            ENOSYS_HLN,
            ENOSYS_BNZ,
        ],
        [
            "0x2258e7Ad1D8AC70FAB053CF59c027960e94DB7d1",
            "0x980Db8443D19B64B1d4616980ebbD44e7DD30C2E",
            "0x2e574D0802F433E71F7dC91650aB2C23aDeb0D81",
            "0x311613c3339bBd4B91a0b498E43dc63ACC1f2740",
        ],
        [
            LiquidityProviders.Enosys,
            LiquidityProviders.BlazeSwap,
        ],
        ["1", "100", "100", "100"]
    ],
    [
        ChainId.ETHEREUM,
        process?.env?.TEST_ETH_RPC,
        20187810,
        [
            WNATIVE[ChainId.ETHEREUM],
            USDT[ChainId.ETHEREUM],
            new Token({
                chainId: ChainId.ETHEREUM,
                address: "0x922D8563631B03C2c4cf817f4d18f6883AbA0109",
                decimals: 18,
                symbol: "LOCK"
            }),
        ],
        [
            "0x17FD2FeeDabE71f013F5228ed9a52DE58291b15d",
            "0x83B9c290E8D86e686a9Eda6A6DC8FA6d281A5157",
            "0x3776100a4b669Ef0d727a81FC69bF50DE74A976c",
        ],
        [
            LiquidityProviders.SushiSwapV2,
            LiquidityProviders.UniswapV3,
        ],
        ["1", "100", "100"],

        // ob, arb, bot addresses
        "0xf1224A483ad7F1E9aA46A8CE41229F32d7549A74",
        "0x96C3673Ee4B0d5303272193BaB0c565B7ce58D7A",
        "0x22025257BeF969A81eDaC0b343ce82d777931327",
    ],
    [
        ChainId.BASE,
        process?.env?.TEST_BASE_RPC,
        16418720,
        [
            WNATIVE[ChainId.BASE],
            new Token({
                chainId: ChainId.BASE,
                address: "0x99b2B1A2aDB02B38222ADcD057783D7e5D1FCC7D",
                decimals: 18,
                symbol: "WLTH"
            }),
            new Token({
                chainId: ChainId.BASE,
                address: "0x71DDE9436305D2085331AF4737ec6f1fe876Cf9f",
                decimals: 18,
                symbol: "PAID"
            }),
            new Token({
                chainId: ChainId.BASE,
                address: "0x3982E57fF1b193Ca8eb03D16Db268Bd4B40818f8",
                decimals: 18,
                symbol: "BLOOD"
            }),
        ],
        [
            "0x2B8804c2b652f05F7FDD8e0a02F01eE58F01667E",
            "0xD6216fC19DB775Df9774a6E33526131dA7D19a2c",
            "0x3ea31919Ef9b3e72Cc25657b604DB1ACDb1DdB4b",
            "0xf6D07A291443F31B129Ca7e2b46C6F882f0FAa5b",
        ],
        [
            LiquidityProviders.UniswapV3,
            LiquidityProviders.UniswapV2,
            LiquidityProviders.BaseSwap,
        ],
        ["1", "10000", "10000", "10000"]
        // "0x2AeE87D75CD000583DAEC7A28db103B1c0c18b76",
        // "0x199b22ce0c9fD88476cCaA2d2aB253Af38BAE3Ae",
        // "0x9344d29CCB9f81B8E273eE84574468C1A404EaDF",
    ],
    [
        ChainId.BSC,
        process?.env?.TEST_BSC_RPC,
        39996830,
        [
            WNATIVE[ChainId.BSC],
            new Token({
                chainId: ChainId.BSC,
                address: "0x8f0FB159380176D324542b3a7933F0C2Fd0c2bbf",
                decimals: 7,
                symbol: "TFT"
            }),
            new Token({
                chainId: ChainId.BSC,
                address: "0xAD86d0E9764ba90DDD68747D64BFfBd79879a238",
                decimals: 18,
                symbol: "PAID"
            }),
        ],
        [
            "0x59d779BED4dB1E734D3fDa3172d45bc3063eCD69",
            "0x66803c0B34B1baCCb68fF515f76cd63ba48a2039",
            "0x604b2B06ad0D5a2f8ef4383626f6dD37E780D090",
        ],
        [
            LiquidityProviders.PancakeSwapV2,
            LiquidityProviders.PancakeSwapV3
        ],
        ["1", "10000", "10000"]
    ],
];

// run tests on each network with provided data
for (let i = 0; i < testChains.length; i++) {
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
    ] = testChains[i];

    // if rpc is not defined for a network go to next test
    if (!rpc) continue;

    describe(`Rain Arb Bot E2E Tests on "${ChainKey[chainId]}" Network`, async function () {
        // get config for the chain
        const config = getChainConfig(chainId);

        // get available route processor versions for the chain
        const rpVersions = Object.keys(config.routeProcessors).filter(v => v === "4");

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
                const orderOwners = [];
                for (let i = 0; i < tokens.length; i++) {
                    tokens[i].contract = await ethers.getContractAt(
                        ERC20Artifact.abi,
                        tokens[i].address
                    );
                    tokens[i].vaultId = ethers.BigNumber.from(randomUint256());
                    orderOwners.push(await ethers.getImpersonatedSigner(addressesWithBalance[i]));
                    await network.provider.send("hardhat_setBalance", [addressesWithBalance[i], "0x4563918244F40000"]);
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
                const sgOrders = [];
                for (let i = 1; i < tokens.length; i++) {
                    const depositConfigStruct = {
                        token: tokens[i].address,
                        vaultId: tokens[i].vaultId,
                        amount: (deposits[i] ?? "100") + "0".repeat(tokens[i].decimals),
                    };
                    await tokens[i]
                        .contract
                        .connect(orderOwners[i])
                        .approve(orderbook.address, depositConfigStruct.amount);
                    await orderbook
                        .connect(orderOwners[i])
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
                        .connect(orderOwners[i])
                        .addOrder(txData);
                    sgOrders.push(await mockSgFromEvent(
                        await getEventArgs(
                            tx,
                            "AddOrder",
                            orderbook
                        ),
                        orderbook,
                        tokens.map(v => ({
                            ...v.contract,
                            knownSymbol: v.symbol
                        }))
                    ));
                }

                // run the clearing process
                config.isTest = true;
                config.rpc = rpc;
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
                const reports = await clear(config, sgOrders, tracer, ctx);

                // should have cleared correct number of orders
                assert.ok(reports.length == tokens.length - 1, "failed to clear all given orders");

                // bot profits in weth
                let profit = ethers.constants.Zero;

                // validate each cleared order
                for (let i = 0; i < reports.length; i++) {
                    const tokenPair = `${tokens[0].symbol}/${tokens[i + 1].symbol}`;
                    assert.equal(reports[i].tokenPair, tokenPair);
                    assert.equal(reports[i].clearedOrders.length, 1);
                    assert.equal(reports[i].status, ProcessPairReportStatus.FoundOpportunity);
                    assert.equal(
                        reports[i].clearedAmount,
                        (deposits[i + 1] ?? "100") + "0".repeat(tokens[i + 1].decimals)
                    );
                    assert.equal(
                        (await orderbook.vaultBalance(
                            orderOwners[i + 1].address,
                            tokens[i + 1].address,
                            tokens[i + 1].vaultId
                        )).toString(),
                        "0"
                    );
                    assert.equal(
                        (await orderbook.vaultBalance(
                            orderOwners[0].address,
                            tokens[0].address,
                            tokens[0].vaultId
                        )).toString(),
                        "0"
                    );
                    assert.ok(
                        (await tokens[i + 1].contract.connect(bot).balanceOf(bot.address))
                            .eq(originalBotTokenBalances[i + 1]),
                        `bot wrongfully recieved bounty tokens for order with ${tokenPair}`
                    );
                    profit = profit.add(reports[i].income);
                }

                assert.ok(
                    (await tokens[0].contract.connect(bot).balanceOf(bot.address))
                        .eq(originalBotTokenBalances[0].add(profit)),
                    "bot recieved bounty isn't equal to expected amount"
                );

                testSpan.end();
            });
        }
    });
}
