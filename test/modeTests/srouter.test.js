require("dotenv").config();
const { assert } = require("chai");
const { clear } = require("../../src");
const { ethers } = require("hardhat");
const { arbDeploy } = require("../deploy/arbDeploy");
const ERC20Artifact = require("../abis/ERC20Upgradeable.json");
const helpers = require("@nomicfoundation/hardhat-network-helpers");
const { deployOrderBookNPE2 } = require("../deploy/orderbookDeploy");
const { randomUint256, prepareOrders, generateEvaluableConfig } = require("../utils");
const { rainterpreterExpressionDeployerNPE2Deploy } = require("../deploy/expressionDeployer");
const { rainterpreterNPE2Deploy, rainterpreterStoreNPE2Deploy, rainterpreterParserNPE2Deploy } = require("../deploy/rainterpreterDeploy");
const { Resource } = require("@opentelemetry/resources");
const { SEMRESATTRS_SERVICE_NAME } = require("@opentelemetry/semantic-conventions");
const { BasicTracerProvider, BatchSpanProcessor } = require("@opentelemetry/sdk-trace-base");
const { trace, context } = require("@opentelemetry/api");
const { OTLPTraceExporter } = require("@opentelemetry/exporter-trace-otlp-http");
const { USDT, WNATIVE, USDC, DAI, ENOSYS_BNZ, USD_PLUS, ENOSYS_HLN, FRAX, axlUSDC } = require("sushi/currency");
const { ChainId, LiquidityProviders, ChainKey } = require("sushi");
const { getChainConfig } = require("../../src/utils");

const testChains = [
    [
        ChainId.POLYGON,
        ChainKey[ChainId.POLYGON],
        process?.env?.TEST_POLYGON_RPC ?? "https://rpc.ankr.com/polygon",
        56738134,
        [
            WNATIVE[ChainId.POLYGON],
            USDT[ChainId.POLYGON],
            USDC[ChainId.POLYGON],
            DAI[ChainId.POLYGON]
        ],
        [
            "0xdF906eA18C6537C6379aC83157047F507FB37263",
            "0xF977814e90dA44bFA03b6295A0616a897441aceC",
            "0xe7804c37c13166fF0b37F5aE0BB07A3aEbb6e245",
            "0x4aac95EBE2eA6038982566741d1860556e265F8B",
        ],
        [
            LiquidityProviders.SushiSwapV2
        ]
    ],
    [
        ChainId.FLARE,
        ChainKey[ChainId.FLARE],
        process?.env?.TEST_FLARE_RPC ?? "https://rpc.ankr.com/flare",
        23676999,
        [
            WNATIVE[ChainId.FLARE],
            USDT[ChainId.FLARE],
            ENOSYS_HLN,
            ENOSYS_BNZ
        ],
        [
            "0x2258e7Ad1D8AC70FAB053CF59c027960e94DB7d1",
            "0x09F5e7452d72b4A4e51b77DF1Ec8391e46e5F864",
            "0x2e574D0802F433E71F7dC91650aB2C23aDeb0D81",
            "0x311613c3339bBd4B91a0b498E43dc63ACC1f2740",
        ],
        [
            LiquidityProviders.Enosys
        ]
    ],
    [
        ChainId.ETHEREUM,
        ChainKey[ChainId.ETHEREUM],
        process?.env?.TEST_ETH_RPC ?? "https://rpc.ankr.com/eth",
        19829125,
        [
            WNATIVE[ChainId.ETHEREUM],
            USDT[ChainId.ETHEREUM],
            USDC[ChainId.ETHEREUM],
            DAI[ChainId.ETHEREUM]
        ],
        [
            "0x17FD2FeeDabE71f013F5228ed9a52DE58291b15d",
            "0x83B9c290E8D86e686a9Eda6A6DC8FA6d281A5157",
            "0x51eDF02152EBfb338e03E30d65C15fBf06cc9ECC",
            "0x837c20D568Dfcd35E74E5CC0B8030f9Cebe10A28",
        ],
        [
            LiquidityProviders.SushiSwapV2
        ]
    ],
    [
        ChainId.ARBITRUM,
        ChainKey[ChainId.ARBITRUM],
        process?.env?.TEST_ARBITRUM_RPC ?? "https://rpc.ankr.com/arbitrum",
        209250803,
        [
            WNATIVE[ChainId.ARBITRUM],
            USDT[ChainId.ARBITRUM],
            USDC[ChainId.ARBITRUM],
            DAI[ChainId.ARBITRUM]
        ],
        [
            "0xc3e5607cd4ca0d5fe51e09b60ed97a0ae6f874dd",
            "0x8f9c79B9De8b0713dCAC3E535fc5A1A92DB6EA2D",
            "0x5a52e96bacdabb82fd05763e25335261b270efcb",
            "0xc2995bbd284953e8ba0b01efe64535ac55cfcd9d"
        ],
        [
            LiquidityProviders.SushiSwapV2
        ]
    ],
    [
        ChainId.BASE,
        ChainKey[ChainId.BASE],
        process?.env?.TEST_BASE_RPC ?? "https://rpc.ankr.com/base",
        14207369,
        [
            axlUSDC[ChainId.BASE],
            USDC[ChainId.BASE],
            DAI[ChainId.BASE],
            USD_PLUS[ChainId.BASE],
        ],
        [
            "0xe743a49f04f2f77eb2d3b753ae3ad599de8cea84",
            "0x9b4Fc9E22b46487F0810eF5dFa230b9f139E5179",
            "0xf89BCB2Cc4F790Ba5b2fa4A1FBCb33e178459E65",
            "0x898137400867603E6D713CBD40881dd0c79E47cB",
        ],
        [
            LiquidityProviders.UniswapV3,
            LiquidityProviders.BaseSwap,
        ]
    ],
    [
        ChainId.BSC,
        ChainKey[ChainId.BSC],
        process?.env?.TEST_BSC_RPC ?? "https://rpc.ankr.com/bsc",
        38553419,
        [
            WNATIVE[ChainId.BSC],
            USDC[ChainId.BSC],
            DAI[ChainId.BSC],
            FRAX[ChainId.BSC]
        ],
        [
            "0x59d779BED4dB1E734D3fDa3172d45bc3063eCD69",
            "0xD3a22590f8243f8E83Ac230D1842C9Af0404C4A1",
            "0x737bc92643287e5b598eC4F5809bD25643c330f6",
            "0x8b666FAD7B4209B080Cb5f02159A60c3Bf346ebA"
        ],
        [
            LiquidityProviders.SushiSwapV2,
            LiquidityProviders.PancakeSwapV2
        ]
    ],
];

// run tests on each network with provided data
for (let i = 0; i < testChains.length; i++) {
    const [
        chainId,
        chainName,
        rpc,
        blockNumber,
        tokens,
        addressesWithBalance,
        liquidityProviders,
    ] = testChains[i];

    describe(`Rain Arb Bot Tests on "${chainName}" Network`, async function () {
        let interpreter,
            store,
            expressionDeployer,
            orderbook,
            arb,
            Token2,
            Token2Decimals,
            Token1,
            Token1Decimals,
            Token4,
            Token4Decimals,
            Token3,
            Token3Decimals,
            bot,
            owners,
            config;

        const exporter = new OTLPTraceExporter();
        const provider = new BasicTracerProvider({
            resource: new Resource({
                [SEMRESATTRS_SERVICE_NAME]: "arb-bot-test"
            }),
        });
        provider.addSpanProcessor(new BatchSpanProcessor(exporter));
        provider.register();
        const tracer = provider.getTracer("arb-bot-tracer");

        beforeEach(async() => {
            // reset network before each test
            await helpers.reset(
                rpc,
                blockNumber
            );

            [bot, ...owners] = await ethers.getSigners();
            config = getChainConfig(chainId);
            // deploy contracts
            interpreter = await rainterpreterNPE2Deploy();
            store = await rainterpreterStoreNPE2Deploy();
            parser = await rainterpreterParserNPE2Deploy();
            expressionDeployer = await rainterpreterExpressionDeployerNPE2Deploy(
                interpreter,
                store,
                parser
            );
            orderbook = await deployOrderBookNPE2(expressionDeployer);
            arb = await arbDeploy(
                expressionDeployer,
                orderbook.address,
                generateEvaluableConfig(
                    expressionDeployer,
                    {
                        constants: [],
                        bytecode: "0x01000000000000"
                    }
                ),
                config.routeProcessors["3"],
            );

            // update config with new addresses
            config.arbAddress = arb.address;
            config.orderbookAddress = orderbook.address;

            // get token contract instances
            Token1 = await ethers.getContractAt(
                ERC20Artifact.abi,
                tokens[0].address
            );
            Token1Decimals = tokens[0].decimals;
            Token2 = await ethers.getContractAt(
                ERC20Artifact.abi,
                tokens[1].address
            );
            Token2Decimals = tokens[1].decimals;
            Token3 = await ethers.getContractAt(
                ERC20Artifact.abi,
                tokens[2].address
            );
            Token3Decimals = tokens[2].decimals;
            Token4 = await ethers.getContractAt(
                ERC20Artifact.abi,
                tokens[3].address
            );
            Token4Decimals = tokens[3].decimals;

            // impersonate addresses with large token balances to fund the owners 1 2 3
            // accounts with 1000 tokens each used for topping up the order vaults
            const Token1Holder = await ethers.getImpersonatedSigner(addressesWithBalance[0]);
            const Token2Holder = await ethers.getImpersonatedSigner(addressesWithBalance[1]);
            const Token3Holder = await ethers.getImpersonatedSigner(addressesWithBalance[2]);
            const Token4Holder = await ethers.getImpersonatedSigner(addressesWithBalance[3]);
            await bot.sendTransaction({
                value: ethers.utils.parseEther("5.0"),
                to: Token1Holder.address
            });
            await bot.sendTransaction({
                value: ethers.utils.parseEther("5.0"),
                to: Token2Holder.address
            });
            await bot.sendTransaction({
                value: ethers.utils.parseEther("5.0"),
                to: Token3Holder.address
            });
            await bot.sendTransaction({
                value: ethers.utils.parseEther("5.0"),
                to: Token4Holder.address
            });
            for (let i = 0; i < 3; i++) {
                await Token1.connect(Token1Holder).transfer(owners[i].address, "110" + "0".repeat(Token1Decimals));
                await Token2.connect(Token2Holder).transfer(owners[i].address, "110" + "0".repeat(Token2Decimals));
                await Token3.connect(Token3Holder).transfer(owners[i].address, "110" + "0".repeat(Token3Decimals));
                await Token4.connect(Token4Holder).transfer(owners[i].address, "110" + "0".repeat(Token4Decimals));
            }
        });

        it("should clear orders successfully", async function () {
            const testSpan = tracer.startSpan("test-srouter-int-v2");
            const ctx = trace.setSpan(context.active(), testSpan);

            // set up vault ids
            const USDC_vaultId = ethers.BigNumber.from(randomUint256());
            const USDT_vaultId = ethers.BigNumber.from(randomUint256());
            const DAI_vaultId = ethers.BigNumber.from(randomUint256());
            const WNATIVE_vaultid = ethers.BigNumber.from(randomUint256());

            const sgOrders = await prepareOrders(
                owners,
                [Token1, Token2, Token4, Token3],
                [Token1Decimals, Token2Decimals, Token4Decimals, Token3Decimals],
                [WNATIVE_vaultid, USDT_vaultId, DAI_vaultId, USDC_vaultId],
                orderbook,
                expressionDeployer
            );

            // run the clearing process
            config.rpc = rpc;
            config.shuffle = false;
            config.signer = bot;
            config.hops = 2;
            config.bundle = true;
            config.retries = 1;
            config.lps = liquidityProviders;
            const reports = await clear(config, sgOrders, undefined, tracer, ctx);

            // should have cleared 2 toke pairs bundled orders
            assert.ok(reports.length == 2);

            // validate first cleared token pair orders
            assert.equal(reports[0].tokenPair, `${tokens[1].symbol}/${tokens[0].symbol}`);
            assert.equal(reports[0].clearedAmount, "200" + "0".repeat(tokens[0].decimals));
            assert.equal(reports[0].clearedOrders.length, 2);

            // check vault balances for orders in cleared token pair USDT/USDC
            assert.equal(
                (await orderbook.vaultBalance(
                    owners[0].address,
                    Token1.address,
                    USDC_vaultId
                )).toString(),
                "0"
            );
            assert.equal(
                (await orderbook.vaultBalance(
                    owners[0].address,
                    Token2.address,
                    USDT_vaultId
                )).toString(),
                "100" + "0".repeat(tokens[1].decimals)
            );
            assert.equal(
                (await orderbook.vaultBalance(
                    owners[2].address,
                    Token1.address,
                    WNATIVE_vaultid
                )).toString(),
                "0"
            );
            assert.equal(
                (await orderbook.vaultBalance(
                    owners[2].address,
                    Token2.address,
                    USDT_vaultId
                )).toString(),
                "100" + "0".repeat(tokens[1].decimals)
            );

            // validate second cleared token pair orders
            assert.equal(reports[1].tokenPair, `${tokens[3].symbol}/${tokens[0].symbol}`);
            assert.equal(reports[1].clearedAmount, "100" + "0".repeat(tokens[0].decimals));
            // assert.equal(reports[1].clearedOrders.length, 1);

            // check vault balances for orders in cleared token pair FRAX/USDC
            assert.equal(
                (await orderbook.vaultBalance(
                    owners[1].address,
                    Token1.address,
                    WNATIVE_vaultid
                )).toString(),
                "0"
            );
            assert.equal(
                (await orderbook.vaultBalance(
                    owners[1].address,
                    Token4.address,
                    DAI_vaultId
                )).toString(),
                "100" + "0".repeat(tokens[3].decimals)
            );

            // bot should have received the bounty for cleared orders input token
            assert.ok(
                (await Token2.connect(bot).balanceOf(bot.address)).gt("0")
            );
            assert.ok(
                (await Token4.connect(bot).balanceOf(bot.address)).gt("0")
            );

            testSpan.end();
        });
    });
}