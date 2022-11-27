let
    pkgs = import
        (builtins.fetchTarball {
            name = "nixos-unstable-2022-09-26";
            url = "https://github.com/nixos/nixpkgs/archive/b8e83fd7e16529ee331313993508c3bf918f1d57.tar.gz";
            sha256 = "1a98pgnhdhyg66176i36rcn3rklihy36y9z4176la7pxlzm4khwf";
        })
        { };

    local-node = pkgs.writeShellScriptBin "local-node" ''
        hardhat node
    '';

    local-fork = pkgs.writeShellScriptBin "local-fork" ''
        hardhat node --fork https://api.avax.network/ext/bc/C/rpc
    '';

    local-test = pkgs.writeShellScriptBin "local-test" ''
        yarn run test
    '';

    abis = pkgs.writeShellScriptBin "abis" ''
        yarn run abis
    '';

    flush-all = pkgs.writeShellScriptBin "flush-all" ''
        rm -rf artifacts
        rm -rf cache
        rm -rf node_modules
        rm -rf contracts
    '';

    ci-test = pkgs.writeShellScriptBin "ci-test" ''
        flush-all
        yarn install
        abis
        local-test
    '';

    prepare = pkgs.writeShellScriptBin "prepare" ''
        flush-all
        yarn install
        abis
    '';

    docgen = pkgs.writeShellScriptBin "docgen" ''
        yarn run docgen
    '';

    in
    pkgs.stdenv.mkDerivation {
        name = "shell";
        buildInputs = [
            pkgs.watch
            pkgs.nixpkgs-fmt
            pkgs.yarn
            pkgs.nodejs-16_x
            local-node
            local-fork
            local-test
            abis
            ci-test
            prepare
            flush-all
            docgen
        ];

        shellHook = ''
            export PATH=$( npm bin ):$PATH
            # keep it fresh
            yarn install
        '';
    }
