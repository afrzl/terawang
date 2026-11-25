"""Pratinjau data terkini tiap sumber: berkas yang dipakai materialisasi terakhir aset bronze (dari metadata `berkas`),
dengan beberapa baris pertama dan unduhan. Hanya berkas yang tercantum di metadata dan berada di folder data TERAWANG
yang bisa dibaca, supaya endpoint ini tidak bisa dipakai membaca berkas lain di server.

Konektor menimpa berkas di tempat, jadi yang tersedia hanya versi terakhir; versi lama tidak disimpan.
"""
from __future__ import annotations

import csv
import gzip
import io
import re
from pathlib import Path

from . import dagster, envfile, pengaturan, sumber

Q_BERKAS = """
query($k: AssetKeyInput!) {
  assetOrError(assetKey: $k) { __typename ... on Asset {
    assetMaterializations(limit: 1) { timestamp runId tags { key value }
      metadataEntries { label ... on MarkdownMetadataEntry { mdStr } } } } }
}"""

BARIS_BERKAS = re.compile(r"^\s*-\s*`([^`]+)`\s*(?:\((.+)\))?\s*$")
EKSTENSI = (".csv", ".csv.gz", ".json")
BATAS_HITUNG = 25 * 1024 * 1024  # berkas lebih besar dari ini tidak dihitung barisnya (gz dihitung dari ukuran terkompresi / 5)
BARIS_MAKS = 500


class GagalData(ValueError):
    pass


def _akar_diizinkan() -> list[Path]:
    akar = [pengaturan.REPO, pengaturan.RUMAH / ".local/share/terawang", pengaturan.MANUAL_DIR]
    env_path = pengaturan.BERKAS_ENV.get("pipeline")
    env = envfile.baca(env_path) if env_path and env_path.exists() else {}
    for k in ("TERAWANG_DATA_DIR", "TERAWANG_HARGA_DIR", "TERAWANG_TITIK_DIR", "TERAWANG_K1_DIR", "TERAWANG_MANUAL_DIR"):
        if env.get(k):
            akar.append(Path(env[k]).expanduser())
    return [a.resolve() for a in akar]


def _tampil(p: Path) -> str:
    repo = pengaturan.REPO.resolve()
    if p.is_relative_to(repo):
        return "repo/" + str(p.relative_to(repo))
    if p.is_relative_to(pengaturan.RUMAH):
        return "~/" + str(p.relative_to(pengaturan.RUMAH))
    return str(p)


def _aset_sumber(sid: str) -> list[str]:
    for h in sumber.halaman():
        if h["id"] == sid:
            return h["aset"]
    raise GagalData("Sumber tidak dikenal.")


def daftar(sid: str) -> dict:
    """Berkas yang dipakai materialisasi terakhir tiap aset sumber ini."""
    akar = _akar_diizinkan()
    hasil, mats = [], []
    for aset in _aset_sumber(sid):
        d = dagster.graphql(Q_BERKAS, {"k": {"path": aset.split("/")}})["assetOrError"]
        if d.get("__typename") != "Asset" or not d["assetMaterializations"]:
            continue
        m = d["assetMaterializations"][0]
        tag = {t["key"]: t["value"] for t in m["tags"]}
        mats.append({"aset": aset, "waktu": float(m["timestamp"]) / 1000, "runId": m["runId"],
                     "versi": (tag.get("dagster/data_version") or "")[:16]})
        md = next((e.get("mdStr") for e in m["metadataEntries"] if e["label"] == "berkas"), None) or ""
        for baris in md.splitlines():
            cocok = BARIS_BERKAS.match(baris)
            if not cocok:
                continue
            p = Path(cocok.group(1))
            p = (p if p.is_absolute() else pengaturan.REPO / p).resolve()
            if not any(p.is_relative_to(a) for a in akar) or not p.name.endswith(EKSTENSI):
                continue
            ada = p.is_file()
            st = p.stat() if ada else None
            hasil.append({"aset": aset, "nama": p.name, "lokasi": _tampil(p.parent), "asal": (cocok.group(2) or "").strip() or None,
                          "ada": ada, "ukuran": st.st_size if st else None, "waktu": st.st_mtime if st else None, "_path": p})
    for i, b in enumerate(hasil):
        b["i"] = i
    return {"materialisasi": mats, "berkas": hasil}


def _ambil(sid: str, i: int) -> dict:
    berkas = daftar(sid)["berkas"]
    if not 0 <= i < len(berkas):
        raise GagalData("Berkas tidak ditemukan. Segarkan halaman.")
    b = berkas[i]
    if not b["ada"]:
        raise GagalData("Berkas sudah tidak ada di server.")
    return b


def publik(d: dict) -> dict:
    return {**d, "berkas": [{k: v for k, v in b.items() if not k.startswith("_")} for b in d["berkas"]]}


def _buka(p: Path):
    return gzip.open(p, "rt", encoding="utf-8-sig", newline="") if p.name.endswith(".gz") else open(p, encoding="utf-8-sig", newline="")


def pratinjau(sid: str, i: int, n: int = 50) -> dict:
    b = _ambil(sid, i)
    p: Path = b["_path"]
    n = max(1, min(int(n), BARIS_MAKS))
    info = {k: v for k, v in b.items() if not k.startswith("_")}
    if p.name.endswith(".json"):
        with open(p, encoding="utf-8") as f:
            teks = f.read(200_000)
        return {**info, "jenis": "json", "teks": teks, "terpotong": b["ukuran"] > 200_000}
    try:
        with _buka(p) as f:
            r = csv.reader(f)
            kolom = next(r, [])
            hitung = b["ukuran"] * (5 if p.name.endswith(".gz") else 1) <= BATAS_HITUNG
            baris, jumlah = [], 0
            for row in r:
                jumlah += 1
                if len(baris) < n:
                    baris.append(row)
                elif not hitung:
                    break
            total = jumlah if hitung else None
    except (UnicodeDecodeError, OSError, csv.Error) as e:
        raise GagalData(f"Berkas tidak bisa dibaca sebagai CSV: {e}")
    return {**info, "jenis": "csv", "kolom": kolom, "baris": baris, "total": total}


def path_unduh(sid: str, i: int) -> Path:
    return _ambil(sid, i)["_path"]
