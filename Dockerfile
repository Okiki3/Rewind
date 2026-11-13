FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci
COPY index.html tsconfig*.json vite.config.ts ./
COPY src ./src
COPY sdk ./sdk

ARG VITE_NEAR_NETWORK_ID=testnet
ARG VITE_NEAR_CONTRACT_ID
ARG VITE_NEAR_NODE_URL=https://rpc.testnet.near.org
ARG VITE_NEAR_WALLET_URL=https://wallet.testnet.near.org
ARG VITE_NEAR_HELPER_URL=https://helper.testnet.near.org
ARG VITE_BASE_PATH=/rewind/
ENV VITE_NEAR_NETWORK_ID=$VITE_NEAR_NETWORK_ID \
    VITE_NEAR_CONTRACT_ID=$VITE_NEAR_CONTRACT_ID \
    VITE_NEAR_NODE_URL=$VITE_NEAR_NODE_URL \
    VITE_NEAR_WALLET_URL=$VITE_NEAR_WALLET_URL \
    VITE_NEAR_HELPER_URL=$VITE_NEAR_HELPER_URL \
    VITE_BASE_PATH=$VITE_BASE_PATH
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --chmod=644 server.mjs ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# Include the independent delivery worker in this image because Railway
# currently resolves the repository-level Dockerfile for both services.
# Only the worker service runs it; website still runs server.mjs.
COPY keeper/package.json ./keeper/package.json
COPY keeper/index.mjs keeper/scan.mjs ./keeper/
RUN cd keeper && npm install --omit=dev --no-audit --no-fund
# Railway's attached volume is root-owned. Worker needs permission to save
# its disposable Testnet-only signing key. Web processes drop to "node" via CMD.
USER root
EXPOSE 4173
CMD ["su", "node", "-s", "/bin/sh", "-c", "node server.mjs"]
