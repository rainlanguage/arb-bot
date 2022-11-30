#!/usr/bin/env node

// const fs = require('fs');
// const path = require('path');
// const { program } = require('commander');
const { execSync } = require('child_process');
const { argv } = require('process');
require('dotenv').config();

/**
 * Execute Child Processes
 * 
 * @param {string} cmd Command to execute
 * @returns The command to ran as shell
 */
const exec = (cmd) => {
    try {
        return execSync(cmd, { stdio: 'inherit' });
    } catch (e) {
        throw new Error(`Failed to run command \`${cmd}\``);
    }
};

const main = async() => {
    const args = argv.slice(2, 8)
    if (args.indexOf('--private-key') > -1) {
        process.env.BOT_WALLET_PRIVATEKEY = args[args.indexOf('--private-key') + 1]
    }
    else if (args.indexOf('-p') > -1) {
        process.env.BOT_WALLET_PRIVATEKEY = args[args.indexOf('-p') + 1]
    }
    if (args.indexOf('--rpc-url') > -1) {
        process.env.RPC_URL = args[args.indexOf('--rpc') + 1]
    }
    else if (args.indexOf('-r') > -1) {
        process.env.RPC_URL = args[args.indexOf('-r') + 1]
    }
    else {
        if (args.indexOf('--network') > -1) {
            process.env.NETWORK = args[args.indexOf('--network') + 1]
        }
        else if (args.indexOf('-n') > -1) {
            process.env.NETWORK = args[args.indexOf('-n') + 1]
        }
    }
    exec('echo starting the Rain Orderbook Matchmaker Arb bot...')
    exec('node ./src/matchmaker.js')
}

main().then(
    () => {
        const exit = process.exit;
        console.log('matchmaker bot has stopped')
        exit(0);
    }
).catch(
    (error) => {
        console.error(error);
        const exit = process.exit;
        exit(1);
    }
);
