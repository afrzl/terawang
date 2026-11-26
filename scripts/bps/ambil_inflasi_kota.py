"""TERAWANG · Inflasi bulanan per kab/kota IHK Jawa Timur dari WebAPI BPS (webapi.bps.go.id, domain 0000).

Tabel dinamis nasional yang dipakai (semua bulanan, per kab/kota IHK):
  Tahun dasar 2022=100 (Jan 2024 dst., 150 kab/kota; Jatim 11 kab/kota):
    var 1     Inflasi Bulanan (M-to-M), umum
    var 2249  Inflasi Tahunan (Y-on-Y) 150 Kabupaten/Kota
    var 2245  Indeks Harga Konsumen 150 Kabupaten/Kota
    var 2223  Inflasi M-to-M kelompok 01 Makanan, Minuman dan Tembakau (turvar 1551 kelompok, 1552 subkelompok Makanan)
    var 2250  Inflasi Y-on-Y kelompok 01 (turvar sama)
    var 2212  IHK kelompok 01 (turvar sama)
  Tahun dasar 2018=100 (2023, 90 kota; Jatim 8 kota, tanpa Tulungagung, Bojonegoro, Gresik):
    var 1     Inflasi Bulanan (M-to-M), umum
    var 1709  Indeks Harga Konsumen 90 Kota (Umum)
    var 1890  Inflasi M-to-M kelompok 01 Makanan, Minuman dan Tembakau
    var 1905  IHK kelompok 01
  Inflasi Y-on-Y 2023 tidak tersedia sebagai tabel per kota di WebAPI, jadi dihitung dari IHK 2018=100:
  yoy = (IHK_t / IHK_{t-12} - 1) * 100, dibulatkan 2 desimal (ditandai tahun_dasar "2018=100 (hitung)").

Komoditas beras per kota (andil/perubahan harga) TIDAK ada di WebAPI; yang paling dekat adalah subkelompok "Makanan"
(01.1, tanpa minuman dan rokok) -> ukuran makanan_saja_*.

Ukuran: umum_mtm, umum_yoy, umum_ihk, makanan_mtm, makanan_yoy, makanan_ihk, makanan_saja_mtm, makanan_saja_yoy,
makanan_saja_ihk. Nilai ihk berbeda tahun dasar antara 2023 (2018=100) dan 2024+ (2022=100): jangan disambung tanpa
rebasing; mtm dan yoy bisa disambung.

Tanggal rilis: BPS merilis IHK bulan t pada hari kerja pertama bulan t+1 (BRS awal bulan). Kolom tgl_rilis_asumsi = tanggal 1
bulan berikutnya; untuk fitur model, anggap nilai bulan t baru diketahui mulai tanggal itu (lag publikasi ~1 bulan).

  BPS_WEBAPI_KEY=... python scripts/bps/ambil_inflasi_kota.py [--mulai 2023] [--keluar data/bps/inflasi_kota_jatim_bulanan.csv]
Key dibaca dari env BPS_WEBAPI_KEY, tidak pernah dicetak.
"""
import argparse
import csv
import datetime as dt
import json
import os
import pathlib
import time
import urllib.request

API = "https://webapi.bps.go.id/v1/api/list/model"

# Kode BPS kab/kota IHK Jatim; label dicocokkan dengan vervar tiap tabel (kode vervar berbeda antar tabel).
KOTA = {
    "3504": ("Kab. Tulungagung", "TULUNGAGUNG"),
    "3509": ("Kab. Jember", "JEMBER"),
    "3510": ("Kab. Banyuwangi", "BANYUWANGI"),
    "3522": ("Kab. Bojonegoro", "BOJONEGORO"),
    "3525": ("Kab. Gresik", "GRESIK"),
    "3529": ("Kab. Sumenep", "SUMENEP"),
    "3571": ("Kota Kediri", "KOTA KEDIRI"),
    "3573": ("Kota Malang", "KOTA MALANG"),
    "3574": ("Kota Probolinggo", "KOTA PROBOLINGGO"),
    "3577": ("Kota Madiun", "KOTA MADIUN"),
    "3578": ("Kota Surabaya", "KOTA SURABAYA"),
}

# (var, turvar|None, ukuran, tahun_dasar, tahun_awal, tahun_akhir|None)
TABEL = [
    (1, None, "umum_mtm", "2022=100", 2024, None),
    (2249, None, "umum_yoy", "2022=100", 2024, None),
    (2245, None, "umum_ihk", "2022=100", 2024, None),
    (2223, 1551, "makanan_mtm", "2022=100", 2024, None),
    (2250, 1551, "makanan_yoy", "2022=100", 2024, None),
    (2212, 1551, "makanan_ihk", "2022=100", 2024, None),
    (2223, 1552, "makanan_saja_mtm", "2022=100", 2024, None),
    (2250, 1552, "makanan_saja_yoy", "2022=100", 2024, None),
    (2212, 1552, "makanan_saja_ihk", "2022=100", 2024, None),
    (1, None, "umum_mtm", "2018=100", 2018, 2023),
    (1709, None, "umum_ihk", "2018=100", 2018, 2023),
    (1890, 1551, "makanan_mtm", "2018=100", 2018, 2023),
    (1905, 1551, "makanan_ihk", "2018=100", 2018, 2023),
    (1890, 1552, "makanan_saja_mtm", "2018=100", 2018, 2023),
    (1905, 1552, "makanan_saja_ihk", "2018=100", 2018, 2023),
]


def panggil(path: str, key: str) -> dict:
    url = f"{API}/{path}/key/{key}/"
    for i in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "terawang-pipeline/1.0"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:
            if i == 3:  # pesan galat tanpa key
                raise RuntimeError(f"WebAPI BPS gagal: {path}: {e.__class__.__name__}: {str(e).replace(key, '***')[:200]}") from None
            time.sleep(5 * (i + 1))
    raise RuntimeError("tidak terjangkau")


def cocok_kota(label: str):
    lab = " ".join(label.upper().replace("KAB.", "KAB").split())
    for kode, (_, kunci) in KOTA.items():
        if kunci.startswith("KOTA"):
            if lab == kunci:
                return kode
        elif lab in (kunci, f"KAB {kunci}"):
            return kode
    return None


def ambil(var: int, turvar, th: int, key: str):
    """[(kode_bps, bulan 1..12, nilai)] untuk kota Jatim pada satu tabel-tahun."""
    j = panggil(f"data/lang/ind/domain/0000/var/{var}/th/{th - 1900}", key)
    dc = j.get("datacontent") or {}
    if not isinstance(dc, dict) or not dc:
        return []
    tv = "0" if turvar is None else str(turvar)
    hasil = []
    for vv in j.get("vervar", []):
        kode = cocok_kota(vv["label"])
        if not kode:
            continue
        for b in range(1, 13):
            k = f"{vv['val']}{var}{tv}{th - 1900}{b}"
            if k in dc and dc[k] not in (None, ""):
                hasil.append((kode, b, float(dc[k])))
    return hasil


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mulai", type=int, default=2023)
    ap.add_argument("--keluar", default="data/bps/inflasi_kota_jatim_bulanan.csv")
    a = ap.parse_args()
    key = os.environ.get("BPS_WEBAPI_KEY")
    if not key:
        raise SystemExit("BPS_WEBAPI_KEY belum di-set")
    sekarang = dt.date.today().year

    data = {}  # (bulan, kode, ukuran) -> (nilai, tahun_dasar, sumber)
    for var, tv, uk, dasar, awal, akhir in TABEL:
        th0 = max(awal, a.mulai - (1 if uk.endswith("_ihk") and dasar == "2018=100" else 0))  # IHK 2022 untuk yoy 2023
        for th in range(th0, min(akhir or sekarang, sekarang) + 1):
            for kode, b, v in ambil(var, tv, th, key):
                data[(f"{th}-{b:02d}", kode, uk)] = (v, dasar, f"var {var}" + (f" turvar {tv}" if tv else ""))
            time.sleep(0.3)

    # yoy 2023 dari IHK 2018=100
    for (bln, kode, uk), (v, dasar, src) in list(data.items()):
        if dasar != "2018=100" or not uk.endswith("_ihk"):
            continue
        y, m = int(bln[:4]), bln[5:]
        lalu = data.get((f"{y - 1}-{m}", kode, uk))
        if lalu and lalu[1] == "2018=100":
            uky = uk.replace("_ihk", "_yoy")
            if (bln, kode, uky) not in data:
                data[(bln, kode, uky)] = (round((v / lalu[0] - 1) * 100, 2), "2018=100 (hitung)", f"dari {src}")

    baris = []
    for (bln, kode, uk), (v, dasar, src) in data.items():
        if int(bln[:4]) < a.mulai:
            continue
        y, m = int(bln[:4]), int(bln[5:])
        rilis = dt.date(y + (m == 12), m % 12 + 1, 1)
        baris.append([bln, kode, KOTA[kode][0], uk, v, dasar, src, rilis.isoformat()])
    baris.sort(key=lambda r: (r[0], r[1], r[3]))

    # pemeriksaan: mtm hasil hitung dari IHK vs mtm terbit (selisih pembulatan <= 0.06)
    idx = {(r[0], r[1], r[3]): r[4] for r in baris}
    besar = 0
    for (bln, kode, uk), v in idx.items():
        if not uk.endswith("_mtm"):
            continue
        y, m = int(bln[:4]), int(bln[5:])
        sblm = f"{y - (m == 1)}-{(m - 2) % 12 + 1:02d}"
        ihk, ihk0 = idx.get((bln, kode, uk.replace("_mtm", "_ihk"))), idx.get((sblm, kode, uk.replace("_mtm", "_ihk")))
        if ihk and ihk0 and not (m == 1 and y == 2024):  # Jan 2024 ganti tahun dasar
            if abs((ihk / ihk0 - 1) * 100 - v) > 0.06:
                besar += 1
                print(f"  periksa: {bln} {kode} {uk} terbit {v} vs hitung {(ihk / ihk0 - 1) * 100:.2f}")

    p = pathlib.Path(a.keluar)
    p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["bulan", "kode_bps_kabkota", "kabkota", "ukuran", "nilai", "tahun_dasar", "sumber", "tgl_rilis_asumsi"])
        w.writerows(baris)
    bulan = sorted({r[0] for r in baris})
    print(f"{p}: {len(baris)} baris, {len({r[1] for r in baris})} kab/kota, {bulan[0]}..{bulan[-1]}, "
          f"ukuran {sorted({r[3] for r in baris})}; mtm vs IHK meleset: {besar}")


if __name__ == "__main__":
    main()
