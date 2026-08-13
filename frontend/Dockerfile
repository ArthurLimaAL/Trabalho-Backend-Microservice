FROM node:22-alpine

WORKDIR /app

# O lockfile garante que a imagem use exatamente as mesmas versões testadas localmente.
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

# As URLs têm fallback para localhost, que é exatamente onde o Compose publica os serviços.
ARG VITE_AUTH_URL=http://localhost:3002
ARG VITE_PAYMENT_URL=http://localhost:3001
ENV VITE_AUTH_URL=$VITE_AUTH_URL
ENV VITE_PAYMENT_URL=$VITE_PAYMENT_URL

RUN pnpm run check && pnpm run build

EXPOSE 3000
CMD ["pnpm", "start"]
