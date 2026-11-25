#!/usr/bin/env bash
# Auto-deploy: jalankan hanya skrip deploy untuk bagian yang berubah antara dua commit.
# Dipanggil oleh deploy/autodeploy-ssh.sh (pintu SSH dari GitHub Actions) setelah worktree di-fast-forward.
#   bash deploy/autodeploy.sh <commit-lama> <commit-baru> <dasbor|pipeline>
# PAKSA=1 menjalankan semua langkah walau tidak ada berkas yang berubah.
set -euo pipefail
cd "$(dirname "$0")/.."
LAMA="$1"; BARU="$2"; PERAN="$3"
PAKSA="${PAKSA:-0}"
HOST_BRIDGE="${HOST_BRIDGE:-172.19.0.1}"   # IP bridge Docker yang dijangkau Traefik

if [ "$PAKSA" != 1 ] && [ "$LAMA" = "$BARU" ]; then
  echo "Tidak ada commit baru ($BARU); tidak ada yang di-deploy."
  exit 0
fi

BERUBAH="$( [ "$LAMA" = "$BARU" ] || git diff --name-only "$LAMA" "$BARU" )"
echo "Berkas berubah: $(printf '%s\n' "$BERUBAH" | grep -c . || true)"
berubah() { [ "$PAKSA" = 1 ] || printf '%s\n' "$BERUBAH" | grep -qE "$1"; }

case "$PERAN" in
  dasbor)
    # Worktree ~/terawang (cabang main): dasbor statis + API baca-saja.
    DASBOR=0; API=0
    berubah '^(src/|public/|index\.html$|package(-lock)?\.json$|vite\.config|tsconfig|deploy/(serve\.py|deploy-vps\.sh)$)' && DASBOR=1
    berubah '^(api/|deploy/deploy-api\.sh$)' && API=1
    if [ "$DASBOR$API" = 00 ]; then echo "Tidak ada perubahan dasbor/API; selesai."; exit 0; fi
    echo "Deploy: dasbor=$DASBOR api=$API"
    DEPLOY_DASBOR=$DASBOR DEPLOY_API=$API bash deploy/deploy-vps.sh
    ;;
  pipeline)
    # Worktree ~/terawang-pipeline (cabang pipeline-dagster): Dagster + halaman admin.
    # Perubahan data/ saja tidak perlu deploy: sensor Dagster membaca berkas yang sudah ditarik.
    PIPA=0; ADMIN=0
    berubah '^(pipeline/|models/|scripts/|api/|deploy/deploy-pipeline\.sh$)' && PIPA=1
    berubah '^(admin/|deploy/deploy-admin\.sh$)' && ADMIN=1
    [ "$PIPA" = 1 ] && ADMIN=1   # admin memakai venv yang sama; nyalakan ulang setelah paket dipasang ulang
    if [ "$PIPA$ADMIN" = 00 ]; then echo "Tidak ada perubahan pipeline/admin; selesai."; exit 0; fi
    echo "Deploy: pipeline=$PIPA admin=$ADMIN"
    [ "$PIPA" = 1 ] && DAGSTER_HOST="$HOST_BRIDGE" bash deploy/deploy-pipeline.sh
    [ "$ADMIN" = 1 ] && ADMIN_HOST="$HOST_BRIDGE" DAGSTER_HOST="$HOST_BRIDGE" bash deploy/deploy-admin.sh
    ;;
  *) echo "Peran tidak dikenal: $PERAN" >&2; exit 2 ;;
esac
echo "Auto-deploy $PERAN selesai di $BARU."
