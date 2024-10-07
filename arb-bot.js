#!/usr/bin/env node

/* eslint-disable no-console */
const { main } = require("./src/cli");

main(process.argv)
    .then(() => {
        console.log(
            "\x1b[32m%s\x1b[0m",
            "Rain orderbook arbitrage clearing process finished successfully!",
        );
        process.exit(0);
    })
    .catch((v) => {
        console.log("\x1b[31m%s\x1b[0m", "An error occured during execution: ");
        console.log(v);
        process.exit(1);
    });
