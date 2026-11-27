"""Pratinjau data terkini tiap sumber: berkas yang dipakai materialisasi terakhir aset bronze (dari metadata `berkas`),
dengan beberapa baris pertama dan unduhan. Hanya berkas yang tercantum di metadata dan berada di folder data TERAWANG
yang bisa dibaca, supaya endpoint ini tidak bisa dipakai membaca berkas lain di server.

Konektor menimpa berkas di tempat, jadi yang tersedia hanya versi terakhir; versi lama tidak disimpan.
"""
from __future__ import annotations

import collections
import csv
import heapq
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
    for k in ("TERAWANG_DATA_DIR", "TERAWANG_HARGA_DIR", "TERAWANG_TITIK_DIR", "TERAWANG_K1_DIR", "TERAWANG_MANUAL_DIR", "TERAWANG_BAPANAS_DIR",
              "TERAWANG_IKLIM_DIR"):
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


TANGGAL = re.compile(r"^\d{4}-\d{2}(-\d{2})?")


def _kunci_waktu(kolom: list[str], contoh: list[str] | None):
    """Fungsi kunci urutan waktu untuk satu baris, beserta nama kolomnya: kolom tanggal ISO (mis. `tanggal`) atau
    pasangan `tahun`/`bulan`. None kalau berkas tidak punya kolom waktu."""
    if contoh:
        for c, nama in enumerate(kolom):
            if c < len(contoh) and TANGGAL.match(contoh[c] or ""):
                return (lambda r, c=c: r[c][:10] if c < len(r) and TANGGAL.match(r[c] or "") else ""), nama
    rendah = [k.strip().lower() for k in kolom]
    if "tahun" in rendah:
        ct, cb = rendah.index("tahun"), rendah.index("bulan") if "bulan" in rendah else None

        def kunci(r):
            try:
                t = int(float(r[ct]))
                b = int(float(r[cb])) if cb is not None and r[cb] else 0
                return f"{t:04d}-{b:02d}" if b else f"{t:04d}"
            except (ValueError, IndexError):
                return ""
        return kunci, "tahun" + ("/bulan" if cb is not None else "")
    return None, None


def pratinjau(sid: str, i: int, n: int = 50, urut: str = "terbaru") -> dict:
    """n baris dari berkas. urut=terbaru: baris dengan waktu paling akhir dulu (kalau ada kolom tanggal/tahun, kalau
    tidak ada: akhir berkas); urut=awal: baris pertama berkas. Juga mengembalikan rentang waktu seluruh berkas."""
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
            pindai = b["ukuran"] * (5 if p.name.endswith(".gz") else 1) <= BATAS_HITUNG
            awal: list[tuple[int, list[str]]] = []
            ekor: collections.deque = collections.deque(maxlen=n)
            terbaru: list = []
            kunci = nama_kunci = None
            kmin = kmax = None
            jumlah = 0
            for row in r:
                jumlah += 1
                if jumlah == 1:
                    kunci, nama_kunci = _kunci_waktu(kolom, row)
                if len(awal) < n:
                    awal.append((jumlah, row))
                elif not pindai:
                    break
                if not pindai:
                    continue
                ekor.append((jumlah, row))
                if kunci:
                    k = kunci(row)
                    if k:
                        kmin = k if kmin is None or k < kmin else kmin
                        kmax = k if kmax is None or k > kmax else kmax
                    item = (k, jumlah, row)
                    if len(terbaru) < n:
                        heapq.heappush(terbaru, item)
                    elif item > terbaru[0]:
                        heapq.heapreplace(terbaru, item)
    except (UnicodeDecodeError, OSError, csv.Error) as e:
        raise GagalData(f"Berkas tidak bisa dibaca sebagai CSV: {e}")
    if urut == "terbaru" and pindai:
        if kunci:
            pilih = [(no, row) for _, no, row in sorted(terbaru, reverse=True)]
        else:
            pilih = list(reversed(ekor))
        urut_dipakai = "terbaru" if kunci else "akhir"
    else:
        pilih, urut_dipakai = awal, "awal"
    return {**info, "jenis": "csv", "kolom": kolom, "baris": [row for _, row in pilih], "nomor": [no for no, _ in pilih],
            "total": jumlah if pindai else None, "urut": urut_dipakai,
            "rentang": {"kolom": nama_kunci, "min": kmin, "max": kmax} if kmin else None}


def path_unduh(sid: str, i: int) -> Path:
    return _ambil(sid, i)["_path"]
