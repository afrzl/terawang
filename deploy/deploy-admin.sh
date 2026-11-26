#!/usr/bin/env bash
# Pasang dan jalankan halaman admin TERAWANG (https://terawang.tech/admin) di VPS tanpa sudo.
# Jalankan dari root worktree pipeline SETELAH deploy-pipeline.sh: bash deploy/deploy-admin.sh
#
# Variabel: ADMIN_HOST (default 172.19.0.1, IP bridge Docker yang dijangkau Traefik, kalau alamat itu ada di mesin ini;
#           kalau tidak ada, 127.0.0.1),
#           ADMIN_PORT (default 3071), DAGSTER_HOST/DAGSTER_PORT (GraphQL Dagster, default 127.0.0.1:3070).
# Sekali saja sesudahnya (sebagai root): salin deploy/traefik-admin.yml ke /opt/traefik/dynamic/terawang-admin.yml,
#   dan bila firewall INPUT = DROP: ufw allow in on <br-...> from 172.19.0.0/16 to 172.19.0.1 port 3071 proto tcp
# Akun pertama: .venv-pipeline/bin/python -m terawang_admin.sandi admin superadmin
set -euo pipefail
cd "$(dirname "$0")/.."
APP_DIR="$(pwd)"
VENV="$APP_DIR/.venv-pipeline"
if [ -z "${ADMIN_HOST:-}" ]; then
  if ip -4 -o addr show 2>/dev/null | grep -q ' 172\.19\.0\.1/'; then ADMIN_HOST=172.19.0.1; else ADMIN_HOST=127.0.0.1; fi
fi
ADMIN_PORT="${ADMIN_PORT:-3071}"
DAGSTER_HOST="${DAGSTER_HOST:-127.0.0.1}"
DAGSTER_PORT="${DAGSTER_PORT:-3070}"
DAGSTER_HOME="${DAGSTER_HOME:-$HOME/dagster_home}"

[ -x "$VENV/bin/python" ] || { echo "$VENV belum ada; jalankan deploy/deploy-pipeline.sh dulu"; exit 1; }
"$VENV/bin/pip" install -q -e admin

DOCKER_BIN="$(dirname "$(command -v docker 2>/dev/null || echo /usr/bin/docker)")"
cat > "$APP_DIR/deploy/admin-ensure.sh" <<SH
#!/usr/bin/env bash
# Dibuat oleh deploy-admin.sh. Menyalakan layanan admin kalau mati (dipanggil cron tiap menit).
export PATH="$DOCKER_BIN:\$PATH"
export DAGSTER_HOME="$DAGSTER_HOME" TERAWANG_REPO="$APP_DIR" DAGSTER_GRAPHQL="http://$DAGSTER_HOST:$DAGSTER_PORT/graphql"
cd "$APP_DIR/admin"
pgrep -f "uvicorn terawang_admin.app:app .*--port $ADMIN_PORT" >/dev/null || (setsid nohup "$VENV/bin/uvicorn" terawang_admin.app:app --host "$ADMIN_HOST" --port "$ADMIN_PORT" --no-server-header --workers 1 >>"$APP_DIR/deploy/admin.log" 2>&1 < /dev/null &)
SH
chmod +x "$APP_DIR/deploy/admin-ensure.sh"
pkill -f "[u]vicorn terawang_admin.app:app .*--port $ADMIN_PORT" 2>/dev/null || true
sleep 1
bash "$APP_DIR/deploy/admin-ensure.sh"

( crontab -l 2>/dev/null | grep -v "deploy/admin-ensure.sh" || true
  echo "* * * * * bash $APP_DIR/deploy/admin-ensure.sh"; echo "@reboot bash $APP_DIR/deploy/admin-ensure.sh" ) | crontab -

for i in $(seq 1 30); do
  if curl -fsS -o /dev/null "http://$ADMIN_HOST:$ADMIN_PORT/admin/"; then
    echo "Selesai: admin di http://$ADMIN_HOST:$ADMIN_PORT/admin/"
    [ -f "$HOME/.config/terawang/admin.json" ] || echo "Akun belum ada: $VENV/bin/python -m terawang_admin.sandi admin superadmin"
    exit 0
  fi
  sleep 1
done
echo "Layanan admin belum menjawab; cek deploy/admin.log"; exit 1
