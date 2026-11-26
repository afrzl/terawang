#!/usr/bin/env bash
# Pasang dan jalankan pipeline Dagster TERAWANG di VPS tanpa sudo.
# Jalankan dari root repo: bash deploy/deploy-pipeline.sh
#
# Prasyarat: Python 3.10+ dengan modul venv (Ubuntu: python3.12-venv), Node (untuk ingest api/), Postgres `terawang` yang sudah di-migrate,
#            dan pipeline/.env (salin dari pipeline/.env.example).
# Variabel: DAGSTER_PORT (default 3070), DAGSTER_HOST (default 127.0.0.1; isi IP bridge Docker agar Traefik bisa
#           menjangkau, mis. 172.19.0.1). Jangan bind ke 0.0.0.0.
#           DAGSTER_READ_ONLY (default 1): UI hanya baca. Isi 0 hanya kalau UI dilindungi basic auth.
#           Kalau firewall INPUT = DROP, izinkan bridge Docker ke port ini (ufw allow in on <br-...> from 172.19.0.0/16 to 172.19.0.1 port 3070).
set -euo pipefail
cd "$(dirname "$0")/.."
APP_DIR="$(pwd)"
VENV="$APP_DIR/.venv-pipeline"
export DAGSTER_HOME="${DAGSTER_HOME:-$HOME/dagster_home}"
DAGSTER_PORT="${DAGSTER_PORT:-3070}"
DAGSTER_HOST="${DAGSTER_HOST:-127.0.0.1}"
DAGSTER_GRPC_PORT="${DAGSTER_GRPC_PORT:-4266}"  # code server permanen, hanya di 127.0.0.1
# 1 = UI publik hanya bisa melihat (tanpa tombol Materialize/Launch). Jadwal dan sensor tetap jalan lewat daemon.
DAGSTER_READ_ONLY="${DAGSTER_READ_ONLY:-1}"
RO_FLAG=""; [ "$DAGSTER_READ_ONLY" = "1" ] && RO_FLAG="--read-only"

[ -f pipeline/.env ] || { echo "pipeline/.env belum ada (salin dari pipeline/.env.example)"; exit 1; }

# 0. Hentikan daemon selama pemasangan: sensor jangan memulai run saat npm ci menghapus node_modules atau pip mengganti paket.
#    Penjaga cron melewati penyalaan ulang selama berkas kunci ini ada.
KUNCI="$APP_DIR/deploy/.deploy-berjalan"
touch "$KUNCI"
trap 'rm -f "$KUNCI"' EXIT
pkill -f "[d]agster-daemon run" 2>/dev/null || true

# 0b. Tunggu run yang sedang berjalan selesai (daemon sudah mati, jadi tidak ada run baru). Tanpa ini npm ci menghapus
#     node_modules di tengah run dan langkah ingest gagal ("tsx: not found"). Batas tunggu DEPLOY_TUNGGU_MENIT (default 45).
#     Run yang tercatat berjalan sejak lebih dari DEPLOY_RUN_BASI_JAM (default 6) jam dianggap basi (proses sudah mati) dan diabaikan.
if [ -x "$VENV/bin/dotenv" ] && [ -x "$VENV/bin/python" ]; then
  cek_run() {
    ( cd pipeline && DAGSTER_HOME="$DAGSTER_HOME" "$VENV/bin/dotenv" -f .env run --no-override -- "$VENV/bin/python" -c '
import os, time
from dagster import DagsterInstance, DagsterRunStatus, RunsFilter
batas = time.time() - float(os.environ.get("DEPLOY_RUN_BASI_JAM", "6")) * 3600  # run "berjalan" lebih tua dari ini dianggap basi
with DagsterInstance.get() as i:
    r = i.get_run_records(RunsFilter(statuses=[DagsterRunStatus.STARTING, DagsterRunStatus.STARTED, DagsterRunStatus.CANCELING]))
    print(" ".join(f"{x.dagster_run.job_name}:{x.dagster_run.run_id[:8]}" for x in r
                   if (x.start_time or x.create_timestamp.timestamp()) > batas))' 2>/dev/null ) || echo "?"
  }
  for i in $(seq 1 $(( ${DEPLOY_TUNGGU_MENIT:-45} * 2 ))); do
    AKTIF="$(cek_run)"
    [ -z "$AKTIF" ] && break
    [ "$AKTIF" = "?" ] && { echo "Status run Dagster tidak terbaca; lanjut deploy."; break; }
    [ "$i" = 1 ] && echo "Menunggu run aktif selesai sebelum memasang ulang: $AKTIF"
    sleep 30
  done
  if [ -n "$AKTIF" ] && [ "$AKTIF" != "?" ]; then echo "PERINGATAN: run masih berjalan setelah ${DEPLOY_TUNGGU_MENIT:-45} menit ($AKTIF); deploy dilanjutkan."; fi
fi

# 1. Lingkungan Python dan dependensi (models milik Danang + pipeline)
[ -d "$VENV" ] || python3 -m venv "$VENV"
"$VENV/bin/pip" install -q --upgrade pip
EXTRA="postgres"; grep -q "^TERAWANG_SUMBER_CITRA=gee" pipeline/.env && EXTRA="postgres,gee"
"$VENV/bin/pip" install -q -e models -e "pipeline[$EXTRA]"

# 2. Dependensi ingest (api/, Prisma) dan migrasi schema
#    npm ci hanya bila package-lock.json berubah sejak pemasangan terakhir (npm ci selalu menghapus node_modules).
LOCK_SHA="$(sha256sum api/package-lock.json | cut -d' ' -f1)"
if [ "$(cat api/node_modules/.terawang-lock-sha 2>/dev/null)" != "$LOCK_SHA" ]; then
  ( cd api && npm ci --silent && echo "$LOCK_SHA" > node_modules/.terawang-lock-sha )
fi
( cd api && set -a && . ../pipeline/.env && set +a && npx prisma migrate deploy && npx prisma generate )

# 3. DAGSTER_HOME: riwayat run disimpan di Postgres kalau DAGSTER_PG_URL ada di .env, selain itu SQLite
mkdir -p "$DAGSTER_HOME"
if grep -q '^DAGSTER_PG_URL=' pipeline/.env; then
  cat > "$DAGSTER_HOME/dagster.yaml" <<YAML
storage:
  postgres:
    postgres_url:
      env: DAGSTER_PG_URL
YAML
else
  : > "$DAGSTER_HOME/dagster.yaml"
fi
# Satu antrean run: job bertag terawang/antrean=pipeline (definitions.py) jalan satu per satu.
cat >> "$DAGSTER_HOME/dagster.yaml" <<YAML
telemetry:
  enabled: false
run_queue:
  tag_concurrency_limits:
    - key: "terawang/antrean"
      value: "pipeline"
      limit: 1
YAML

NODE_BIN="$(dirname "$(command -v npm)")"

# 4. Tulis penjaga proses, lalu jalankan ulang code server, webserver, dan daemon.
#    Satu code server permanen (gRPC di 127.0.0.1:$DAGSTER_GRPC_PORT) dipakai webserver dan daemon. Tanpa ini daemon membuat
#    code server baru tiap menit (impor ulang modul pipeline ~200 MB, beberapa detik CPU) yang ikut memperlambat webserver.
cat > "$APP_DIR/deploy/pipeline-ensure.sh" <<SH
#!/usr/bin/env bash
# Dibuat oleh deploy-pipeline.sh. Menyalakan code server, webserver, dan daemon Dagster kalau mati (dipanggil cron tiap menit).
#   --paksa       jalan walau deploy sedang berlangsung
#   --muat-ulang  hentikan ketiganya dulu (mis. setelah pipeline/.env berubah), lalu nyalakan lagi
# PATH cron minimal: folder Node ditulis di sini supaya aset silver bisa memanggil npm.
export DAGSTER_HOME="$DAGSTER_HOME"
export PATH="$NODE_BIN:\$PATH"
cd "$APP_DIR/pipeline"
ARG="\${1:-}"
[ -f "$APP_DIR/deploy/.deploy-berjalan" ] && [ -z "\$ARG" ] && exit 0  # deploy sedang berjalan
POLA_CS="[d]agster code-server start -m terawang_pipeline.definitions -h 127.0.0.1 -p $DAGSTER_GRPC_PORT"
POLA_WS="[d]agster-webserver --grpc-host 127.0.0.1 --grpc-port $DAGSTER_GRPC_PORT .*--port $DAGSTER_PORT"
POLA_DM="[d]agster-daemon run --grpc-host 127.0.0.1 --grpc-port $DAGSTER_GRPC_PORT"
POLA_LAMA="[d]agster-(webserver|daemon) .*-m terawang_pipeline.definitions"  # proses gaya lama (tanpa code server permanen)
henti() {  # hentikan proses yang cocok, tunggu sampai 90 detik, lalu paksa
  pkill -f "\$1" 2>/dev/null || true
  for i in \$(seq 1 45); do pgrep -f "\$1" >/dev/null || return 0; sleep 2; done
  pkill -9 -f "\$1" 2>/dev/null || true
}
if [ "\$ARG" = "--muat-ulang" ]; then
  henti "\$POLA_WS"; henti "\$POLA_DM"; henti "\$POLA_CS"
fi
pgrep -f "\$POLA_LAMA" >/dev/null && henti "\$POLA_LAMA"
baru=0
if ! pgrep -f "\$POLA_CS" >/dev/null; then
  # code-server tidak memuat pipeline/.env sendiri (webserver dan daemon memuatnya dari cwd), jadi lewat dotenv run
  (setsid nohup "$VENV/bin/dotenv" -f "$APP_DIR/pipeline/.env" run --no-override -- "$VENV/bin/dagster" code-server start -m terawang_pipeline.definitions -h 127.0.0.1 -p $DAGSTER_GRPC_PORT >>"$APP_DIR/deploy/dagster-codeserver.log" 2>&1 < /dev/null &)
  for i in \$(seq 1 60); do "$VENV/bin/dagster" api grpc-health-check -p $DAGSTER_GRPC_PORT >/dev/null 2>&1 && break; sleep 2; done
  baru=1
fi
# code server baru: webserver dan daemon dinyalakan ulang supaya tersambung ke server yang baru
if [ "\$baru" = 1 ]; then henti "\$POLA_WS"; henti "\$POLA_DM"; fi
pgrep -f "\$POLA_WS" >/dev/null || (setsid nohup "$VENV/bin/dagster-webserver" --grpc-host 127.0.0.1 --grpc-port $DAGSTER_GRPC_PORT --host "$DAGSTER_HOST" --port "$DAGSTER_PORT" $RO_FLAG >>"$APP_DIR/deploy/dagster-webserver.log" 2>&1 < /dev/null &)
pgrep -f "\$POLA_DM" >/dev/null || (setsid nohup "$VENV/bin/dagster-daemon" run --grpc-host 127.0.0.1 --grpc-port $DAGSTER_GRPC_PORT >>"$APP_DIR/deploy/dagster-daemon.log" 2>&1 < /dev/null &)
SH
chmod +x "$APP_DIR/deploy/pipeline-ensure.sh"
bash "$APP_DIR/deploy/pipeline-ensure.sh" --muat-ulang

# 5. Cron: jaga proses tetap hidup (juga setelah reboot)
CRON_LINE="* * * * * bash $APP_DIR/deploy/pipeline-ensure.sh"
( crontab -l 2>/dev/null | grep -v "deploy/pipeline-ensure.sh" || true; echo "$CRON_LINE"; echo "@reboot bash $APP_DIR/deploy/pipeline-ensure.sh" ) | crontab -

for i in $(seq 1 90); do
  curl -fsS -o /dev/null "http://$DAGSTER_HOST:$DAGSTER_PORT/server_info" && { echo "Selesai: Dagster di http://$DAGSTER_HOST:$DAGSTER_PORT"; exit 0; }
  sleep 2
done
echo "Dagster belum menjawab; cek deploy/dagster-webserver.log"; exit 1
