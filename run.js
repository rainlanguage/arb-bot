#!/usr/bin/env node

// const fs = require('fs');
// const path = require('path');
// const { program } = require('commander');
const { execSync } = require('child_process');
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
    exec('echo starting the matchmaker arb bot...')
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
