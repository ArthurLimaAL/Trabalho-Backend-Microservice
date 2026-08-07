FROM node:20-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci --omit=dev

FROM node:20-alpine AS runtime
WORKDIR /app

RUN addgroup -S app && adduser -S app -G app

COPY --from=deps /app/node_modules ./node_modules

COPY src ./src
COPY package.json ./

USER app

EXPOSE 3004

ENV PORT=3004
ENV NODE_ENV=production

# Comando de inicialização
CMD ["node", "src/server.js"]
