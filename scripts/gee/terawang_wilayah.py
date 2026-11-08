"""TERAWANG · Agregat per kabupaten/kota Jawa Timur dari Google Earth Engine.

Menghitung, untuk 38 wilayah dasbor, angka berbasis satelit yang dipakai src/lib/data.ts:
  pop      penduduk (ribu jiwa)                       WorldPop GP 100 m (tahun terbaru)
  ha       luas sawah (ha)                            ESA WorldCover kelas 40 (cropland) sebagai proksi
  ip       indeks pertanaman (kali tanam / tahun)     jumlah bulan NDVI ≥ 0,55 (S2) dibagi 2
  prod     produksi GKG tahunan (ribu ton)            ha × ip × produktivitas
  ph       % luas sawah per fase pada tanggal acuan   S2 NDVI/LSWI kini vs 30 hari sebelumnya + S1 VV
  lag      % sawah tergenang 30 hari lalu tapi belum tertanam
  est/prev proyeksi panen 3 bulan ke depan, tahun ini vs tahun lalu (ribu ton GKG)
  vh/vhAvg profil Sentinel-1 VH sawah, 15 akuisisi tiap 12 hari mulai 1 Jun (tahun ini vs rata-rata 3 tahun)
  pusat    titik [lon, lat] hamparan sawah terpadat (untuk kotak citra)

Pakai (dari root repo):
  python scripts/gee/terawang_wilayah.py --project ID_PROJECT_GEE
  # hasil: src/lib/gee_wilayah.json  (+ cache per wilayah di ~/.cache/terawang-gee/)

Klasifikasi fase dan luas sawah memakai aturan ambang sederhana, belum divalidasi lapangan.
"""
import argparse
import concurrent.futures as cf
import datetime as dt
import json
import pathlib
import time

import ee

PRODUKTIVITAS = 5.6  # t GKG / ha / musim (rata-rata Jawa Timur, BPS)
SKALA = 30
WILAYAH = [
    "Pacitan", "Ponorogo", "Trenggalek", "Tulungagung", "Blitar", "Kediri", "Malang", "Lumajang", "Jember",
    "Banyuwangi", "Bondowoso", "Situbondo", "Probolinggo", "Pasuruan", "Sidoarjo", "Mojokerto", "Jombang",
    "Nganjuk", "Madiun", "Magetan", "Ngawi", "Bojonegoro", "Tuban", "Lamongan", "Gresik", "Bangkalan",
    "Sampang", "Pamekasan", "Sumenep", "Kota Kediri", "Kota Blitar", "Kota Malang", "Kota Probolinggo",
    "Kota Pasuruan", "Kota Mojokerto", "Kota Madiun", "Kota Surabaya", "Batu",
]
# nama dasbor -> nama ADM2 di FAO GAUL 2015
GAUL = {"Batu": ["Kota Batu"], "Jember": ["Jember", "Kota Jember"]}
CACHE = pathlib.Path.home() / ".cache" / "terawang-gee"


def batas(nama):
    fc = (ee.FeatureCollection("FAO/GAUL/2015/level2")
          .filter(ee.Filter.eq("ADM1_NAME", "Jawa Timur"))
          .filter(ee.Filter.inList("ADM2_NAME", GAUL.get(nama, [nama]))))
    return fc.geometry().dissolve(100)


def s2(aoi, mulai, akhir):
    cs = ee.ImageCollection("GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED")
    kol = (ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED").filterBounds(aoi).filterDate(mulai, akhir)
           .linkCollection(cs, ["cs_cdf"]))
    return kol.map(lambda i: i.select(["B4", "B8", "B11"]).divide(10000)
                   .updateMask(i.select("cs_cdf").gte(0.6)))


def s1(aoi, mulai, akhir):
    return (ee.ImageCollection("COPERNICUS/S1_GRD").filterBounds(aoi).filterDate(mulai, akhir)
            .filter(ee.Filter.eq("instrumentMode", "IW"))
            .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VH"))
            .select(["VV", "VH"]))


def nd(img):
    return ee.Image.cat([img.normalizedDifference(["B8", "B4"]).rename("ndvi"),
                         img.normalizedDifference(["B8", "B11"]).rename("lswi")])


def sawah_mask(aoi, acuan):
    """Proksi lahan sawah = ESA WorldCover v200 kelas 40 (cropland).

    Di Jawa Timur lahan pangan dataran rendah didominasi sawah; uji ambang genangan S1 (VV p10) dan
    amplitudo VH tidak memisahkan sawah dari tegalan secara berarti, jadi dipakai WorldCover saja.
    Cek: Ngawi 51,5 rb ha (BPS ±50 rb ha luas baku sawah).
    """
    return ee.ImageCollection("ESA/WorldCover/v200").first().eq(40).selfMask().rename("sawah")


def kelas_fase(aoi, acuan):
    """0 bera, 1 olah tanah/genangan, 2 vegetatif, 3 generatif, 4 siap panen; plus pita 'lag'."""
    d = ee.Date(acuan)
    kini = nd(s2(aoi, d.advance(-15, "day"), d.advance(15, "day")).median())
    lalu = nd(s2(aoi, d.advance(-45, "day"), d.advance(-15, "day")).median())
    r_kini = s1(aoi, d.advance(-12, "day"), d.advance(12, "day")).median().focalMedian(30, "circle", "meters")
    r_lalu = s1(aoi, d.advance(-42, "day"), d.advance(-18, "day")).median().focalMedian(30, "circle", "meters")
    n, l = kini.select("ndvi"), kini.select("lswi")
    dn = n.subtract(lalu.select("ndvi"))

    def genang(ix, r):
        return (ix.select("lswi").add(0.05).gte(ix.select("ndvi")).And(ix.select("ndvi").lt(0.3))
                .unmask(r.select("VV").lt(-16)))

    g_kini = genang(kini, r_kini)
    turun = dn.lt(-0.05)
    kelas = (ee.Image(0)
             .where(n.gte(0.3).And(n.lt(0.6)), 2)
             .where(n.gte(0.6), 3)
             .where(n.gte(0.3).And(turun), 4)
             .where(g_kini, 1)
             .updateMask(n.mask().Or(g_kini.mask()))
             .rename("fase"))
    tanam = (n.gte(0.35).And(dn.gte(0.10))
             .unmask(r_kini.select("VH").subtract(r_lalu.select("VH")).gte(3).And(r_kini.select("VH").gt(-19))))
    lag = genang(lalu, r_lalu).And(tanam.Not()).rename("lag")
    return kelas, lag


def hist_fase(kelas, sawah, aoi):
    h = (kelas.updateMask(sawah).reduceRegion(ee.Reducer.frequencyHistogram(), aoi, SKALA,
                                              maxPixels=1e10, tileScale=8).get("fase"))
    return h


def ip_image(aoi, acuan):
    d = ee.Date(acuan)
    bulan = ee.List.sequence(0, 11).map(
        lambda m: nd(s2(aoi, d.advance(ee.Number(m).subtract(12), "month"),
                        d.advance(ee.Number(m).subtract(11), "month")).median()).select("ndvi").gte(0.55)
        .rename("hijau"))
    kol = ee.ImageCollection.fromImages(bulan)
    hijau = kol.sum()
    valid = kol.count()
    return hijau.divide(valid.max(1)).multiply(12).divide(2).clamp(0.5, 3).rename("ip")


def profil_vh(aoi, sawah, mulai_tahun):
    awal = dt.date(mulai_tahun, 6, 1)
    pita = []
    for i in range(15):
        t = ee.Date(str(awal + dt.timedelta(days=12 * i)))
        pita.append(s1(aoi, t.advance(-6, "day"), t.advance(6, "day")).select("VH").mean().rename(f"v{i}"))
    img = ee.Image.cat(pita).updateMask(sawah)
    return img.reduceRegion(ee.Reducer.mean(), aoi, 60, maxPixels=1e10, tileScale=8)


def hitung(nama, acuan, tahun):
    aoi = batas(nama)
    sawah = sawah_mask(aoi, acuan)
    luas = ee.Image.pixelArea().divide(1e4)

    pop_img = (ee.ImageCollection("WorldPop/GP/100m/pop").filter(ee.Filter.eq("country", "IDN"))
               .sort("year", False).first())
    padat = sawah.unmask(0).focalMean(1000, "circle", "meters").rename("padat")
    lonlat = ee.Image.pixelLonLat()
    dasar = ee.Dictionary(dict(
        pop=pop_img.reduceRegion(ee.Reducer.sum(), aoi, 100, maxPixels=1e10, tileScale=8).values().get(0),
        ha=luas.updateMask(sawah).reduceRegion(ee.Reducer.sum(), aoi, SKALA, maxPixels=1e10, tileScale=8)
        .get("area"),
        ip=ip_image(aoi, acuan).updateMask(sawah).reduceRegion(ee.Reducer.mean(), aoi, 60, maxPixels=1e10,
                                                               tileScale=8).get("ip"),
        pusat=padat.addBands(lonlat).reduceRegion(ee.Reducer.max(3), aoi, 100, maxPixels=1e10, tileScale=8),
    )).getInfo()

    kelas, lag = kelas_fase(aoi, acuan)
    k_lalu, _ = kelas_fase(aoi, ee.Date(acuan).advance(-1, "year"))
    sawah_lalu = sawah_mask(aoi, ee.Date(acuan).advance(-1, "year"))
    fase = ee.Dictionary(dict(
        kini=hist_fase(kelas, sawah, aoi),
        lalu=hist_fase(k_lalu, sawah_lalu, aoi),
        lag=lag.updateMask(sawah).reduceRegion(ee.Reducer.mean(), aoi, SKALA, maxPixels=1e10, tileScale=8)
        .get("lag"),
        ha_lalu=luas.updateMask(sawah_lalu).reduceRegion(ee.Reducer.sum(), aoi, SKALA, maxPixels=1e10,
                                                         tileScale=8).get("area"),
        cakupan=kelas.mask().updateMask(sawah).reduceRegion(ee.Reducer.mean(), aoi, SKALA, maxPixels=1e10,
                                                             tileScale=8).get("fase"),
    )).getInfo()

    vh = profil_vh(aoi, sawah, tahun).getInfo()
    vh_avg = [profil_vh(aoi, sawah, tahun - j).getInfo() for j in (1, 2, 3)]
    return dict(dasar=dasar, fase=fase, vh=vh, vh_avg=vh_avg)


def persen(hist):
    hist = hist or {}
    tot = sum(hist.values()) or 1
    return [round(100 * hist.get(str(i), 0) / tot, 2) for i in range(5)]


def ringkas(nama, raw):
    d, f = raw["dasar"], raw["fase"]
    ha = d["ha"] or 0
    ip = d["ip"] or 1.0
    ph = persen(f["kini"])
    ph_lalu = persen(f["lalu"])

    def panen(ph, luas):  # ribu ton GKG yang dipanen dalam ±3 bulan ke depan
        return luas * (ph[3] + ph[4] + 0.5 * ph[2]) / 100 * PRODUKTIVITAS / 1000

    est, prev = panen(ph, ha), panen(ph_lalu, f["ha_lalu"] or ha)
    cak = f["cakupan"] if f["cakupan"] is not None else 0.5
    p = d["pusat"] or {}
    vh = [raw["vh"].get(f"v{i}") for i in range(15)]
    avg = []
    for i in range(15):
        xs = [y.get(f"v{i}") for y in raw["vh_avg"] if y.get(f"v{i}") is not None]
        avg.append(round(sum(xs) / len(xs), 2) if xs else None)
    return dict(
        n=nama,
        pop=round((d["pop"] or 0) / 1000, 1),
        ha=round(ha),
        ip=round(ip, 2),
        prod=round(ha * ip * PRODUKTIVITAS / 1000, 1),
        ph=ph,
        lag=round(100 * (f["lag"] or 0), 2),
        est=round(est, 2),
        prev=round(prev, 2),
        ci=round(est * (0.05 + 0.3 * (1 - cak)), 2),
        cakupan_s2=round(cak, 3),
        vh=[round(v, 2) if v is not None else None for v in vh],
        vhAvg=avg,
        pusat=[round(p["max1"], 5), round(p["max2"], 5)] if p.get("max") else None,
    )


def kerja(nama, acuan, tahun):
    CACHE.mkdir(parents=True, exist_ok=True)
    cf_path = CACHE / f"{nama.lower().replace(' ', '-')}_{acuan}.json"
    if cf_path.exists():
        return nama, json.loads(cf_path.read_text())
    for coba in range(3):
        try:
            t0 = time.time()
            raw = hitung(nama, acuan, tahun)
            cf_path.write_text(json.dumps(raw))
            print(f"  ✓ {nama} ({time.time() - t0:.0f} dtk)", flush=True)
            return nama, raw
        except Exception as e:  # noqa: BLE001
            print(f"  ! {nama} percobaan {coba + 1}: {str(e)[:200]}", flush=True)
            time.sleep(10 * (coba + 1))
    return nama, None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True)
    ap.add_argument("--acuan", default="2026-10-30", help="tanggal citra acuan (fase tumbuh)")
    ap.add_argument("--out", default="src/lib/gee_wilayah.json")
    ap.add_argument("--paralel", type=int, default=6)
    ap.add_argument("--hanya", help="daftar nama dipisah koma (uji)")
    a = ap.parse_args()
    ee.Initialize(project=a.project)
    tahun = int(a.acuan[:4])
    nama = a.hanya.split(",") if a.hanya else WILAYAH

    hasil, gagal = {}, []
    with cf.ThreadPoolExecutor(a.paralel) as ex:
        for n, raw in ex.map(lambda x: kerja(x, a.acuan, tahun), nama):
            if raw is None:
                gagal.append(n)
            else:
                hasil[n] = ringkas(n, raw)

    out = dict(
        dibuat=dt.datetime.now().isoformat(timespec="seconds"), acuan=a.acuan, produktivitas_t_ha=PRODUKTIVITAS,
        sumber="Google Earth Engine: Sentinel-1 GRD, Sentinel-2 SR + Cloud Score+, ESA WorldCover v200, "
               "WorldPop GP 100m, FAO GAUL 2015. Aturan ambang, belum divalidasi lapangan.",
        wilayah=[hasil[n] for n in nama if n in hasil],
    )
    p = pathlib.Path(a.out)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(out, indent=1, ensure_ascii=False))
    print(f"Selesai: {len(hasil)} wilayah → {p}" + (f"; gagal: {gagal}" if gagal else ""))


if __name__ == "__main__":
    main()
