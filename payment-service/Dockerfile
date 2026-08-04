# ============================================================
# Dockerfile multistage — Payment Service (Node 20 LTS)
# ============================================================
# Estágio 1: baixa dependências de produção
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# Estágio 2: imagem final enxuta (apenas runtime)
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3001
# Segredos NÃO vêm no build: entram via env/Kubernetes Secrets
CMD ["node", "src/server.js"]
