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
            pkgs.wasm-bindgen-cli
            rainix.rust-toolchain.${system}
            rainix.rust-build-inputs.${system}
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
      } // rainix.packages.${system};

      # For `nix develop`:
      devShell = pkgs.mkShell {
        packages = [
          packages.install-deps
          packages.test-bot
        ];
        nativeBuildInputs = [
          rainix.node-build-inputs.${system}
        ]
      };
    }
  );
}