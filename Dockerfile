FROM node:21
ADD . .
RUN ./prep-sushi.sh
RUN npm install
CMD node arb-bot
# ENTRYPOINT ["node" "arb-bot"]