#!/usr/bin/env bash
# Build dan sajikan dasbor TERAWANG di VPS tanpa sudo.
# Jalankan dari root repo: bash deploy/deploy-vps.sh   (PORT=8080 bisa diganti)
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${PORT:-8080}"
APP_DIR="$(pwd)"

git pull --ff-only || echo "git pull dilewati (tidak ada remote atau ada perubahan lokal)"
npm ci
npm run build

# Hentikan server lama di port yang sama (server statis lama maupun versi ini).
pkill -f "serve.py --dir dist --port $PORT" 2>/dev/null || true
pkill -f "http.server $PORT" 2>/dev/null || true
sleep 1

nohup python3 "$APP_DIR/deploy/serve.py" --dir "$APP_DIR/dist" --port "$PORT" >"$APP_DIR/deploy/server.log" 2>&1 &
sleep 1

# Jalankan ulang otomatis setelah reboot.
CRON_LINE="@reboot cd $APP_DIR && nohup python3 deploy/serve.py --dir dist --port $PORT >deploy/server.log 2>&1"
( crontab -l 2>/dev/null | grep -v "deploy/serve.py --dir dist --port $PORT" | grep -v "terawang-web" || true; echo "$CRON_LINE" ) | crontab -

curl -fsS -o /dev/null "http://127.0.0.1:$PORT/stok" && echo "Selesai: http://$(hostname -I | awk '{print $1}'):$PORT"
