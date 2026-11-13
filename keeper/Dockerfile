FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY keeper/package.json ./package.json
RUN npm install --omit=dev --no-fund --no-audit
COPY keeper/index.mjs keeper/scan.mjs ./
CMD ["node", "index.mjs"]
