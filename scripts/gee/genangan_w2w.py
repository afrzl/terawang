"""TERAWANG K1 · Genangan tanam WALL-TO-WALL (semua piksel sawah, bukan 400 titik) per kab/kota per jendela 12 hari.

Alasan (evaluasi 24-25 Nov 2026): galat bulanan K1 (±29%) hampir seluruhnya derau sampling 400 titik per kab. Menghitung semua
piksel menghapus derau itu. Aturan sama dengan titik (nowcast_est2.py), hanya optik (Sentinel-2, Cloud Score+ >= 0,6):
  genangan(k)  = LSWI + 0,05 >= EVI  dan  EVI <= 0,35            (Xiao dkk. 2005)
  awal(k)      = genangan(k) dan tidak genangan(k-1), (k-2)      (satu kejadian per musim tanam)
  verifikasi j = jendela pertama j di 3..6 sesudah k dengan EVI >= 0,5; 0 = tidak pernah (atau tidak teramati)
Keluaran per kab per jendela k: luas (ha) awal genangan menurut j (a3, a4, a5, a6, a0) dan luas sawah yang teramati jernih (jernih).
Panen = awal + 8 jendela (96 hari) dan bobot peluang untuk verifikasi yang belum lengkap dihitung di luar GEE
(scripts/k1/nowcast_w2w.py), supaya satu tarikan bisa dipakai untuk semua jarak prakiraan.

Jendela berawan hanya terlihat sebagian. Koreksinya memakai titik sampel (rasio taksiran fusi / taksiran optik saja pada titik yang
sama), lihat nowcast_w2w.py. Masker: ESA WorldCover kelas 40 (cropland); tegalan dan tebu tidak tergenang, jadi tersaring oleh aturan.

  python scripts/gee/genangan_w2w.py --project terawang-515805 --keluar ~/.local/share/terawang/w2w [--wilayah Ngawi] [--mulai 2018-08-08]
  (cache per kab per potongan di <keluar>/_cache; aman diulang bila terputus)
"""
import argparse
import concurrent.futures as cf
import datetime as dt
import json
import pathlib
import sys
import time

import ee
import pandas as pd

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from vh_panen_kabkota import batas  # noqa: E402

AWAL = dt.date(2018, 8, 8)  # jendela pertama deret titik (vh_titik_riwayat_2018_2024)
HARI = 12
POTONG = 8  # jendela target per panggilan


def jendela(mulai, sampai):
    d = AWAL
    out = []
    while d <= sampai:
        if d >= mulai - dt.timedelta(days=HARI * 2):
            out.append(d)
        d += dt.timedelta(days=HARI)
    return out


def komposit(s2, t0):
    cs = ee.ImageCollection("GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED")
    kosong = ee.ImageCollection([ee.Image.constant([0, 0, 0, 0]).rename(["B2", "B4", "B8", "B11"]).toUint16().updateMask(0)])
    d0 = ee.Date(t0.isoformat())
    m = s2.filterDate(d0, d0.advance(HARI, "day")).linkCollection(cs, ["cs_cdf"]).map(
        lambda i: i.select(["B2", "B4", "B8", "B11"]).updateMask(i.select("cs_cdf").gte(0.6))).merge(kosong).median()
    b2, b4, b8, b11 = [m.select(b).divide(10000) for b in ("B2", "B4", "B8", "B11")]
    evi = b8.subtract(b4).multiply(2.5).divide(b8.add(b4.multiply(6)).subtract(b2.multiply(7.5)).add(1))
    lswi = b8.subtract(b11).divide(b8.add(b11))
    ok = evi.mask().And(lswi.mask()).unmask(0)
    gen = lswi.add(0.05).gte(evi).And(evi.lte(0.35)).unmask(0).And(ok)
    hijau = evi.gte(0.5).unmask(0).And(ok)
    return gen, hijau, ok


def tarik(nama, wins, idx_target, skala):
    aoi = batas(nama)
    sawah = ee.ImageCollection("ESA/WorldCover/v200").first().eq(40)
    s2 = ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED").filterBounds(aoi)
    lo, hi = min(idx_target) - 2, max(idx_target) + 6
    C = {k: komposit(s2, wins[k]) for k in range(max(lo, 0), min(hi, len(wins) - 1) + 1)}
    luas = ee.Image.pixelArea().divide(1e4).updateMask(sawah)
    pita = []
    for k in idx_target:
        gen, _, ok = C[k]
        sebelum = [C[i][0] for i in (k - 1, k - 2) if i in C]
        awal = gen
        for g in sebelum:
            awal = awal.And(g.Not())
        sudah = ee.Image.constant(0)
        kelas = []
        for j in (3, 4, 5, 6):
            hj = C[k + j][1] if (k + j) in C else ee.Image.constant(0)
            baru = hj.And(sudah.Not())
            kelas.append(awal.And(baru).rename(f"a{j}_{k}"))
            sudah = sudah.Or(hj)
        kelas.append(awal.And(sudah.Not()).rename(f"a0_{k}"))
        kelas.append(ok.rename(f"jernih_{k}"))
        pita += [c.multiply(luas) for c in kelas]
    img = ee.Image.cat(pita)
    r = img.reduceRegion(reducer=ee.Reducer.sum(), geometry=aoi, scale=skala, maxPixels=1e11, tileScale=8).getInfo()
    rows = []
    for k in idx_target:
        rows.append(dict(kabkota=nama, jendela=wins[k].isoformat(), a3=r.get(f"a3_{k}"), a4=r.get(f"a4_{k}"), a5=r.get(f"a5_{k}"),
                         a6=r.get(f"a6_{k}"), a0=r.get(f"a0_{k}"), jernih=r.get(f"jernih_{k}")))
    return rows


def coba(f, n=5):
    for i in range(n):
        try:
            return f()
        except Exception as e:  # noqa: BLE001  (batas waktu/kuota GEE: tunggu lalu ulang)
            if i == n - 1:
                raise
            print(f"    ulang ({e.__class__.__name__}: {str(e)[:120]})", flush=True)
            time.sleep(30 * (i + 1))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True)
    ap.add_argument("--keluar", required=True)
    ap.add_argument("--wilayah", default="", help="daftar dipisah koma; kosong = semua 38 wilayah")
    ap.add_argument("--mulai", default="2018-08-08")
    ap.add_argument("--sampai", default=dt.date.today().isoformat())
    ap.add_argument("--skala", type=int, default=20)
    ap.add_argument("--paralel", type=int, default=2)
    a = ap.parse_args()
    ee.Initialize(project=a.project)
    out = pathlib.Path(a.keluar).expanduser()
    (out / "_cache").mkdir(parents=True, exist_ok=True)
    mulai, sampai = dt.date.fromisoformat(a.mulai), dt.date.fromisoformat(a.sampai)
    wins = jendela(AWAL, sampai)
    target = [i for i, w in enumerate(wins) if w >= mulai and w + dt.timedelta(days=HARI) <= sampai]
    if a.wilayah:
        semua = a.wilayah.split(",")
    else:
        semua = sorted(pd.read_csv("data/satelit/vh_titik_12harian_kabkota.csv.gz", usecols=["kabkota"]).kabkota.unique())
    tugas = [(n, target[i:i + POTONG]) for n in semua for i in range(0, len(target), POTONG)]
    print(f"{len(semua)} wilayah x {len(target)} jendela = {len(tugas)} panggilan", flush=True)
    t0 = time.time()

    def kerja(t):
        nama, idx = t
        f = out / "_cache" / f"{nama.replace(' ', '_')}_{wins[idx[0]].isoformat()}.json"
        if f.exists():
            return 0
        rows = coba(lambda: tarik(nama, wins, idx, a.skala))
        f.write_text(json.dumps(rows))
        return 1

    n = 0
    with cf.ThreadPoolExecutor(a.paralel) as ex:
        for done in ex.map(kerja, tugas):
            n += 1
            if n % 20 == 0:
                print(f"  {n}/{len(tugas)} ({time.time() - t0:.0f} detik)", flush=True)
    rows = [r for f in sorted((out / "_cache").glob("*.json")) for r in json.loads(f.read_text())]
    df = pd.DataFrame(rows).drop_duplicates(["kabkota", "jendela"]).sort_values(["kabkota", "jendela"])
    df.to_csv(out / "genangan_w2w.csv.gz", index=False)
    print("tersimpan", out / "genangan_w2w.csv.gz", len(df), "baris", flush=True)


if __name__ == "__main__":
    main()
