FROM node:18
ADD . .
RUN npm install --ignore-scripts
ENTRYPOINT ["node" "arb-bot"]