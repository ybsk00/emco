# 엠코소아청소년과 챗봇 API — Cloud Run
FROM node:20-slim AS builder
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ── runtime ─────────────────────────────────────────────
FROM node:20-slim
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist

# Cloud Run uses non-root by default
USER node

EXPOSE 8080
CMD ["node", "dist/server.js"]
