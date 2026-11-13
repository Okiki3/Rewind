FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./package.json
RUN npm install --omit=dev --no-fund --no-audit
COPY index.mjs scan.mjs ./
CMD ["node", "index.mjs"]
