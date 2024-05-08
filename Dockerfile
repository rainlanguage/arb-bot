FROM node:21
ADD . .
ADD ./lib/sushiswap/packages/sushi ./lib/sushiswap/packages/sushi
RUN npm install
CMD node arb-bot
# ENTRYPOINT ["node" "arb-bot"]