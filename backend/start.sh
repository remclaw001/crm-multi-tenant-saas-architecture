#!/bin/sh
# ============================================================
# start.sh — chờ DB sẵn sàng rồi migrate, sau đó start app
#
# Railway không có depends_on healthcheck như Docker Compose.
# Script này retry migration cho đến khi DB accept connection.
# ============================================================

set -e

MAX_RETRIES=30
RETRY_INTERVAL=5
attempt=1

echo "Waiting for database to be ready..."

until npm run db:migrate 2>&1; do
  if [ "$attempt" -ge "$MAX_RETRIES" ]; then
    echo "ERROR: Database not ready after $MAX_RETRIES attempts. Giving up."
    exit 1
  fi
  echo "Migration failed (attempt $attempt/$MAX_RETRIES). Retrying in ${RETRY_INTERVAL}s..."
  attempt=$((attempt + 1))
  sleep "$RETRY_INTERVAL"
done

echo "Migrations complete. Starting application..."
echo "PORT=$PORT"
echo "NODE_ENV=$NODE_ENV"

# Verify dist exists
if [ ! -f "dist/main.js" ]; then
  echo "ERROR: dist/main.js not found. Build may have failed."
  ls -la dist/ 2>&1 || echo "dist/ directory does not exist"
  exit 1
fi

echo "dist/main.js found. Running node..."
exec node dist/main.js
