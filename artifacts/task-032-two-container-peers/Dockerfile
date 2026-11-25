FROM public.ecr.aws/docker/library/node:24-bookworm-slim

ARG CHROME_VERSION=158.0.8127.88

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl fonts-liberation gnupg libasound2 libatk-bridge2.0-0 libatk1.0-0 libatspi2.0-0 libcairo2 libcups2 libdbus-1-3 libdrm2 libexpat1 libgbm1 libglib2.0-0 libnspr4 libnss3 libpango-1.0-0 libu2f-udev libvulkan1 libx11-6 libxcb1 libxcomposite1 libxdamage1 libxext6 libxfixes3 libxkbcommon0 libxrandr2 openssl unzip xdg-utils \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /opt/chrome \
    && curl --fail --location --silent --show-error "https://storage.googleapis.com/chrome-for-testing-public/${CHROME_VERSION}/linux64/chrome-linux64.zip" --output /tmp/chrome.zip \
    && unzip -q /tmp/chrome.zip -d /opt/chrome \
    && rm /tmp/chrome.zip \
    && curl --fail --location --silent --show-error https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor --output /usr/share/keyrings/microsoft-edge.gpg \
    && echo 'deb [arch=amd64 signed-by=/usr/share/keyrings/microsoft-edge.gpg] https://packages.microsoft.com/repos/edge stable main' > /etc/apt/sources.list.d/microsoft-edge.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends microsoft-edge-stable \
    && rm -rf /var/lib/apt/lists/* \
    && printf '#!/bin/sh\nexec /opt/chrome/chrome-linux64/chrome --no-sandbox "$@"\n' > /usr/local/bin/pocketdb-chrome \
    && chmod +x /usr/local/bin/pocketdb-chrome

WORKDIR /workspace
RUN corepack enable
COPY . .
RUN CI=true pnpm install --frozen-lockfile

ENV POCKETDB_CHROMIUM=/usr/local/bin/pocketdb-chrome
