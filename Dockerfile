FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

RUN npm prune --production

RUN mkdir -p data

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
