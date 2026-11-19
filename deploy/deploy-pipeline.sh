#!/usr/bin/env bash
# Pasang dan jalankan pipeline Dagster TERAWANG di VPS tanpa sudo.
# Jalankan dari root repo: bash deploy/deploy-pipeline.sh
#
# Prasyarat: Python 3.10+, Node (untuk ingest api/), Postgres `terawang` yang sudah di-migrate,
#            dan pipeline/.env (salin dari pipeline/.env.example).
# Variabel: DAGSTER_PORT (default 3070), DAGSTER_HOST (default 127.0.0.1; isi IP bridge Docker agar Traefik bisa
#           menjangkau, mis. 172.19.0.1). Jangan bind ke 0.0.0.0: UI Dagster bisa menjalankan pipeline.
set -euo pipefail
cd "$(dirname "$0")/.."
APP_DIR="$(pwd)"
VENV="$APP_DIR/.venv-pipeline"
export DAGSTER_HOME="${DAGSTER_HOME:-$HOME/dagster_home}"
DAGSTER_PORT="${DAGSTER_PORT:-3070}"
DAGSTER_HOST="${DAGSTER_HOST:-127.0.0.1}"

[ -f pipeline/.env ] || { echo "pipeline/.env belum ada (salin dari pipeline/.env.example)"; exit 1; }

# 1. Lingkungan Python dan dependensi (models milik Danang + pipeline)
[ -d "$VENV" ] || python3 -m venv "$VENV"
"$VENV/bin/pip" install -q --upgrade pip
"$VENV/bin/pip" install -q -e models -e "pipeline[postgres]"

# 2. Dependensi ingest (api/, Prisma) dan migrasi schema
( cd api && npm ci --silent && set -a && . ../pipeline/.env && set +a && npx prisma migrate deploy && npx prisma generate )

# 3. DAGSTER_HOME: riwayat run disimpan di Postgres kalau DAGSTER_PG_URL ada di .env, selain itu SQLite
mkdir -p "$DAGSTER_HOME"
if grep -q '^DAGSTER_PG_URL=' pipeline/.env; then
  cat > "$DAGSTER_HOME/dagster.yaml" <<YAML
storage:
  postgres:
    postgres_url:
      env: DAGSTER_PG_URL
telemetry:
  enabled: false
YAML
else
  printf 'telemetry:\n  enabled: false\n' > "$DAGSTER_HOME/dagster.yaml"
fi

# 4. Tulis penjaga proses, lalu jalankan ulang webserver dan daemon
cat > "$APP_DIR/deploy/pipeline-ensure.sh" <<SH
#!/usr/bin/env bash
# Dibuat oleh deploy-pipeline.sh. Menyalakan webserver dan daemon Dagster kalau mati (dipanggil cron tiap menit).
export DAGSTER_HOME="$DAGSTER_HOME"
cd "$APP_DIR/pipeline"
pgrep -f "dagster-webserver.*--port $DAGSTER_PORT" >/dev/null || setsid nohup "$VENV/bin/dagster-webserver" -m terawang_pipeline.definitions -h "$DAGSTER_HOST" -p "$DAGSTER_PORT" >>"$APP_DIR/deploy/dagster-webserver.log" 2>&1 < /dev/null &
pgrep -f "dagster-daemon run" >/dev/null || setsid nohup "$VENV/bin/dagster-daemon" run -m terawang_pipeline.definitions >>"$APP_DIR/deploy/dagster-daemon.log" 2>&1 < /dev/null &
SH
chmod +x "$APP_DIR/deploy/pipeline-ensure.sh"
pkill -f "dagster-webserver.*--port $DAGSTER_PORT" 2>/dev/null || true
pkill -f "dagster-daemon run" 2>/dev/null || true
sleep 2
bash "$APP_DIR/deploy/pipeline-ensure.sh"

# 5. Cron: jaga proses tetap hidup (juga setelah reboot)
CRON_LINE="* * * * * bash $APP_DIR/deploy/pipeline-ensure.sh"
( crontab -l 2>/dev/null | grep -v "deploy/pipeline-ensure.sh" || true; echo "$CRON_LINE"; echo "@reboot bash $APP_DIR/deploy/pipeline-ensure.sh" ) | crontab -

for i in $(seq 1 30); do
  curl -fsS -o /dev/null "http://$DAGSTER_HOST:$DAGSTER_PORT/server_info" && { echo "Selesai: Dagster di http://$DAGSTER_HOST:$DAGSTER_PORT"; exit 0; }
  sleep 2
done
echo "Dagster belum menjawab; cek deploy/dagster-webserver.log"; exit 1
