FROM node:22-bookworm-slim@sha256:66cb8ef75184df13dc0dcf866330488996b485d404db60555756865300ced4a5
RUN apt-get update && apt-get install -y --no-install-recommends chromium && rm -rf /var/lib/apt/lists/*
WORKDIR /fixture
COPY task-010-host-lifecycle/site ./site
COPY spike-support/peer-rpc.js ./site/
COPY spike-support/chromium.mjs task-010-host-lifecycle/container/verify-guest.mjs ./
ENV POCKETDB_CHROMIUM=/usr/bin/chromium
CMD ["node", "/fixture/verify-guest.mjs"]
