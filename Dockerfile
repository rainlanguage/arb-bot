FROM node:21
ADD . .
RUN npm install --no-audit
CMD node arb-bot
# ENTRYPOINT ["node" "arb-bot"]