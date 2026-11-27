"""TERAWANG · Pilih titik pusat kotak citra di hamparan sawah irigasi terpadat tiap wilayah.

Versi lama (terawang_wilayah.py) memakai kepadatan ESA WorldCover kelas 40 (cropland) saja. Kelas itu juga
mencakup tegalan, kebun tebu, dan jagung lahan kering, sehingga di kabupaten bertegalan luas (mis. Situbondo
bagian timur dekat Baluran) titik terpadat jatuh di lahan kering yang cokelat sepanjang kemarau.

Di sini piksel dihitung "sawah irigasi" bila:
  1. WorldCover kelas 40 (cropland),
  2. pernah tergenang dalam 12 bulan terakhir: median VV Sentinel-1 bulanan (dihaluskan 30 m) < AMBANG_VV dB
     paling tidak satu bulan. Genangan olah tanah/tanam adalah ciri khas sawah; tegalan tidak pernah tergenang,
  3. pernah hijau pekat: NDVI Sentinel-2 bulanan maksimum >= 0,6 (membuang tambak/rawa),
  4. bukan air permanen: JRC Global Surface Water occurrence < 30%.
Titik pusat = puncak kepadatan sawah irigasi dalam radius 1 km (kotak contoh 3,6 x 2,1 km).

Hasil menimpa kolom "pusat" di src/lib/gee_wilayah.json; titik lama disimpan di "pusat_lama" bila bergeser.
Kolom lain (luas, fase, profil VH) tidak diubah.

  python scripts/gee/pilih_pusat_sawah.py --project ID_PROJECT_GEE [--hanya Situbondo,Banyuwangi]
"""
import argparse
import concurrent.futures as cf
import json
import math
import pathlib
import time

import ee

AMBANG_VV = -15.0
RADIUS_M = 1000
SKALA = 100
GAUL = {"Batu": ["Kota Batu"], "Jember": ["Jember", "Kota Jember"]}


def batas(nama):
    fc = (ee.FeatureCollection("FAO/GAUL/2015/level2")
          .filter(ee.Filter.eq("ADM1_NAME", "Jawa Timur"))
          .filter(ee.Filter.inList("ADM2_NAME", GAUL.get(nama, [nama]))))
    return fc.geometry().dissolve(100)


def sawah_irigasi(aoi, acuan):
    d = ee.Date(acuan)
    crop = ee.ImageCollection("ESA/WorldCover/v200").first().eq(40)
    cs = ee.ImageCollection("GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED")
    s2 = (ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED").filterBounds(aoi)
          .filterDate(d.advance(-12, "month"), d).linkCollection(cs, ["cs_cdf"]))
    s1 = (ee.ImageCollection("COPERNICUS/S1_GRD").filterBounds(aoi).filterDate(d.advance(-12, "month"), d)
          .filter(ee.Filter.eq("instrumentMode", "IW"))
          .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VV")).select("VV"))

    def bulan(m):
        a = d.advance(ee.Number(m).subtract(12), "month")
        b = a.advance(1, "month")
        vv = s1.filterDate(a, b).median().focalMedian(30, "circle", "meters").rename("vv")
        return vv.set("m", m)

    vv_min = ee.ImageCollection.fromImages(ee.List.sequence(0, 11).map(bulan)).min()
    ndvi_max = (s2.map(lambda i: i.updateMask(i.select("cs_cdf").gte(0.6))
                       .normalizedDifference(["B8", "B4"]).rename("ndvi"))
                .reduce(ee.Reducer.percentile([95])).rename("ndvi"))
    air = ee.Image("JRC/GSW1_4/GlobalSurfaceWater").select("occurrence").unmask(0).lt(30)
    return crop.And(vv_min.lt(AMBANG_VV)).And(ndvi_max.gte(0.6)).And(air).unmask(0).rename("sawah")


def kotak(pusat, lebar_km=3.6, tinggi_km=2.1):
    dlat = (tinggi_km / 2) / 110.574
    dlon = (lebar_km / 2) / (111.320 * math.cos(math.radians(pusat[1])))
    return ee.Geometry.Rectangle([pusat[0] - dlon, pusat[1] - dlat, pusat[0] + dlon, pusat[1] + dlat], None, False)


def hitung(nama, acuan, pusat_lama):
    aoi = batas(nama)
    sawah = sawah_irigasi(aoi, acuan).clip(aoi)
    padat = sawah.focalMean(RADIUS_M, "circle", "meters").rename("padat")
    top = padat.addBands(ee.Image.pixelLonLat()).reduceRegion(ee.Reducer.max(3), aoi, SKALA, maxPixels=1e10,
                                                                tileScale=8)
    out = dict(top=top)
    if pusat_lama:
        out["lama"] = sawah.reduceRegion(ee.Reducer.mean(), kotak(pusat_lama), 30, maxPixels=1e9, tileScale=4)
    return ee.Dictionary(out).getInfo()


def jarak_km(a, b):
    dx = (a[0] - b[0]) * 111.32 * math.cos(math.radians(a[1]))
    dy = (a[1] - b[1]) * 110.574
    return math.hypot(dx, dy)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True)
    ap.add_argument("--data", default="src/lib/gee_wilayah.json")
    ap.add_argument("--acuan", default="2026-11-25")
    ap.add_argument("--hanya", help="daftar nama dipisah koma")
    ap.add_argument("--min-geser", type=float, default=1.0, help="km; geser lebih kecil dianggap tetap")
    ap.add_argument("--paralel", type=int, default=6)
    a = ap.parse_args()
    ee.Initialize(project=a.project)

    p = pathlib.Path(a.data)
    data = json.loads(p.read_text())
    hanya = set(a.hanya.split(",")) if a.hanya else None
    wilayah = [w for w in data["wilayah"] if (hanya is None or w["n"] in hanya)]

    def kerja(w):
        for coba in range(3):
            try:
                return w, hitung(w["n"], a.acuan, w.get("pusat")), ""
            except Exception as e:  # noqa: BLE001
                err = str(e)[:200]
                time.sleep(5 * (coba + 1))
        return w, None, err

    geser = []
    with cf.ThreadPoolExecutor(a.paralel) as ex:
        for w, r, err in ex.map(kerja, wilayah):
            if r is None:
                print(f"  ✗ {w['n']}: {err}", flush=True)
                continue
            t = r["top"]
            if not t.get("max"):
                print(f"  - {w['n']}: tidak ada piksel sawah irigasi, titik tetap", flush=True)
                continue
            baru = [round(t["max1"], 5), round(t["max2"], 5)]
            lama = w.get("pusat")
            fr_lama = (r.get("lama") or {}).get("sawah")
            km = jarak_km(baru, lama) if lama else float("inf")
            ket = (f"sawah irigasi di kotak lama {100 * (fr_lama or 0):.0f}%, puncak baru {100 * t['max']:.0f}%")
            if km >= a.min_geser:
                w["pusat_lama"] = lama
                w["pusat"] = baru
                geser.append(w["n"])
                print(f"  → {w['n']}: geser {km:.1f} km ke {baru} ({ket})", flush=True)
            else:
                print(f"  = {w['n']}: tetap ({ket})", flush=True)

    p.write_text(json.dumps(data, indent=1, ensure_ascii=False))
    print(f"Selesai. {len(geser)} wilayah bergeser: {','.join(geser)}")


if __name__ == "__main__":
    main()
