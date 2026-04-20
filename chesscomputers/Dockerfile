FROM node:22-alpine
WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY tsconfig.json ./
COPY src ./src

ENV NODE_ENV=production
CMD ["npx", "tsx", "src/index.ts"]
