"""Baca/tulis berkas .env (pipeline/.env, bot/.env) tanpa pernah mengirim nilai secret utuh ke peramban."""
from __future__ import annotations

import os
import re
import shutil
import time
from pathlib import Path

KUNCI_SAH = re.compile(r"^[A-Z][A-Z0-9_]{0,63}$")
POLA_SECRET = re.compile(r"(KEY|TOKEN|SECRET|PASS|PASSWORD|AUTH|_URL$|DSN)", re.I)
SIMPAN_CADANGAN = 5

# Keterangan variabel yang dikenal. pilihan = daftar nilai sah; secret = selalu disamarkan.
DIKENAL: dict[str, dict[str, dict]] = {
    "pipeline": {
        "BPS_WEBAPI_KEY": {"label": "Key WebAPI BPS", "secret": True, "uji": "bps",
                           "ket": "Dipakai aset bronze_bps (WebAPI) dan bronze_bulog (mencari PDF Jatim Dalam Angka). Ambil di webapi.bps.go.id."},
        "TERAWANG_SUMBER_BPS": {"label": "Sumber data BPS", "pilihan": ["berkas", "webapi", "manual"],
                                "ket": "webapi = ambil otomatis; manual = pakai unggahan di tab Unggah manual; berkas = CSV di repo."},
        "TERAWANG_SUMBER_BULOG": {"label": "Sumber data Bulog", "pilihan": ["berkas", "jda", "manual"],
                                  "ket": "jda = ambil dari PDF Jatim Dalam Angka; manual = pakai unggahan."},
        "TERAWANG_SUMBER_HARGA": {"label": "Sumber harga beras", "pilihan": ["berkas", "siskaperbapo", "manual"],
                                  "ket": "siskaperbapo = unduh harga harian otomatis."},
        "TERAWANG_SUMBER_CITRA": {"label": "Sumber citra satelit", "pilihan": ["berkas", "gee"],
                                  "ket": "gee = hitung ulang di Google Earth Engine (butuh GEE_PROJECT)."},
        "GEE_PROJECT": {"label": "Project Google Earth Engine", "ket": "ID project Cloud yang terdaftar di Earth Engine (noncommercial)."},
        "DATABASE_URL": {"label": "URL database terawang", "secret": True, "bahaya": True,
                         "ket": "Salah isi = seluruh pipeline gagal. Ubah hanya kalau sandi/role DB diganti."},
        "DAGSTER_PG_URL": {"label": "URL database riwayat Dagster", "secret": True, "bahaya": True,
                           "ket": "Penyimpanan riwayat run Dagster. Salah isi = Dagster tidak bisa jalan."},
    },
    "bot": {
        "OPENAI_API_KEY": {"label": "API key OpenAI", "secret": True, "uji": "openai",
                           "ket": "Untuk menjawab pesan bebas di bot WhatsApp. Kosong = bot hanya melayani perintah baku."},
        "OPENAI_MODEL": {"label": "Model OpenAI", "ket": "Model kelas mini supaya hemat, mis. gpt-5-mini."},
        "OPENAI_REASONING_EFFORT": {"label": "Tingkat penalaran", "pilihan": ["minimal", "low", "medium"]},
        "LLM_BATAS_HARIAN": {"label": "Batas pesan LLM per nomor per hari", "angka": True},
        "LLM_BATAS_10MENIT": {"label": "Batas pesan LLM per nomor per 10 menit", "angka": True, "ket": "Anti-spam. Lewat batas, bot hanya melayani perintah baku."},
        "LLM_TOKEN_HARIAN": {"label": "Anggaran token seluruh bot per hari", "angka": True,
                             "ket": "Lewat dari ini pesan bebas ditolak sampai besok. Batas keras tetap pasang di dasbor OpenAI (Settings > Limits)."},
        "LLM_MAKS_KELUARAN": {"label": "Token keluaran maks. per panggilan", "angka": True},
        "LLM_MAKS_MASUKAN": {"label": "Panjang pesan maks. ke LLM (karakter)", "angka": True},
        "LLM_CACHE_MENIT": {"label": "Cache jawaban LLM (menit)", "angka": True, "ket": "Pertanyaan sama dijawab dari cache. 0 = mati."},
        "ADMIN_WA": {"label": "Nomor WA admin", "ket": "Format 628xx, pisahkan dengan koma."},
        "SIARAN_AKTIF": {"label": "Siaran peringatan aktif", "pilihan": ["1", "0"]},
        "SIARAN_INTERVAL_MENIT": {"label": "Interval cek siaran (menit)", "angka": True},
        "HET_MEDIUM": {"label": "HET beras medium cadangan (Rp/kg)", "angka": True},
        "BOT_API_TOKEN": {"label": "Token API simulator dasbor", "secret": True},
        "WHATSAPP_WEBHOOK_SECRET": {"label": "Secret webhook GoWA", "secret": True, "bahaya": True,
                                    "ket": "Harus sama dengan ~/terawang-wa/.env, kalau tidak webhook ditolak."},
        "GOWA_BASIC_AUTH": {"label": "Basic auth GoWA", "secret": True, "bahaya": True},
        "GOWA_URL": {"label": "URL GoWA", "bahaya": True},
        "DATABASE_URL": {"label": "URL database (role bot)", "secret": True, "bahaya": True},
    },
}


def _urai_nilai(mentah: str) -> str:
    mentah = mentah.strip()
    if len(mentah) >= 2 and mentah[0] == mentah[-1] and mentah[0] in "\"'":
        isi = mentah[1:-1]
        return isi.replace('\\"', '"').replace("\\$", "$").replace("\\\\", "\\") if mentah[0] == '"' else isi
    # komentar di belakang nilai tanpa kutip: KEY=nilai  # komentar
    return re.split(r"\s+#", mentah, maxsplit=1)[0].strip()


def baca(path: Path) -> dict[str, str]:
    hasil: dict[str, str] = {}
    if not path.exists():
        return hasil
    for baris in path.read_text(encoding="utf-8").splitlines():
        m = re.match(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$", baris)
        if m:
            hasil[m.group(1)] = _urai_nilai(m.group(2))
    return hasil


def secret(berkas: str, kunci: str) -> bool:
    info = DIKENAL.get(berkas, {}).get(kunci)
    return bool(info["secret"]) if info and "secret" in info else bool(POLA_SECRET.search(kunci))


def samarkan(nilai: str) -> str:
    if not nilai:
        return ""
    if len(nilai) < 12:
        return "•" * 8
    return "•" * 8 + nilai[-4:]


def ringkas(berkas: str, path: Path) -> list[dict]:
    """Daftar variabel untuk ditampilkan: nilai non-secret apa adanya, secret disamarkan."""
    nilai = baca(path)
    kunci = list(DIKENAL.get(berkas, {}))
    kunci += [k for k in nilai if k not in kunci]
    hasil = []
    for k in kunci:
        info = DIKENAL.get(berkas, {}).get(k, {})
        ada = k in nilai
        v = nilai.get(k, "")
        rahasia = secret(berkas, k)
        hasil.append({
            "kunci": k, "label": info.get("label"), "ket": info.get("ket"), "pilihan": info.get("pilihan"),
            "angka": bool(info.get("angka")), "bahaya": bool(info.get("bahaya")), "uji": info.get("uji"),
            "secret": rahasia, "ada": ada, "terisi": bool(v),
            "nilai": samarkan(v) if rahasia else v, "panjang": len(v) if rahasia else None,
        })
    return hasil


def _kutip(nilai: str) -> str:
    if nilai == "" or re.fullmatch(r"[A-Za-z0-9_@%+=:,./\-]+", nilai):
        return nilai
    if "'" not in nilai:  # kutip tunggal: literal untuk bash, python-dotenv, dan docker compose ($ tidak diekspansi)
        return f"'{nilai}'"
    return '"' + nilai.replace("\\", "\\\\").replace('"', '\\"').replace("$", "\\$") + '"'


def periksa(berkas: str, kunci: str, nilai: str) -> str | None:
    """Pesan galat kalau nilai tidak sah, None kalau sah."""
    if not KUNCI_SAH.match(kunci):
        return "Nama variabel hanya huruf besar, angka, dan garis bawah, diawali huruf."
    if "\n" in nilai or "\r" in nilai or "\0" in nilai:
        return "Nilai tidak boleh berisi baris baru."
    if len(nilai) > 4096:
        return "Nilai terlalu panjang."
    info = DIKENAL.get(berkas, {}).get(kunci, {})
    if info.get("pilihan") and nilai not in info["pilihan"] and nilai != "":
        return f"Pilihan yang sah: {', '.join(info['pilihan'])}."
    if info.get("angka") and nilai and not re.fullmatch(r"\d+", nilai):
        return "Harus angka bulat."
    return None


def tulis(path: Path, kunci: str, nilai: str | None) -> None:
    """Ganti (atau tambah) satu variabel; nilai None = hapus baris. Cadangan disimpan, mode 600 dipertahankan."""
    lama = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    baru, ketemu = [], False
    for baris in lama:
        m = re.match(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=", baris)
        if m and m.group(1) == kunci:
            if not ketemu and nilai is not None:
                baru.append(f"{kunci}={_kutip(nilai)}")
            ketemu = True
            continue
        baru.append(baris)
    if not ketemu and nilai is not None:
        baru.append(f"{kunci}={_kutip(nilai)}")
    if path.exists():
        cadangan = path.with_name(f"{path.name}.bak-{time.strftime('%Y%m%d-%H%M%S')}")
        shutil.copy2(path, cadangan)
        os.chmod(cadangan, 0o600)
        semua = sorted(path.parent.glob(f"{path.name}.bak-*"))
        for usang in semua[:-SIMPAN_CADANGAN]:
            usang.unlink(missing_ok=True)
    mode = (path.stat().st_mode & 0o777) if path.exists() else 0o600
    tmp = path.with_name(f".{path.name}.tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, mode & 0o700 or 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write("\n".join(baru) + "\n")
    os.replace(tmp, path)
