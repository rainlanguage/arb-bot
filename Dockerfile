FROM node:18
ADD . .
RUN npm install --ignore-scripts
CMD node arb-bot