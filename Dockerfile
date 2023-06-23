FROM node:18
ADD . .
RUN npm install --ignore-scripts
CMD while true; do node arb-bot | tee -a logs.txt && sleep 10; done;
