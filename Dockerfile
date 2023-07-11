FROM node:16
ADD . .
RUN npm install
CMD while true; do node arb-bot -k "${BOT_WALLET_PRIVATEKEY}" -r "${RPC_URL}" --orderbook-address "${ORDERBOOK_ADDRESS}" --arb-address "${ARB_ADDRESS}" --api-key "${API_KEY}" --order-hash "${ORDER_HASH}" | tee -a logs.txt && sleep 10; done;
