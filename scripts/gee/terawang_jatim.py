"""TERAWANG · Lapisan satu provinsi Jawa Timur untuk peta MapLibre di Ringkasan.

Keluaran di <OUT>/ (default public/citra/jatim/):
  kab.geojson      batas 38 kab/kota (FAO GAUL 2015, sama dengan terawang_wilayah.py), simplify 100 m, properti n
  s2_okt.png       Sentinel-2 SR median 1–30 Okt 2026 (Cloud Score+ ≥ 0,6), warna alami
  fase.png         kelas fase tumbuh per piksel sawah pada tanggal acuan (logika terawang_wilayah.kelas_fase)
  vh_selisih.png   VH 12 hari terakhir musim ini − rata-rata periode sama 2023–25, sawah saja
  index.json       daftar lapisan: id, label, file, bounds [W,S,E,N], legenda, sumber

PNG ber-CRS EPSG:3857, transparan di luar Jawa Timur (dan di luar BBOX: Bawean, Masalembu, Kangean tidak ikut).

  python scripts/gee/terawang_jatim.py --project ID_PROJECT_GEE
"""
import argparse
import json
import pathlib
import sys

import ee
import requests

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import terawang_wilayah as tw  # noqa: E402

BBOX = [110.85, -8.85, 114.65, -6.75]  # Jawa Timur daratan + Madura
LEBAR = 2200
FASE = [("C9B28A", "Bera"), ("2F7FB8", "Olah tanah/genangan"), ("8BC34A", "Vegetatif"),
        ("2E7D32", "Generatif"), ("E3B505", "Siap panen")]
VH_PAL = ["8C510A", "D8B365", "F6E8C3", "F5F5F5", "C7EAE5", "5AB4AC", "01665E"]


def unduh(url, path):
    r = requests.get(url, timeout=600)
    r.raise_for_status()
    path.write_bytes(r.content)
    print(f"  ✓ {path}  ({len(r.content) / 1024:.0f} KB)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True)
    ap.add_argument("--acuan", default="2026-10-30")
    ap.add_argument("--out", default="public/citra/jatim")
    a = ap.parse_args()
    ee.Initialize(project=a.project)
    out = pathlib.Path(a.out)
    out.mkdir(parents=True, exist_ok=True)

    # 1. batas kab/kota
    feats = [ee.Feature(tw.batas(n).simplify(100), {"n": n}) for n in tw.WILAYAH]
    kab = ee.FeatureCollection(feats)
    gj = kab.getInfo()
    def poligon(g):  # dissolve kadang menghasilkan GeometryCollection; ambil poligonnya saja
        if g["type"] == "Polygon":
            return [g["coordinates"]]
        if g["type"] == "MultiPolygon":
            return g["coordinates"]
        if g["type"] == "GeometryCollection":
            return [p for x in g["geometries"] for p in poligon(x)]
        return []

    def geom(g):
        ps = poligon(g)
        return {"type": "Polygon", "coordinates": ps[0]} if len(ps) == 1 else {"type": "MultiPolygon", "coordinates": ps}

    gj = {"type": "FeatureCollection",
          "features": [{"type": "Feature", "properties": f["properties"], "geometry": geom(f["geometry"])}
                       for f in gj["features"]]}
    kosong = [f["properties"]["n"] for f in gj["features"] if not f["geometry"]["coordinates"]]
    (out / "kab.geojson").write_text(json.dumps(gj, separators=(",", ":"), ensure_ascii=False))
    print(f"  ✓ kab.geojson  {len(gj['features'])} fitur" + (f"; geometri kosong: {kosong}" if kosong else ""))

    region = ee.Geometry.Rectangle(BBOX, None, False)
    jatim = ee.FeatureCollection("FAO/GAUL/2015/level1").filter(ee.Filter.eq("ADM1_NAME", "Jawa Timur"))
    mask = ee.Image(0).byte().paint(jatim, 1).selfMask()
    thumb = dict(region=region, dimensions=LEBAR, crs="EPSG:3857", format="png")
    d = ee.Date(a.acuan)
    sawah = tw.sawah_mask(region, a.acuan)

    # 2a. Sentinel-2 Oktober
    cs = ee.ImageCollection("GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED")
    rgb = (ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED").filterBounds(region).filterDate("2026-10-01", "2026-10-31")
           .linkCollection(cs, ["cs_cdf"])
           .map(lambda i: i.select(["B4", "B3", "B2"]).divide(10000).updateMask(i.select("cs_cdf").gte(0.6)))
           .median())
    unduh(rgb.updateMask(mask).visualize(bands=["B4", "B3", "B2"], min=0.02, max=0.24, gamma=1.25)
          .getThumbURL(thumb), out / "s2_okt.png")

    # 2b. fase tumbuh
    kelas, _ = tw.kelas_fase(region, a.acuan)
    fase = kelas.updateMask(sawah).updateMask(mask)
    unduh(fase.visualize(min=0, max=4, palette=[c for c, _ in FASE]).getThumbURL(thumb), out / "fase.png")

    # 2c. selisih VH
    def vh(t):
        return tw.s1(region, t.advance(-12, "day"), t).select("VH").mean()
    kini = vh(d)
    dulu = ee.ImageCollection([vh(d.advance(-j, "year")) for j in (1, 2, 3)]).mean()
    sel = kini.subtract(dulu).updateMask(sawah).updateMask(mask)
    unduh(sel.visualize(min=-4, max=4, palette=VH_PAL).getThumbURL(thumb), out / "vh_selisih.png")

    sumber = "Google Earth Engine · FAO GAUL 2015 · ESA WorldCover v200 (proksi sawah)"
    idx = [
        dict(id="s2_okt", label="Citra Sentinel-2 Oktober 2026", file="s2_okt.png", bounds=BBOX,
             legenda=[], sumber="Copernicus Sentinel-2 SR median 1–30 Okt 2026, Cloud Score+ ≥ 0,6 · " + sumber),
        dict(id="fase", label=f"Fase tumbuh padi {a.acuan}", file="fase.png", bounds=BBOX,
             legenda=[["#" + c, l] for c, l in FASE],
             sumber="Sentinel-2 NDVI/LSWI (kini vs 30 hari sebelumnya) + Sentinel-1 VV, aturan ambang · " + sumber),
        dict(id="vh_selisih", label="Selisih radar VH vs rata-rata 2023–25", file="vh_selisih.png", bounds=BBOX,
             legenda=[["#8C510A", "≤ −4 dB (lebih rendah: genangan/bera)"], ["#F5F5F5", "0 dB"],
                      ["#01665E", "≥ +4 dB (lebih tinggi: tanaman lebih rapat)"]],
             sumber=f"Sentinel-1 GRD VH, rata-rata 12 hari s.d. {a.acuan} dikurangi periode sama 2023–25 · " + sumber),
    ]
    (out / "index.json").write_text(json.dumps(idx, indent=2, ensure_ascii=False))
    print("Selesai.")


if __name__ == "__main__":
    main()
