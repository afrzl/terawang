#!/usr/bin/env bash
# Pintu masuk SSH auto-deploy dari GitHub Actions (.github/workflows/deploy.yml).
# Pasang sekali di VPS (user claude, tanpa sudo):
#   install -m 755 deploy/autodeploy-ssh.sh ~/bin/terawang-autodeploy
#   lalu di ~/.ssh/authorized_keys tambahkan kunci publik deploy dengan awalan
#   command="/home/claude/bin/terawang-autodeploy",restrict ssh-ed25519 AAAA... github-actions-terawang
# Kunci itu hanya bisa menjalankan skrip ini. Perintah yang diterima: "<cabang> [paksa]".
set -euo pipefail
read -r CABANG OPSI _ <<<"${SSH_ORIGINAL_COMMAND:-${*:-}}" || true
case "${CABANG:-}" in
  main)             DIR="$HOME/terawang";          PERAN=dasbor ;;
  pipeline-dagster) DIR="$HOME/terawang-pipeline"; PERAN=pipeline ;;
  *) echo "Cabang tidak dikenal: '${CABANG:-}' (hanya main atau pipeline-dagster)" >&2; exit 2 ;;
esac
PAKSA=0; [ "${OPSI:-}" = paksa ] && PAKSA=1

# Sesi SSH non-interaktif: PATH minimal, muat profil agar node/npm/python ditemukan.
[ -f "$HOME/.profile" ] && . "$HOME/.profile" >/dev/null 2>&1 || true
export PATH="$HOME/bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

LOGDIR="$HOME/.local/share/terawang"; mkdir -p "$LOGDIR"
# Kunci per cabang: deploy dasbor (main) tidak pernah menunggu deploy pipeline, dan sebaliknya.
exec 9>"$LOGDIR/autodeploy-$CABANG.lock"
flock -w 3600 9 || { echo "Deploy $CABANG lain masih berjalan lebih dari 1 jam" >&2; exit 1; }

cd "$DIR"
[ "$(git rev-parse --abbrev-ref HEAD)" = "$CABANG" ] || { echo "$DIR tidak berada di cabang $CABANG" >&2; exit 1; }
LAMA="$(git rev-parse HEAD)"
git fetch --quiet origin "$CABANG" 9>&-
git merge --ff-only --quiet FETCH_HEAD || { echo "Fast-forward gagal: ada perubahan lokal di $DIR yang bentrok" >&2; exit 1; }
BARU="$(git rev-parse HEAD)"
echo "[$(date -Is)] $CABANG: ${LAMA:0:7} -> ${BARU:0:7}" | tee -a "$LOGDIR/autodeploy.log"
# 9>&- : proses yang dinyalakan deploy (serve.py, API, Dagster) jangan mewarisi kunci, kalau tidak kunci tertahan selamanya.
PAKSA=$PAKSA bash deploy/autodeploy.sh "$LAMA" "$BARU" "$PERAN" 9>&- 2>&1 | tee -a "$LOGDIR/autodeploy.log"
