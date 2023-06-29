FROM node:18
ADD . .
RUN npm install --ignore-scripts
# @todo If you want to paramaterise sleep, add support for rate limiting to the
# arb bot logic itself.
CMD while true; do node arb-bot | tee -a logs.txt && sleep 10; done;
