{
  inputs = {
    flake-utils.url = "github:numtide/flake-utils";
    rainix.url = "github:rainprotocol/rainix";
  };

  outputs = { self, flake-utils, rainix }:

  flake-utils.lib.eachDefaultSystem (system:
    let
      pkgs = rainix.pkgs.${system};
    in rec {
      packages = {
        install-deps = rainix.mkTask.${system} {
          name = "install-deps";
          body = ''
            set -euxo pipefail
            npm install
          '';
          additionalBuildInputs = [
            rainix.node-build-inputs.${system}
          ];
        };

        test-bot = rainix.mkTask.${system} {
          name = "test-bot";
          body = ''
            set -euxo pipefail
            npm test
          '';
          additionalBuildInputs = [
            rainix.node-build-inputs.${system}
          ];
        };

        lint = rainix.mkTask.${system} {
          name = "lint";
          body = ''
            set -euxo pipefail
            npm run lint
          '';
          additionalBuildInputs = [
            rainix.node-build-inputs.${system}
          ];
        };

        lint-fix = rainix.mkTask.${system} {
          name = "lint-fix";
          body = ''
            set -euxo pipefail
            npm run lint-fix
          '';
          additionalBuildInputs = [
            rainix.node-build-inputs.${system}
          ];
        };
      };

      # For `nix develop`:
      devShell = pkgs.mkShell {
        packages = [
          packages.install-deps
          packages.test-bot
          packages.lint
          packages.lint-fix
        ];
        nativeBuildInputs = [
          rainix.node-build-inputs.${system}
        ];
      };
    }
  );
}