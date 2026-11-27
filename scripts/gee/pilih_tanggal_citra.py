"""TERAWANG · Pilih pasangan tanggal citra (awal, terbaru) per wilayah untuk slider "Perubahan lahan sawah".

Padi butuh ±100–120 hari dari tanam sampai panen, hijau paling pekat ±50–70 HST. Jarak 3–4 pekan terlalu pendek untuk
memperlihatkan fase vegetatif, jadi skrip ini mencari per kotak contoh:

  terbaru = akuisisi Sentinel-2 paling baru yang kotaknya cerah (Cloud Score+), tidak melewati hari ini;
  awal    = akuisisi cerah 45–110 hari sebelum "terbaru" yang NDVI sawahnya paling rendah (bera/tergenang),
            sehingga kontras bera/air -> hijau paling terlihat.

Keluaran JSON {folder: {sebelum, sesudah, ndvi_sebelum, ndvi_sesudah, cerah_sebelum, cerah_sesudah}} dipakai
terawang_citra_semua.py --tanggal.

  python scripts/gee/pilih_tanggal_citra.py --project ID_PROJECT_GEE --keluar /tmp/tanggal_citra.json
"""
import argparse
import concurrent.futures as cf
import json
import math
import pathlib
from datetime import date, timedelta

import ee

LEBAR_KM, TINGGI_KM = 3.6, 2.1


def kotak(pusat):
    dlat = (TINGGI_KM / 2) / 110.574
    dlon = (LEBAR_KM / 2) / (111.320 * math.cos(math.radians(pusat[1])))
    return ee.Geometry.Rectangle([pusat[0] - dlon, pusat[1] - dlat, pusat[0] + dlon, pusat[1] + dlat], None, False)


def deret(pusat, mulai, akhir):
    """Per akuisisi S2: tanggal, fraksi cerah kotak, median NDVI piksel sawah yang cerah."""
    aoi = kotak(pusat)
    sawah = ee.ImageCollection("ESA/WorldCover/v200").first().eq(40)
    cs = ee.ImageCollection("GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED")
    kol = (ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED").filterBounds(aoi).filterDate(mulai, akhir)
           .linkCollection(cs, ["cs_cdf"]))

    def f(img):
        cerah = img.select("cs_cdf").gte(0.75)
        ndvi = img.normalizedDifference(["B8", "B4"]).updateMask(cerah.And(sawah))
        c = cerah.reduceRegion(ee.Reducer.mean(), aoi, 20, maxPixels=1e8).get("cs_cdf")
        n = ndvi.reduceRegion(ee.Reducer.median(), aoi, 20, maxPixels=1e8).get("nd")
        return ee.Feature(None, dict(t=img.date().format("YYYY-MM-dd"), c=c, n=n))
    rows = kol.map(f).filter(ee.Filter.notNull(["c", "n"])).reduceColumns(
        ee.Reducer.toList(3), ["t", "c", "n"]).get("list").getInfo()
    # satu tanggal bisa punya beberapa tile: ambil yang paling cerah
    per = {}
    for t, c, n in rows:
        if t not in per or c > per[t][0]:
            per[t] = (c, n)
    return sorted((t, c, n) for t, (c, n) in per.items())


def pilih(rows, hari_ini, min_jarak, maks_jarak):
    d = lambda s: date.fromisoformat(s)
    terbaru = None
    for ambang in (0.95, 0.85, 0.7, 0.5):
        kand = [r for r in rows if r[1] >= ambang and (hari_ini - d(r[0])).days <= 40]
        if kand:
            terbaru = kand[-1]
            break
    if not terbaru:
        return None
    for ambang in (0.95, 0.85, 0.7, 0.5):
        kand = [r for r in rows if r[1] >= ambang and min_jarak <= (d(terbaru[0]) - d(r[0])).days <= maks_jarak]
        if kand:
            awal = min(kand, key=lambda r: r[2])
            return dict(sebelum=awal[0], sesudah=terbaru[0], ndvi_sebelum=round(awal[2], 3),
                        ndvi_sesudah=round(terbaru[2], 3), cerah_sebelum=round(awal[1], 2),
                        cerah_sesudah=round(terbaru[1], 2), jarak_hari=(d(terbaru[0]) - d(awal[0])).days)
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True)
    ap.add_argument("--data", default="src/lib/gee_wilayah.json")
    ap.add_argument("--keluar", default="tanggal_citra.json")
    ap.add_argument("--min-jarak", type=int, default=45)
    ap.add_argument("--maks-jarak", type=int, default=110)
    ap.add_argument("--paralel", type=int, default=6)
    ap.add_argument("--hanya", help="daftar nama dipisah koma; hasil digabung ke berkas --keluar yang sudah ada")
    a = ap.parse_args()
    ee.Initialize(project=a.project)

    hari_ini = date.today()
    mulai = (hari_ini - timedelta(days=a.maks_jarak + 45)).isoformat()
    akhir = (hari_ini + timedelta(days=1)).isoformat()
    wilayah = [w for w in json.loads(pathlib.Path(a.data).read_text())["wilayah"] if w.get("pusat")]
    if a.hanya:
        wilayah = [w for w in wilayah if w["n"] in a.hanya.split(",")]

    def jalan(w):
        try:
            rows = deret(w["pusat"], mulai, akhir)
            return w, rows, pilih(rows, hari_ini, a.min_jarak, a.maks_jarak), ""
        except Exception as e:  # noqa: BLE001
            return w, [], None, str(e)[:200]

    hasil = json.loads(pathlib.Path(a.keluar).read_text()) if a.hanya and pathlib.Path(a.keluar).exists() else {}
    with cf.ThreadPoolExecutor(a.paralel) as ex:
        for w, rows, p, err in ex.map(jalan, wilayah):
            folder = w["n"].lower().replace(" ", "-")
            if p:
                p["deret"] = rows
                hasil[folder] = p
                print(f"  ✓ {w['n']}: {p['sebelum']} (NDVI {p['ndvi_sebelum']}) -> {p['sesudah']} "
                      f"(NDVI {p['ndvi_sesudah']}), {p['jarak_hari']} hari", flush=True)
            else:
                print(f"  ✗ {w['n']}: tidak ada pasangan cerah {err}", flush=True)
    pathlib.Path(a.keluar).write_text(json.dumps(hasil, indent=1, ensure_ascii=False))
    print(f"Selesai: {len(hasil)}/{len(wilayah)} wilayah -> {a.keluar}")


if __name__ == "__main__":
    main()
