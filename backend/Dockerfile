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

# Copy toàn bộ source + compile
COPY . .
RUN npm run build

EXPOSE 3001

COPY start.sh ./start.sh
RUN chmod +x start.sh

CMD ["sh", "start.sh"]
