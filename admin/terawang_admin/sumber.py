"""Unggah manual data sumber, fallback ketika konektor otomatis gagal.

Kontrak dengan aset bronze (pipeline): berkas disimpan di MANUAL_DIR/<sumber>/<nama asli>. Nama harus sama persis dengan salah
satu berkas acuan di repo, header CSV harus sama. Versi lama dipindah ke <sumber>/_arsip/<waktu>/, tiap unggahan dicatat di
<sumber>/_log.jsonl. Folder yang diawali "_" diabaikan aset.
"""
from __future__ import annotations

import gzip
import hashlib
import io
import json
import os
import re
import shutil
import time
from pathlib import Path

from . import pengaturan

SUMBER: dict[str, dict] = {
    "bps": {"label": "BPS", "ket": "Produksi padi, penduduk, konsumsi beras.", "acuan": "data/bps", "aset": ["bronze_bps"],
            "env": "TERAWANG_SUMBER_BPS"},
    "bulog": {"label": "Bulog", "ket": "Stok, pengadaan, harga acuan dan penggilingan.", "acuan": "data/bulog", "aset": ["bronze_bulog"],
              "env": "TERAWANG_SUMBER_BULOG"},
    "harga": {"label": "Harga beras harian", "ket": "SISKAPERBAPO per provinsi, kab/kota, dan pasar.",
              "acuan": "data/siskaperbapo/harga_beras", "aset": ["bronze_harga"], "env": "TERAWANG_SUMBER_HARGA"},
    "jarak": {"label": "Jarak antar kab/kota", "ket": "Matriks jarak dan waktu tempuh (OSRM).", "acuan": "data/geografi/jarak_kabkota",
              "aset": ["bronze_jarak"], "env": None},
}
ASET_KE_SUMBER = {a: s for s, info in SUMBER.items() for a in info["aset"]}
# Sumber tanpa unggah manual, tetap punya halaman sendiri di admin (riwayat + status).
SUMBER_LAIN: dict[str, dict] = {
    "citra": {"label": "Citra satelit", "ket": "Sentinel-1/2 dari Google Earth Engine: olahan per wilayah dan deret titik sawah.",
              "aset": ["bronze_citra", "bronze_titik_satelit"], "env": "TERAWANG_SUMBER_CITRA"},
}


def halaman() -> list[dict]:
    """Satu halaman admin per sumber data, urut seperti di menu."""
    hasil = [{"id": s, "label": i["label"], "ket": i["ket"], "aset": i["aset"], "env": i["env"], "unggah": True} for s, i in SUMBER.items()]
    hasil += [{"id": s, "label": i["label"], "ket": i["ket"], "aset": i["aset"], "env": i["env"], "unggah": False} for s, i in SUMBER_LAIN.items()]
    return hasil
EKSTENSI = (".csv", ".csv.gz")
NAMA_SAH = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$")


def _header(path: Path) -> list[str] | None:
    try:
        buka = gzip.open if path.name.endswith(".gz") else open
        with buka(path, "rt", encoding="utf-8-sig", newline="") as f:
            return _pisah(f.readline())
    except (OSError, UnicodeDecodeError, EOFError):
        return None


def _pisah(baris: str) -> list[str]:
    import csv

    return next(csv.reader([baris.strip("\r\n")]), [])


def acuan(sumber: str) -> dict[str, dict]:
    """Berkas acuan di repo: nama -> {path relatif, header}."""
    akar = pengaturan.REPO / SUMBER[sumber]["acuan"]
    hasil = {}
    if akar.exists():
        for p in sorted(akar.rglob("*")):
            if p.is_file() and p.name.endswith(EKSTENSI):
                hasil[p.name] = {"path": str(p.relative_to(pengaturan.REPO)), "header": _header(p)}
    return hasil


def folder(sumber: str) -> Path:
    return pengaturan.MANUAL_DIR / sumber


def _log(sumber: str, baris: dict) -> None:
    d = folder(sumber)
    d.mkdir(parents=True, exist_ok=True)
    with open(d / "_log.jsonl", "a", encoding="utf-8") as f:
        f.write(json.dumps(baris, ensure_ascii=False) + "\n")


def riwayat(sumber: str, batas: int = 50) -> list[dict]:
    p = folder(sumber) / "_log.jsonl"
    if not p.exists():
        return []
    hasil = []
    for b in reversed(p.read_text(encoding="utf-8").splitlines()[-batas:]):
        try:
            hasil.append(json.loads(b))
        except ValueError:
            pass
    return hasil


def daftar() -> list[dict]:
    hasil = []
    for s, info in SUMBER.items():
        ref = acuan(s)
        d = folder(s)
        ada = {}
        if d.exists():
            for p in sorted(d.iterdir()):
                if p.is_file() and not p.name.startswith("_"):
                    st = p.stat()
                    ada[p.name] = {"nama": p.name, "ukuran": st.st_size, "waktu": st.st_mtime, "dikenal": p.name in ref}
        hasil.append({
            "id": s, "label": info["label"], "ket": info["ket"], "aset": info["aset"], "env": info["env"],
            "acuan": [{"nama": n, "path": r["path"], "kolom": r["header"], "unggahan": ada.get(n)} for n, r in ref.items()],
            "lain": [v for n, v in ada.items() if n not in ref],
            "riwayat": riwayat(s, 20),
        })
    return hasil


class GagalUnggah(ValueError):
    pass


def periksa_nama(sumber: str, nama: str) -> dict:
    if sumber not in SUMBER:
        raise GagalUnggah("Sumber tidak dikenal.")
    if not NAMA_SAH.match(nama) or not nama.endswith(EKSTENSI):
        raise GagalUnggah("Nama berkas harus .csv atau .csv.gz, tanpa spasi atau garis miring.")
    ref = acuan(sumber)
    if nama not in ref:
        raise GagalUnggah(f"Nama berkas harus sama persis dengan berkas acuan {SUMBER[sumber]['label']} (lihat daftar di halaman).")
    return ref[nama]


def simpan(sumber: str, nama: str, sementara: Path, pengguna: str, ip: str | None, catatan: str = "") -> dict:
    """Validasi berkas sementara lalu pindahkan ke folder manual. Kembalikan baris log."""
    ref = periksa_nama(sumber, nama)
    # Validasi isi: gzip sah (bila .gz), UTF-8, header sama persis dengan acuan, minimal satu baris data
    try:
        buka = gzip.open if nama.endswith(".gz") else open
        with buka(sementara, "rt", encoding="utf-8-sig", newline="") as f:
            header = _pisah(f.readline())
            jumlah = sum(1 for b in f if b.strip())
    except (OSError, EOFError, gzip.BadGzipFile):
        raise GagalUnggah("Berkas rusak atau bukan gzip yang sah.") from None
    except UnicodeDecodeError:
        raise GagalUnggah("Berkas harus teks UTF-8 (CSV). Kalau dari Excel, simpan sebagai 'CSV UTF-8'.") from None
    if ref["header"] is not None and header != ref["header"]:
        kurang = [k for k in ref["header"] if k not in header]
        lebih = [k for k in header if k not in ref["header"]]
        rinci = []
        if kurang:
            rinci.append("kolom hilang: " + ", ".join(kurang))
        if lebih:
            rinci.append("kolom asing: " + ", ".join(lebih))
        if not rinci:
            rinci.append("urutan kolom berbeda")
        raise GagalUnggah("Header tidak sama dengan berkas acuan (" + "; ".join(rinci) + "). Harus: " + ",".join(ref["header"]))
    if jumlah == 0:
        raise GagalUnggah("Berkas tidak berisi baris data.")

    d = folder(sumber)
    d.mkdir(parents=True, exist_ok=True)
    tujuan = d / nama
    diarsip = None
    if tujuan.exists():
        arsip = d / "_arsip" / time.strftime("%Y%m%d-%H%M%S")
        arsip.mkdir(parents=True, exist_ok=True)
        shutil.move(str(tujuan), arsip / nama)
        diarsip = str((arsip / nama).relative_to(d))
    h = hashlib.sha256()
    with open(sementara, "rb") as f:
        for blok in iter(lambda: f.read(1 << 20), b""):
            h.update(blok)
    shutil.move(str(sementara), tujuan)
    os.chmod(tujuan, 0o640)
    baris = {"waktu": time.time(), "nama": nama, "ukuran": tujuan.stat().st_size, "baris": jumlah, "sha256": h.hexdigest(),
             "pengguna": pengguna, "ip": ip, "catatan": catatan[:500], "arsip_lama": diarsip, "tindakan": "unggah"}
    _log(sumber, baris)
    return baris


def arsipkan(sumber: str, nama: str, pengguna: str, ip: str | None) -> None:
    """Tarik unggahan dari pemakaian (pindah ke _arsip), supaya aset kembali ke sumber otomatis/berkas repo."""
    if sumber not in SUMBER or not NAMA_SAH.match(nama):
        raise GagalUnggah("Berkas tidak dikenal.")
    p = folder(sumber) / nama
    if not p.is_file():
        raise GagalUnggah("Berkas tidak ada.")
    arsip = folder(sumber) / "_arsip" / time.strftime("%Y%m%d-%H%M%S")
    arsip.mkdir(parents=True, exist_ok=True)
    shutil.move(str(p), arsip / nama)
    _log(sumber, {"waktu": time.time(), "nama": nama, "pengguna": pengguna, "ip": ip, "tindakan": "tarik",
                  "arsip_lama": str((arsip / nama).relative_to(folder(sumber)))})


def contoh(sumber: str, nama: str) -> bytes:
    """Templat: header + 3 baris pertama berkas acuan, supaya pengguna tahu format yang diharapkan."""
    ref = periksa_nama(sumber, nama)
    p = pengaturan.REPO / ref["path"]
    buka = gzip.open if nama.endswith(".gz") else open
    keluar = io.StringIO()
    with buka(p, "rt", encoding="utf-8-sig", newline="") as f:
        for i, b in enumerate(f):
            if i > 3:
                break
            keluar.write(b)
    return keluar.getvalue().encode("utf-8")
