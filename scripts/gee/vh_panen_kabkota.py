"""TERAWANG K1 · Sinyal panen dari Sentinel-1 VH per kab/kota per bulan.

Untuk tiap kab/kota dan tiap bulan, pada lahan sawah (proksi: ESA WorldCover kelas 40):
  vh_median_db      median VH bulan itu (dB)
  luas_turun_ha     luas piksel yang VH-nya turun >= AMBANG_TURUN dB dibanding puncak 2 bulan sebelumnya,
                    padahal puncak itu >= AMBANG_RIMBUN dB (tajuk rapat lalu hilang = panen / olah tanah)
  luas_sawah_ha     luas lahan sawah proksi (konstan)

Pakai (butuh 'earthengine authenticate' sekali dan project Google Cloud yang sudah didaftarkan ke Earth Engine):
  python scripts/gee/vh_panen_kabkota.py --project ID_PROJECT_GEE
  hasil: data/satelit/vh_panen_bulanan_kabkota.csv (cache per kab/kota di ~/.cache/terawang-gee-vh/)

Ambang awal adalah tebakan beralasan, belum dikalibrasi ke luas panen BPS.
"""
import argparse
import csv
import datetime as dt
import json
import pathlib

import ee

WILAYAH = [
    "Pacitan", "Ponorogo", "Trenggalek", "Tulungagung", "Blitar", "Kediri", "Malang", "Lumajang", "Jember",
    "Banyuwangi", "Bondowoso", "Situbondo", "Probolinggo", "Pasuruan", "Sidoarjo", "Mojokerto", "Jombang",
    "Nganjuk", "Madiun", "Magetan", "Ngawi", "Bojonegoro", "Tuban", "Lamongan", "Gresik", "Bangkalan",
    "Sampang", "Pamekasan", "Sumenep", "Kota Kediri", "Kota Blitar", "Kota Malang", "Kota Probolinggo",
    "Kota Pasuruan", "Kota Mojokerto", "Kota Madiun", "Kota Surabaya", "Batu",
]
GAUL = {"Batu": ["Kota Batu"], "Jember": ["Jember", "Kota Jember"]}  # sama dengan terawang_wilayah.py
CACHE = pathlib.Path.home() / ".cache" / "terawang-gee-vh"
SKALA = 30
AMBANG_TURUN = 3.0    # dB
AMBANG_RIMBUN = -16.0  # dB, puncak tajuk padi


def batas(nama):
    fc = (ee.FeatureCollection("FAO/GAUL/2015/level2").filter(ee.Filter.eq("ADM1_NAME", "Jawa Timur"))
          .filter(ee.Filter.inList("ADM2_NAME", GAUL.get(nama, [nama]))))
    return fc.geometry().dissolve(100)


def bulan_ke_bulan(mulai: dt.date, akhir: dt.date):
    d = mulai
    while d <= akhir:
        yield d
        d = dt.date(d.year + (d.month == 12), d.month % 12 + 1, 1)


def hitung(nama, awal, akhir):
    aoi = batas(nama)
    sawah = ee.ImageCollection("ESA/WorldCover/v200").first().eq(40).selfMask()
    s1 = (ee.ImageCollection("COPERNICUS/S1_GRD").filterBounds(aoi).filter(ee.Filter.eq("instrumentMode", "IW"))
          .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VH")).select("VH"))

    bln = list(bulan_ke_bulan(awal, akhir))
    komposit = {}
    for d in bln:
        t0 = ee.Date(d.isoformat())
        komposit[d] = s1.filterDate(t0, t0.advance(1, "month")).median().focalMedian(30, "circle", "meters")

    luas = ee.Image.pixelArea().divide(1e4)
    pita = [luas.updateMask(sawah).rename("sawah")]
    for i, d in enumerate(bln):
        pita.append(komposit[d].updateMask(sawah).rename(f"vh_{d:%Y%m}"))
        if i >= 2:
            puncak = komposit[bln[i - 1]].max(komposit[bln[i - 2]])
            turun = puncak.subtract(komposit[d]).gte(AMBANG_TURUN).And(puncak.gte(AMBANG_RIMBUN))
            pita.append(luas.updateMask(sawah).updateMask(turun.unmask(0)).rename(f"turun_{d:%Y%m}"))
    img = ee.Image.cat(pita)
    h_sum = img.select("sawah", "turun_.*").reduceRegion(ee.Reducer.sum(), aoi, SKALA, maxPixels=1e10, tileScale=8)
    h_med = img.select("vh_.*").reduceRegion(ee.Reducer.median(), aoi, SKALA, maxPixels=1e10, tileScale=8)
    return ee.Dictionary(h_sum).combine(h_med).getInfo()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True)
    ap.add_argument("--mulai", default="2024-10-01")
    ap.add_argument("--akhir", default="2026-11-01")
    ap.add_argument("--out", default="data/satelit/vh_panen_bulanan_kabkota.csv")
    ap.add_argument("--ulang", action="store_true")
    a = ap.parse_args()
    ee.Initialize(project=a.project)
    awal, akhir = dt.date.fromisoformat(a.mulai), dt.date.fromisoformat(a.akhir)
    CACHE.mkdir(parents=True, exist_ok=True)

    baris = []
    for nama in WILAYAH:
        f = CACHE / f"{nama.lower().replace(' ', '-')}_{a.mulai}_{a.akhir}.json"
        if f.exists() and not a.ulang:
            hasil = json.loads(f.read_text())
        else:
            hasil = hitung(nama, awal, akhir)
            f.write_text(json.dumps(hasil))
        print(f"  {nama}: sawah {hasil['sawah']:,.0f} ha", flush=True)
        for d in bulan_ke_bulan(awal, akhir):
            k = f"{d:%Y%m}"
            baris.append(dict(kabkota=nama, tahun=d.year, bulan=d.month, luas_sawah_ha=round(hasil["sawah"], 1),
                              vh_median_db=None if hasil.get(f"vh_{k}") is None else round(hasil[f"vh_{k}"], 2),
                              luas_turun_ha=None if hasil.get(f"turun_{k}") is None else round(hasil[f"turun_{k}"], 1)))
    out = pathlib.Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(baris[0]))
        w.writeheader()
        w.writerows(baris)
    print(f"Tersimpan {len(baris)} baris di {out}")


if __name__ == "__main__":
    main()
