FROM node:18
ADD . .
RUN npm install
CMD node arb-bot
# ENTRYPOINT ["node" "arb-bot"]