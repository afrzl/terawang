"""TERAWANG K3 · Curah hujan bulanan CHIRPS per kab/kota Jatim dan provinsi (untuk eksogen SARIMAX harga GKP).

Sumber: UCSB-CHG/CHIRPS/DAILY (harian, ~5,5 km, sejak 1981) lewat Google Earth Engine.
Per bulan: jumlah hujan harian (mm/bulan), lalu dirata-rata di atas piksel lahan pertanian
(ESA WorldCover v200 kelas 40) di dalam batas FAO GAUL 2015 level 2 Jawa Timur.
Provinsi = rata-rata seluruh piksel lahan pertanian Jatim. Kolom hari_data = jumlah citra harian
pada bulan itu (bulan terakhir bisa belum lengkap; buang bila < jumlah hari kalender).
hujan_semua_mm = rata-rata semua piksel tanpa masker; bila wilayah tidak punya piksel lahan pertanian
pada grid CHIRPS (sawah_kosong=True: Pacitan, Kota Batu/Blitar/Malang), hujan_mm diisi dari kolom ini.

  python scripts/gee/chirps_bulanan.py --project terawang-515218 --mulai 2015-01 \
      --keluar data/iklim/chirps_jatim_bulanan.csv
"""
import argparse
import datetime as dt
import pathlib

import ee
import pandas as pd

SKALA = 5566


def bulan_ke_bulan(mulai: dt.date, akhir: dt.date):
    d = mulai
    while d <= akhir:
        yield d
        d = dt.date(d.year + (d.month == 12), d.month % 12 + 1, 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True)
    ap.add_argument("--mulai", default="2015-01")
    ap.add_argument("--keluar", default="data/iklim/chirps_jatim_bulanan.csv")
    ap.add_argument("--potong", type=int, default=24, help="bulan per panggilan getInfo")
    a = ap.parse_args()
    ee.Initialize(project=a.project)

    ch = ee.ImageCollection("UCSB-CHG/CHIRPS/DAILY").select("precipitation")
    akhir_ms = ch.aggregate_max("system:time_start").getInfo()
    akhir = dt.datetime.utcfromtimestamp(akhir_ms / 1000).date()
    print("CHIRPS harian terakhir:", akhir)
    y, m = map(int, a.mulai.split("-"))
    bln = list(bulan_ke_bulan(dt.date(y, m, 1), akhir.replace(day=1)))

    kab = ee.FeatureCollection("FAO/GAUL/2015/level2").filter(ee.Filter.eq("ADM1_NAME", "Jawa Timur"))
    prov = ee.FeatureCollection([ee.Feature(kab.geometry().dissolve(500), {"ADM2_NAME": "JAWA TIMUR"})])
    tani = ee.Image("ESA/WorldCover/v200/2021").eq(40)
    wil = kab.select(["ADM2_NAME"]).merge(prov)

    baris = []
    for i in range(0, len(bln), a.potong):
        pot = bln[i:i + a.potong]
        pita, hari = [], {}
        for d in pot:
            t0 = ee.Date(d.isoformat())
            c = ch.filterDate(t0, t0.advance(1, "month"))
            jml = c.sum()
            pita += [jml.updateMask(tani).rename(f"m{d:%Y%m}"), jml.rename(f"s{d:%Y%m}")]
            hari[f"m{d:%Y%m}"] = c.size()
        img = ee.Image.cat(pita)
        n = ee.Dictionary(hari).getInfo()
        hasil = img.reduceRegions(wil, ee.Reducer.mean(), SKALA, tileScale=4).getInfo()
        for f in hasil["features"]:
            p = f["properties"]
            for d in pot:
                k = f"m{d:%Y%m}"
                baris.append({"wilayah": p["ADM2_NAME"], "tahun": d.year, "bulan": d.month,
                              "hujan_mm": p.get(k), "hujan_semua_mm": p.get("s" + k[1:]),
                              "hari_data": n[k]})
        print("selesai s.d.", pot[-1])

    df = pd.DataFrame(baris)
    df["tingkat"] = (df.wilayah == "JAWA TIMUR").map({True: "provinsi", False: "kabkota"})
    # Wilayah tanpa piksel sawah pada grid ~5,5 km (kota kecil, Pacitan): pakai rata-rata semua piksel
    df["sawah_kosong"] = df.hujan_mm.isna()
    df["hujan_mm"] = df.hujan_mm.fillna(df.hujan_semua_mm)
    df[["hujan_mm", "hujan_semua_mm"]] = df[["hujan_mm", "hujan_semua_mm"]].round(1)
    out = pathlib.Path(a.keluar)
    out.parent.mkdir(parents=True, exist_ok=True)
    df.sort_values(["tingkat", "wilayah", "tahun", "bulan"]).to_csv(out, index=False)
    print("tulis", out, len(df), "baris")


if __name__ == "__main__":
    main()
