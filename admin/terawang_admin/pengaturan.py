"""Pengaturan layanan admin, semuanya lewat environment (lihat deploy/deploy-admin.sh)."""
from __future__ import annotations

import os
from pathlib import Path

RUMAH = Path.home()


def _path(nama: str, bawaan: Path) -> Path:
    return Path(os.environ.get(nama) or bawaan).expanduser()


# Akar worktree pipeline (tempat pipeline/.env, data/ acuan, dan deploy/pipeline-ensure.sh)
REPO = _path("TERAWANG_REPO", Path(__file__).resolve().parents[2])
# Berkas akun admin: {"pengguna", "hash", "rahasia", "versi"} (dibuat lewat `python -m terawang_admin.sandi`)
BERKAS_AKUN = _path("TERAWANG_ADMIN_AKUN", RUMAH / ".config/terawang/admin.json")
# Folder unggahan manual, dibaca aset bronze sebagai fallback (kontrak dengan pipeline)
MANUAL_DIR = _path("TERAWANG_MANUAL_DIR", RUMAH / ".local/share/terawang/manual")
# Jejak audit tindakan admin
JEJAK = _path("TERAWANG_ADMIN_JEJAK", RUMAH / ".local/share/terawang/admin/jejak.jsonl")
# GraphQL Dagster (webserver read-only juga melayani query)
DAGSTER_GRAPHQL = os.environ.get("DAGSTER_GRAPHQL", "http://127.0.0.1:3070/graphql")
DAGSTER_HOME = os.environ.get("DAGSTER_HOME", str(RUMAH / "dagster_home"))
# venv tempat dagster terpasang (untuk `dagster job launch`)
VENV_PIPELINE = _path("TERAWANG_VENV_PIPELINE", REPO / ".venv-pipeline")
# Berkas .env yang boleh diubah dari halaman admin: "nama=path;nama=path"
_ENV_BAWAAN = f"pipeline={REPO / 'pipeline/.env'};bot={RUMAH / 'terawang-bot/bot/.env'}"
BERKAS_ENV: dict[str, Path] = {
    k.strip(): Path(v.strip()).expanduser()
    for k, v in (bagian.split("=", 1) for bagian in os.environ.get("TERAWANG_ADMIN_ENV", _ENV_BAWAAN).split(";") if "=" in bagian)
}
# Folder docker compose bot WhatsApp (untuk menyalakan ulang setelah .env bot berubah)
BOT_DIR = _path("TERAWANG_BOT_DIR", RUMAH / "terawang-bot/bot")
# Cookie Secure hanya kalau lewat HTTPS (Traefik). Isi 0 untuk uji lokal http.
COOKIE_SECURE = os.environ.get("TERAWANG_ADMIN_COOKIE_SECURE", "1") == "1"
UKURAN_MAKS_UNGGAH = int(os.environ.get("TERAWANG_ADMIN_UKURAN_MAKS_MB", "200")) * 1024 * 1024
# GoWA dan bot WhatsApp, dibaca dari host (port hanya di 127.0.0.1). Kredensial diambil dari .env bot.
GOWA_URL = os.environ.get("TERAWANG_GOWA_URL", "http://127.0.0.1:3091").rstrip("/")
BOT_URL = os.environ.get("TERAWANG_BOT_URL", "http://127.0.0.1:8091").rstrip("/")
# ID slot device GoWA untuk bot (dipakai kalau GOWA_DEVICE_ID di .env bot kosong)
BOT_DEVICE_BAWAAN = os.environ.get("TERAWANG_BOT_DEVICE", "terawang-bot")
