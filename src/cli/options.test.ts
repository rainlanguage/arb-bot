import { getCliOptions } from "./options";
import { describe, it, assert } from "vitest";

describe("Test cli options", async function () {
    it("should get cli options", async function () {
        const expected = {
            config: "./config.yaml",
        };

        // default
        let result = getCliOptions(["", ""]);
        assert.deepEqual(result, expected);

        // default from env
        process.env.CONFIG = "path/to/env.config.yaml";
        result = getCliOptions(["", ""]);
        expected.config = "path/to/env.config.yaml";
        assert.deepEqual(result, expected);
        delete process.env.CONFIG;

        // -c flag
        result = getCliOptions(["", "", "-c", "path/to/config.yaml"]);
        expected.config = "path/to/config.yaml";
        assert.deepEqual(result, expected);

        // --config flag
        result = getCliOptions(["", "", "--config", "path/to/config.yaml"]);
        expected.config = "path/to/config.yaml";
        assert.deepEqual(result, expected);

        // unknown flag
        assert.throws(
            () => getCliOptions(["", "", "-a"]),
            'process.exit unexpectedly called with "1"',
        );

        // hook to stdout
        let stdoutText = "";
        const orgStdout = process.stdout.write;
        process.stdout.write = (function (write: any) {
            return function (string: any) {
                stdoutText += string;
                // eslint-disable-next-line prefer-rest-params
                write.apply(process.stdout, arguments);
            };
        })(process.stdout.write) as any;

        // should log cli app help
        try {
            getCliOptions(["", "", "-h"]);
        } catch {
            assert.include(
                stdoutText,
                "Node.js app that solves (clears) Rain Orderbook orders against onchain",
            );
            stdoutText = "";
        }

        // should log app version
        try {
            getCliOptions(["", "", "-V"], "1.2.3");
        } catch {
            assert.include(stdoutText, "1.2.3");
        }

        // set original stdout write fn back
        process.stdout.write = orgStdout;
    });
});
