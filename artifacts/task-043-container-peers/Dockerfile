FROM node:25-alpine
RUN apk add --no-cache chromium
WORKDIR /fixture
COPY task-010-host-lifecycle/site ./site
COPY spike-support/peer-rpc.js ./site/
COPY spike-support/chromium.mjs task-010-host-lifecycle/container/verify-guest.mjs ./
ENV POCKETDB_CHROMIUM=/usr/bin/chromium
CMD ["node", "/fixture/verify-guest.mjs"]
