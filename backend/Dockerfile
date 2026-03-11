# ============================================================
# Backend — NestJS API
# Single-stage build: giữ devDependencies để npm run db:migrate
# hoạt động trong container (knex dùng ts-node, là devDependency).
#
# Chạy migrations sau khi container lên:
#   docker compose exec backend npm run db:migrate
#   docker compose exec backend npm run db:seed
# ============================================================

FROM node:22-alpine

WORKDIR /app

# Cài dependencies trước (layer cache — chỉ re-install khi package.json đổi)
COPY package*.json ./
RUN npm ci

# Copy source (start.sh excluded via .dockerignore để không invalidate build cache)
COPY . .
RUN npm run build

# Verify build output — fail loudly nếu tsc không tạo ra dist/main.js
RUN test -f dist/main.js || (echo "ERROR: dist/main.js not found after build" && exit 1)

EXPOSE 3001

# Copy start.sh sau build để changes start.sh không trigger full rebuild
COPY start.sh ./start.sh
RUN chmod +x start.sh

CMD ["sh", "start.sh"]
