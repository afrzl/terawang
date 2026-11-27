"""TERAWANG · Citra sebelum–sesudah tanam (versi Python dari terawang_citra_tanam.js).

Menghasilkan PNG untuk slider halaman Produksi, petak.geojson, citra_10m.tif, dan meta.json,
lalu menyimpannya ke  <OUT>/<folder>/  serta memperbarui <OUT>/index.json.

Pakai:
  pip install earthengine-api requests
  earthengine authenticate          # sekali saja, login Google di browser
  python terawang_citra_tanam.py --project ID_PROJECT_GEE --lokasi Ngawi --out ../../public/citra
  # lokasi lain:   --lokasi Bondowoso    atau    --pusat 113.80,-7.97 --lokasi Bondowoso
  # label acak:    --mode dummy

Citra Sentinel-1/2 asli; "petak" = segmen SNIC (bukan batas persil); label = aturan ambang
atau acak (dummy), belum divalidasi lapangan.
"""
import argparse
from datetime import date
import json
import math
import pathlib

import ee
import requests

PRESET = {
    "Ngawi": [111.450, -7.500],
    "Bondowoso": [113.800, -7.970],
    "Jember": [113.530, -8.230],
    "Lamongan": [112.370, -7.130],
}
LEBAR_KM, TINGGI_KM = 3.6, 2.1
JENDELA = 12
HARI_INI = date.today().isoformat()
DUMMY = dict(genang=0.55, tanamDariGenang=0.78, tanamDariKering=0.25)
AMBANG = dict(ndviTanam=0.35, naikNdvi=0.10, vvAir=-15, naikVh=3)
UKURAN_PETAK_PX = 6
LEBAR_PNG = 1440
WARNA = dict(kering="A8865B", genang="2F7FB8", tanam="3E9B4F", tertinggal="E5484D")
BAND_S2 = ["B2", "B3", "B4", "B8", "B11"]
# Cloud Score+ cs_cdf: 0,6 masih meloloskan kabut tipis/tepi awan (bercak abu-kebiruan di citra). 0,75 lebih ketat.
AMBANG_CS = 0.75
# Sentinel-1 lewat tiap 6-12 hari: jendela S2 yang sempit (mis. ±1 hari) sering tidak memuat akuisisi radar
JENDELA_S1_MIN = 6


def kotak(pusat):
    dlat = (TINGGI_KM / 2) / 110.574
    dlon = (LEBAR_KM / 2) / (111.320 * math.cos(math.radians(pusat[1])))
    bbox = [pusat[0] - dlon, pusat[1] - dlat, pusat[0] + dlon, pusat[1] + dlat]
    return ee.Geometry.Rectangle(bbox, None, False), [round(v, 6) for v in bbox]


def rentang(tgl, hari):
    """Jendela tgl ± hari, tapi tidak melewati hari ini (citra masa depan belum ada, label jadi menyesatkan)."""
    d = ee.Date(tgl)
    akhir = ee.Date(ee.Algorithms.If(d.advance(hari + 1, "day").millis().gt(ee.Date(HARI_INI).millis()),
                                     ee.Date(HARI_INI), d.advance(hari + 1, "day")))
    return d.advance(-hari, "day"), akhir


def koleksi_s2(aoi, tgl, hari, bersih):
    cs = ee.ImageCollection("GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED")
    awal, akhir = rentang(tgl, hari)
    kol = (ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
           .filterBounds(aoi)
           .filterDate(awal, akhir)
           .linkCollection(cs, ["cs_cdf"]))

    def f(img):
        s = img.select(BAND_S2).divide(10000).addBands(img.select("cs_cdf"))
        if bersih:
            s = s.updateMask(img.select("cs_cdf").gte(AMBANG_CS))
        return s.copyProperties(img, ["system:time_start"])
    return kol.map(f)


def tanggal_cerah(aoi, tgl, hari, min_cerah=0.3):
    """Tanggal akuisisi S2 di jendela yang kotaknya cukup cerah (Cloud Score+ >= AMBANG_CS), untuk label yang jujur."""
    cs = ee.ImageCollection("GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED")
    awal, akhir = rentang(tgl, hari)
    kol = (ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED").filterBounds(aoi).filterDate(awal, akhir)
           .linkCollection(cs, ["cs_cdf"]))

    def f(img):
        c = img.select("cs_cdf").gte(AMBANG_CS).reduceRegion(ee.Reducer.mean(), aoi, 20, maxPixels=1e8).get("cs_cdf")
        return ee.Feature(None, dict(t=img.date().format("YYYY-MM-dd"), c=c))
    fc = kol.map(f).filter(ee.Filter.gte("c", min_cerah))
    return fc.aggregate_array("t").distinct().sort()


def komposit_s2(aoi, tgl):
    sempit = koleksi_s2(aoi, tgl, JENDELA, True)
    lebar = koleksi_s2(aoi, tgl, 30, True)
    mentah = koleksi_s2(aoi, tgl, 30, False)
    # Per piksel ambil pengamatan paling cerah (qualityMosaic), bukan median: median mencampur citra berkabut tipis
    # dengan citra cerah sehingga muncul bercak abu-kebiruan bertepi kotak.
    analisis = sempit.qualityMosaic("cs_cdf").select(BAND_S2)
    tampil = (analisis.unmask(lebar.qualityMosaic("cs_cdf").select(BAND_S2))
              .unmask(mentah.qualityMosaic("cs_cdf").select(BAND_S2)))
    return analisis, tampil, sempit.size()


def komposit_s1(aoi, tgl):
    awal, akhir = rentang(tgl, max(JENDELA, JENDELA_S1_MIN))
    kol = (ee.ImageCollection("COPERNICUS/S1_GRD")
           .filterBounds(aoi)
           .filterDate(awal, akhir)
           .filter(ee.Filter.eq("instrumentMode", "IW"))
           .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VV"))
           .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VH"))
           .select(["VV", "VH"]))
    return kol.median().focalMedian(30, "circle", "meters"), kol.size()


def indeks(s2):
    return ee.Image.cat([s2.normalizedDifference(["B8", "B4"]).rename("ndvi"),
                         s2.normalizedDifference(["B8", "B11"]).rename("lswi")])


def genang(ix, s1):
    dari_s2 = ix.select("lswi").add(0.05).gte(ix.select("ndvi")).And(ix.select("ndvi").lt(0.3))
    dari_s1 = s1.select("VV").lt(AMBANG["vvAir"])
    return dari_s2.unmask(dari_s1).rename("genang")


def vis(s2):
    return s2.visualize(bands=["B4", "B3", "B2"], min=0.02, max=0.24, gamma=1.25)


def vis_radar(s1):
    rasio = s1.select("VV").subtract(s1.select("VH")).rename("rasio")
    return s1.addBands(rasio).visualize(bands=["VV", "VH", "rasio"], min=[-20, -26, 2], max=[-3, -10, 14])


def proses(pusat, nama, tgl_b, tgl_s, mode, asset_sawah):
    aoi, bbox = kotak(pusat)
    sb_a, sb_t, n_s2b = komposit_s2(aoi, tgl_b)
    ss_a, ss_t, n_s2s = komposit_s2(aoi, tgl_s)
    rb, n_s1b = komposit_s1(aoi, tgl_b)
    rs, n_s1s = komposit_s1(aoi, tgl_s)
    ib, is_ = indeks(sb_a), indeks(ss_a)

    genang_b = genang(ib, rb)
    # bagian kotak yang berawan di komposit analisis diisi NDVI komposit tampilan (jendela lebar), agar tiap petak
    # tetap punya nilai "hijau awal" dan statistik belum_hijau_sebelum_pct tidak bolong
    hijau_b = (ib.select("ndvi").unmask(indeks(sb_t).select("ndvi"))
               .gte(AMBANG["ndviTanam"]).rename("hijau_b"))
    genang_s = genang(is_, rs)
    tanam_s2 = is_.select("ndvi").gte(AMBANG["ndviTanam"]).And(
        is_.select("ndvi").subtract(ib.select("ndvi")).gte(AMBANG["naikNdvi"]))
    tanam_s1 = rs.select("VH").subtract(rb.select("VH")).gte(AMBANG["naikVh"]).And(rs.select("VH").gt(-19))
    tanam_s = tanam_s2.unmask(tanam_s1).rename("tanam")

    if asset_sawah:
        sawah = ee.Image(asset_sawah).select("sawah").unmask(0).gt(0)
    else:
        sawah = ee.ImageCollection("ESA/WorldCover/v200").first().eq(40)

    bahan = sb_t.select(["B4", "B8", "B11"]).addBands(ss_t.select(["B4", "B8", "B11"]))
    snic = (ee.Algorithms.Image.Segmentation.SNIC(
        image=bahan, size=UKURAN_PETAK_PX, compactness=1.5, connectivity=8,
        neighborhoodSize=4 * UKURAN_PETAK_PX,
        seeds=ee.Algorithms.Image.Segmentation.seedGrid(UKURAN_PETAK_PX))
        .select("clusters").reproject(crs="EPSG:32749", scale=10))

    stack = snic.int().addBands(ee.Image.cat([
        sawah.toFloat().rename("f_sawah"), genang_b.toFloat().rename("f_genang_b"),
        genang_s.toFloat().rename("f_genang_s"), tanam_s.toFloat().rename("f_tanam_s"),
        hijau_b.toFloat().rename("f_hijau_b")]))
    petak = (stack.reduceToVectors(
        geometry=aoi, scale=10, crs="EPSG:32749", geometryType="polygon", labelProperty="id",
        eightConnected=False, maxPixels=1e9,
        reducer=ee.Reducer.mean().forEach(["f_sawah", "f_genang_b", "f_genang_s", "f_tanam_s", "f_hijau_b"]))
        .filter(ee.Filter.gte("f_sawah", 0.6))
        .randomColumn("r1", 11).randomColumn("r2", 22))

    def kelas(f):
        # fraksi bisa null bila seluruh piksel petak ter-mask (awan + tanpa radar): anggap 0
        def fr(k):
            return ee.Number(ee.Algorithms.If(f.get(k), f.get(k), 0))
        if mode == "dummy":
            gb = ee.Number(f.get("r1")).lt(DUMMY["genang"])
            pt = ee.Number(ee.Algorithms.If(gb, DUMMY["tanamDariGenang"], DUMMY["tanamDariKering"]))
            ts = ee.Number(f.get("r2")).lt(pt)
            gs = gb.And(ts.Not())
        else:
            gb = fr("f_genang_b").gte(0.5)
            ts = fr("f_tanam_s").gte(0.5)
            gs = fr("f_genang_s").gte(0.5)
        sebelum = ee.String(ee.Algorithms.If(gb, "genang", "kering"))
        sesudah = ee.String(ee.Algorithms.If(ts, "tanam", ee.Algorithms.If(gs, "genang", "kering")))
        tertinggal = gb.And(ts.Not())
        hijau_awal = fr("f_hijau_b").gte(0.5)
        return ee.Feature(f.geometry(), dict(
            sebelum=sebelum, hijau_awal=hijau_awal, sesudah=sesudah, tertinggal=tertinggal,
            kelas_sesudah=ee.Algorithms.If(tertinggal, "tertinggal", sesudah),
            luas_ha=f.geometry().area(1).divide(1e4)))
    petak = petak.map(kelas)

    kode = ee.Dictionary(dict(kering=1, genang=2, tanam=3, tertinggal=4))

    def lukis(prop):
        fc = petak.map(lambda f: f.set("k", kode.get(f.get(prop))))
        isi = ee.Image().byte().paint(fc, "k")
        tepi = ee.Image().byte().paint(fc, 1, 1)
        return (isi.visualize(min=1, max=4, opacity=0.85,
                              palette=[WARNA["kering"], WARNA["genang"], WARNA["tanam"], WARNA["tertinggal"]])
                .blend(tepi.visualize(palette=["FFFFFF"], opacity=0.6)))

    tertinggal_fc = petak.filter(ee.Filter.eq("tertinggal", 1))
    garis = ee.Image().byte().paint(tertinggal_fc, 1, 2).visualize(palette=[WARNA["tertinggal"]])
    img = dict(
        sebelum=vis(sb_t),
        sesudah=vis(ss_t).blend(garis),
        sebelum_kelas=vis(sb_t).blend(lukis("sebelum")),
        sesudah_kelas=vis(ss_t).blend(lukis("kelas_sesudah")),
        sebelum_radar=vis_radar(rb),
        sesudah_radar=vis_radar(rs),
    )

    n = petak.size()

    def pct(fc):
        return ee.Number(fc.size()).divide(n.max(1)).multiply(100)

    info = ee.Dictionary(dict(
        jumlah_citra=dict(s2_sebelum=n_s2b, s2_sesudah=n_s2s, s1_sebelum=n_s1b, s1_sesudah=n_s1s),
        stat=dict(
            jumlah_petak=n,
            luas_sawah_ha=petak.aggregate_sum("luas_ha"),
            genang_sebelum_pct=pct(petak.filter(ee.Filter.eq("sebelum", "genang"))),
            belum_hijau_sebelum_pct=pct(petak.filter(ee.Filter.eq("hijau_awal", 0))),
            tertanam_sesudah_pct=pct(petak.filter(ee.Filter.eq("sesudah", "tanam"))),
            tertinggal_pct=pct(tertinggal_fc)),
        histogram=petak.aggregate_histogram("kelas_sesudah"),
        tanggal_citra=dict(s2_sebelum=tanggal_cerah(aoi, tgl_b, JENDELA), s2_sesudah=tanggal_cerah(aoi, tgl_s, JENDELA)),
    )).getInfo()
    tif = (sb_t.select(["B4", "B3", "B2", "B8", "B11"])
           .addBands(ss_t.select(["B4", "B3", "B2", "B8", "B11"]).rename(["B4_s", "B3_s", "B2_s", "B8_s", "B11_s"]))
           .toFloat())
    return aoi, bbox, img, petak, tif, info


def unduh(url, path):
    r = requests.get(url, timeout=300)
    r.raise_for_status()
    path.write_bytes(r.content)
    print(f"  ✓ {path}  ({len(r.content) / 1024:.0f} KB)")


def main():
    global JENDELA, HARI_INI
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True, help="ID Cloud project yang terdaftar di GEE")
    ap.add_argument("--lokasi", default="Ngawi", help="nama kabupaten persis seperti di dasbor")
    ap.add_argument("--pusat", help="lon,lat (default: preset lokasi)")
    ap.add_argument("--folder", help="nama folder keluaran (default: lokasi huruf kecil)")
    ap.add_argument("--sebelum", default="2026-09-30")
    ap.add_argument("--sesudah", default="2026-10-30")
    ap.add_argument("--mode", default="aturan", choices=["aturan", "dummy"])
    ap.add_argument("--asset-sawah", default="")
    ap.add_argument("--jendela", type=int, default=JENDELA, help="komposit ± hari di sekitar tiap tanggal")
    ap.add_argument("--out", default="public/citra")
    ap.add_argument("--tanpa-index", action="store_true", help="jangan perbarui index.json (dipakai saat paralel)")
    a = ap.parse_args()

    JENDELA = a.jendela
    HARI_INI = date.today().isoformat()
    ee.Initialize(project=a.project)
    pusat = [float(v) for v in a.pusat.split(",")] if a.pusat else PRESET[a.lokasi]
    folder = a.folder or a.lokasi.lower().replace(" ", "-")
    out = pathlib.Path(a.out)
    (out / folder).mkdir(parents=True, exist_ok=True)

    print(f"Memproses {a.lokasi} di {pusat} ({a.sebelum} vs {a.sesudah}, label {a.mode}) ...")
    aoi, bbox, img, petak, tif, info = proses(pusat, a.lokasi, a.sebelum, a.sesudah, a.mode, a.asset_sawah)
    print("Jumlah citra:", info["jumlah_citra"])
    print("Tanggal S2 cerah:", info["tanggal_citra"])
    print("Statistik:", json.dumps(info["stat"], indent=1))
    print("Petak per kelas sesudah:", info["histogram"])

    for k, im in img.items():
        url = im.getThumbURL(dict(region=aoi, dimensions=LEBAR_PNG, crs="EPSG:3857", format="png"))
        unduh(url, out / folder / f"{k}.png")
    unduh(petak.getDownloadURL(filetype="geojson", filename="petak"), out / folder / "petak.geojson")
    unduh(tif.getDownloadURL(dict(name="citra_10m", region=aoi, scale=10, crs="EPSG:32749",
                                  format="GEO_TIFF")), out / folder / "citra_10m.tif")

    meta = dict(
        folder=folder, lokasi=a.lokasi, pusat=pusat, kotak_km=[LEBAR_KM, TINGGI_KM], bbox=bbox,
        tanggal_sebelum=a.sebelum, tanggal_sesudah=a.sesudah, jendela_hari=JENDELA,
        jendela_s1_hari=max(JENDELA, JENDELA_S1_MIN), mode_label=a.mode,
        jumlah_citra=info["jumlah_citra"], tanggal_citra=info["tanggal_citra"], stat=info["stat"],
        sumber="Copernicus Sentinel-2 SR & Sentinel-1 GRD via Google Earth Engine; petak = segmen SNIC; label "
               + ("acak (simulasi)" if a.mode == "dummy" else "aturan ambang (belum divalidasi)"))
    (out / folder / "meta.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False))

    if a.tanpa_index:
        print("Selesai (index.json tidak diubah).")
        return
    idx_path = out / "index.json"
    idx = json.loads(idx_path.read_text()) if idx_path.exists() else []
    idx = [m for m in idx if m.get("folder") != folder] + [meta]
    idx_path.write_text(json.dumps(idx, indent=2, ensure_ascii=False))
    print(f"Selesai. index.json berisi {len(idx)} lokasi.")


if __name__ == "__main__":
    main()
