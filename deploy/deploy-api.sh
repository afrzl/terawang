#!/usr/bin/env bash
# Pasang dan jalankan API baca-saja dasbor TERAWANG (api/src/server.ts, https://terawang.tech/api/...) di VPS tanpa sudo.
# Jalankan dari root repo dasbor: API_HOST=172.19.0.1 bash deploy/deploy-api.sh
#
# Variabel: API_HOST (default 127.0.0.1; isi IP bridge Docker, mis. 172.19.0.1, agar Traefik bisa menjangkau), API_PORT (3072),
#           ADMIN_URL (layanan admin untuk cek hak SPHP, default http://172.19.0.1:3071), TERAWANG_GEE_JSON dan TERAWANG_DERET_JSON (keluaran pipeline).
# DATABASE_URL dibaca dari api/.env; bila belum ada, disalin dari worktree pipeline (PIPELINE_DIR, default ~/terawang-pipeline).
# Sekali saja sesudahnya (sebagai root): salin deploy/traefik-api.yml ke /opt/traefik/dynamic/terawang-api.yml,
#   dan bila firewall INPUT = DROP: ufw allow in on <br-...> from 172.19.0.0/16 to 172.19.0.1 port 3072 proto tcp
set -euo pipefail
cd "$(dirname "$0")/.."
APP_DIR="$(pwd)"
API_HOST="${API_HOST:-127.0.0.1}"
API_PORT="${API_PORT:-3072}"
ADMIN_URL="${ADMIN_URL:-http://172.19.0.1:3071}"
PIPELINE_DIR="${PIPELINE_DIR:-$HOME/terawang-pipeline}"
GEE_JSON="${TERAWANG_GEE_JSON:-$HOME/.local/share/terawang/gee_wilayah.json}"
DERET_JSON="${TERAWANG_DERET_JSON:-$HOME/.local/share/terawang/deret_satelit.json}"

if ! grep -qs '^DATABASE_URL=' api/.env; then
  for f in "$PIPELINE_DIR/api/.env" "$PIPELINE_DIR/pipeline/.env"; do
    if grep -qs '^DATABASE_URL=' "$f"; then
      grep '^DATABASE_URL=' "$f" >> api/.env
      chmod 600 api/.env
      echo "DATABASE_URL disalin dari $f"
      break
    fi
  done
fi
grep -qs '^DATABASE_URL=' api/.env || { echo "api/.env belum berisi DATABASE_URL"; exit 1; }

(cd api && npm ci --no-audit --no-fund)

NODE_BIN="$(dirname "$(command -v node)")"
cat > "$APP_DIR/deploy/api-ensure.sh" <<SH
#!/usr/bin/env bash
# Dibuat oleh deploy-api.sh. Menyalakan API dasbor kalau mati (dipanggil cron tiap menit).
export PATH="$NODE_BIN:\$PATH" API_HOST="$API_HOST" API_PORT="$API_PORT" ADMIN_URL="$ADMIN_URL" TERAWANG_GEE_JSON="$GEE_JSON" TERAWANG_DERET_JSON="$DERET_JSON"
cd "$APP_DIR/api"
pgrep -f "tsx src/server.ts.*terawang-api-$API_PORT" >/dev/null || (setsid nohup node_modules/.bin/tsx src/server.ts --nama terawang-api-$API_PORT >>"$APP_DIR/deploy/api.log" 2>&1 < /dev/null &)
SH
chmod +x "$APP_DIR/deploy/api-ensure.sh"
pkill -f "[t]sx src/server.ts.*terawang-api-$API_PORT" 2>/dev/null || true
sleep 1
bash "$APP_DIR/deploy/api-ensure.sh"

( crontab -l 2>/dev/null | grep -v "deploy/api-ensure.sh" || true
  echo "* * * * * bash $APP_DIR/deploy/api-ensure.sh"; echo "@reboot bash $APP_DIR/deploy/api-ensure.sh" ) | crontab -

for i in $(seq 1 30); do
  if curl -fsS -o /dev/null "http://$API_HOST:$API_PORT/api/status"; then
    echo "Selesai: API di http://$API_HOST:$API_PORT/api/status"
    exit 0
  fi
  sleep 1
done
echo "API belum menjawab; cek deploy/api.log"; exit 1
