const { assert } = require("chai");
const { execSync } = require("child_process");

describe.only("Test building from nix and running bin from node", async function () {
    it("should build and run as expected", async function () {
        // init the submod
        execSync("git submodule update --init --recursive");
        // build dotrain cli
        execSync("cd lib/dotrain && nix develop -c cargo build --features cli -r");
        // run dotrain bin help command
        const result = execSync("cd lib/dotrain && target/release/dotrain --help");

        const expectedResult = `Dotrain cli

Usage: dotrain <COMMAND>

Commands:
  compose     Compose a .rain file to rainlang
  rainconfig  Prints 'rainconfig' info and description
  help        Print this message or the help of the given subcommand(s)

Options:
  -h, --help     Print help
  -V, --version  Print version
`;
        assert.equal("" + result, expectedResult);
    });
});