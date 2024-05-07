FROM node:21
ADD . .
RUN npm install
CMD node arb-bot
# ENTRYPOINT ["node" "arb-bot"]