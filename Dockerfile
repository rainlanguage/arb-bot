FROM node:16
ADD . .
RUN npm install
CMD while true; do node arb-bot -k "${BOT_WALLET_PRIVATEKEY}" -r "${RPC_URL}" --orderbook-address "${ORDERBOOK_ADDRESS}" --arb-address "${ARB_ADDRESS}" && sleep 30; done;
