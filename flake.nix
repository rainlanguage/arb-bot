{
  inputs = {
    flake-utils.url = "github:numtide/flake-utils";
    rainix.url = "github:rainprotocol/rainix";
    nixpkgs.url = "github:nixos/nixpkgs";
  };

  outputs = { self, flake-utils, rainix, nixpkgs }:

  flake-utils.lib.eachDefaultSystem (system:
    let
      pkgs = rainix.pkgs.${system};
      pkgsnix = import nixpkgs { inherit system; };
    in rec {
      # For `nix develop`:
      devShells.default = pkgs.mkShell {
          nativeBuildInputs = [
            rainix.node-build-inputs.${system}
            rainix.sol-build-inputs.${system}
            pkgsnix.doctl
          ];
        };
    }
  );
}