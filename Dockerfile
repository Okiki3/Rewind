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
USER node
EXPOSE 4173
CMD ["node", "server.mjs"]
