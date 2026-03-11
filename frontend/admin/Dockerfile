# ============================================================
# Frontend Admin — Next.js 15, port 3000
#
# NEXT_PUBLIC_API_URL được bake vào bundle lúc build.
# Giá trị mặc định là http://localhost:3001.
# Override qua build arg trong docker-compose.yml nếu cần.
# ============================================================

FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

RUN npm run build

# ── Runner ────────────────────────────────────────────────

FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/public ./public

EXPOSE 3000

# Railway inject $PORT tự động — dùng $PORT nếu có, fallback 3000 (local docker)
CMD ["sh", "-c", "node_modules/.bin/next start -p ${PORT:-3000}"]
