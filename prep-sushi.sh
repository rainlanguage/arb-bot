#!/bin/bash

set -euxo pipefail

# build the sushi package from sushiswap monorepo submodule
git submodule update --init --recursive
(cd lib/sushiswap && nix develop -c pnpm install --frozen-lockfile)
(cd lib/sushiswap && nix develop -c pnpm exec turbo run build --filter=./packages/sushi) 