FROM node:21
WORKDIR /arb-bot
ADD . .
RUN npm install
CMD node arb-bot
# ENTRYPOINT ["node" "arb-bot"]