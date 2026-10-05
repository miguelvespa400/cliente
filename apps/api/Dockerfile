FROM node:22-alpine AS base
RUN npm install -g pnpm@9.14.4

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json ./apps/api/
COPY packages/database/package.json ./packages/database/
COPY packages/types/package.json ./packages/types/
RUN pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/packages/database/node_modules ./packages/database/node_modules
COPY . .
RUN pnpm --filter @prospex/database exec prisma generate
RUN pnpm --filter @prospex/api build

# Playwright needs system deps for Chromium
FROM node:22-bookworm-slim AS runner
WORKDIR /app
RUN npm install -g pnpm@9.14.4

# Chromium system deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
    libdrm2 libdbus-1-3 libxkbcommon0 libx11-6 libxcomposite1 \
    libxdamage1 libxext6 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 \
    libcairo2 libasound2 libxshmfence1 fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/node_modules ./node_modules
# pnpm não faz hoist: as dependências da API ficam em apps/api/node_modules (symlinks para node_modules/.pnpm)
COPY --from=builder /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/
COPY --from=builder /app/packages/database ./packages/database
COPY --from=builder /app/packages/types ./packages/types
COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-workspace.yaml ./

# Chromium do Playwright num caminho fixo, legível pelo usuário sem privilégios
# (sem isso ele vai para /root/.cache e o processo "prospex" não o encontra).
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN pnpm --filter @prospex/api exec playwright install chromium && chmod -R a+rX /ms-playwright

RUN addgroup --system prospex && adduser --system --ingroup prospex prospex
USER prospex

# Aplica as migrations do Prisma antes de subir a API (cria/atualiza as tabelas).
WORKDIR /app/apps/api
CMD ["sh", "-c", "cd /app/packages/database && ./node_modules/.bin/prisma migrate deploy && cd /app/apps/api && exec node dist/main"]
