/**************************************************************************
 * TERAWANG · Citra sebelum–sesudah tanam untuk slider halaman Produksi
 *
 * Cara pakai (GEE Code Editor, https://code.earthengine.google.com):
 *   1. Buat skrip baru, tempel seluruh isi file ini, klik Run.
 *   2. Lihat panel Console: ada tautan PNG, GeoTIFF, GeoJSON petak, dan
 *      teks JSON "meta". Klik tautan untuk mengunduh.
 *   3. Ingin lokasi lain? Klik saja sawah di peta: semua dihitung ulang
 *      untuk kotak di sekitar titik itu, tautan baru muncul di Console.
 *
 * Apa yang dihasilkan:
 *   - sebelum.png / sesudah.png : warna alami Sentinel-2 (sesudah diberi
 *     garis merah pada petak tertinggal). Ukuran 1440 px, rasio 12:7,
 *     sama dengan bingkai slider (720×420).
 *   - sebelum_kelas.png / sesudah_kelas.png : petak diwarnai per kelas
 *     (biru tergenang, hijau tertanam, cokelat kering, merah tertinggal).
 *   - sebelum_radar.png / sesudah_radar.png : Sentinel-1 (cadangan kalau
 *     Sentinel-2 tertutup awan).
 *   - petak.geojson : poligon "petak" + kelas sebelum/sesudah.
 *   - meta.json : kotak wilayah, tanggal, jumlah citra, dan persentase
 *     untuk tiga angka di bawah slider.
 *
 * Catatan jujur:
 *   - Citra Sentinel-1/2 ASLI. "Petak" BUKAN batas persil resmi, melainkan
 *     segmen otomatis (SNIC) dari citra, kira-kira seukuran petak sawah.
 *   - Kelas dibuat dengan aturan ambang sederhana (MODE_LABEL = 'aturan')
 *     atau acak berbobot (MODE_LABEL = 'dummy'). Belum divalidasi lapangan,
 *     jadi tetap tulis "label simulasi" di dasbor.
 **************************************************************************/

// =============================== PENGATURAN ===============================
// Titik pusat perkiraan di sentra sawah. Silakan geser dengan klik peta.
var PRESET = {
  'Ngawi':     [111.450, -7.500],  // sekitar Geneng/Kwadungan
  'Bondowoso': [113.800, -7.970],  // sekitar Tamanan/Tenggarang
  'Jember':    [113.530, -8.230],  // sekitar Balung/Puger
  'Lamongan':  [112.370, -7.130]   // sekitar Sukodadi/Deket
};
var LOKASI = 'Ngawi';          // nama kabupaten (dipakai juga di meta.json)

var LEBAR_KM = 3.6;            // 3,6 × 2,1 km → rasio 12:7 seperti slider
var TINGGI_KM = 2.1;

var TGL_SEBELUM = '2026-09-30';
var TGL_SESUDAH = '2026-10-30';
var JENDELA = 12;              // ± hari di sekitar tanggal untuk komposit

var MODE_LABEL = 'aturan';     // 'aturan' (dari citra) atau 'dummy' (acak)
var DUMMY = {                  // dipakai hanya bila MODE_LABEL = 'dummy'
  genang: 0.55,                // peluang petak tergenang sebelum tanam
  tanamDariGenang: 0.78,       // dari yang tergenang, yang sudah tertanam
  tanamDariKering: 0.25        // dari yang kering, yang sudah tertanam
};

// Ambang aturan (boleh diubah setelah melihat peta)
var AMBANG = {
  ndviTanam: 0.35,             // NDVI sesudah ≥ ini → sudah hijau
  naikNdvi: 0.10,              // dan NDVI naik minimal segini
  vvAir: -15,                  // Sentinel-1 VV (dB) < ini → air/genangan
  naikVh: 3                    // cadangan S1: VH naik ≥ 3 dB → tanaman
};

var UKURAN_PETAK_PX = 6;       // jarak benih SNIC (piksel 10 m) → ±0,3–0,5 ha
var ASSET_SAWAH = '';          // opsional: asset peta sawah Notebook 1
                               // (band 'sawah'), kosong = ESA WorldCover
var LEBAR_PNG = 1440;
var EKSPOR_DRIVE = false;      // true = juga buat tugas ekspor ke Drive

// ============================== FUNGSI BANTU ==============================
function kotak(pusat) {
  var dLat = (TINGGI_KM / 2) / 110.574;
  var dLon = (LEBAR_KM / 2) / (111.320 * Math.cos(pusat[1] * Math.PI / 180));
  var bbox = [pusat[0] - dLon, pusat[1] - dLat, pusat[0] + dLon, pusat[1] + dLat];
  return { geom: ee.Geometry.Rectangle(bbox, null, false), bbox: bbox };
}

var CS_PLUS = ee.ImageCollection('GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED');
var BAND_S2 = ['B2', 'B3', 'B4', 'B8', 'B11'];

function koleksiS2(aoi, tgl, hari, bersih) {
  var d = ee.Date(tgl);
  var kol = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterBounds(aoi)
    .filterDate(d.advance(-hari, 'day'), d.advance(hari, 'day'))
    .linkCollection(CS_PLUS, ['cs_cdf']);
  return kol.map(function (img) {
    var s = img.select(BAND_S2).divide(10000);
    if (bersih) s = s.updateMask(img.select('cs_cdf').gte(0.6));
    return s.copyProperties(img, ['system:time_start']);
  });
}

/** Komposit S2. 'analisis' = hanya piksel bebas awan (bisa berlubang);
 *  'tampil' = lubang ditambal jendela ±30 hari, lalu citra mentah. */
function kompositS2(aoi, tgl) {
  var sempit = koleksiS2(aoi, tgl, JENDELA, true);
  var lebar = koleksiS2(aoi, tgl, 30, true);
  var mentah = koleksiS2(aoi, tgl, 30, false);
  var analisis = sempit.median();
  var tampil = analisis.unmask(lebar.median()).unmask(mentah.median());
  return { analisis: analisis, tampil: tampil, n: sempit.size() };
}

function kompositS1(aoi, tgl) {
  var d = ee.Date(tgl);
  var kol = ee.ImageCollection('COPERNICUS/S1_GRD')
    .filterBounds(aoi)
    .filterDate(d.advance(-JENDELA, 'day'), d.advance(JENDELA, 'day'))
    .filter(ee.Filter.eq('instrumentMode', 'IW'))
    .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
    .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VH'))
    .select(['VV', 'VH']);
  return { img: kol.median().focalMedian(30, 'circle', 'meters'), n: kol.size() };
}

function indeks(s2) {
  return ee.Image.cat([
    s2.normalizedDifference(['B8', 'B4']).rename('ndvi'),
    s2.normalizedDifference(['B8', 'B11']).rename('lswi')
  ]);
}

/** Genangan: aturan Xiao (LSWI + 0,05 ≥ NDVI, NDVI rendah) dari S2;
 *  bila piksel S2 berawan, pakai S1 (VV gelap). */
function genang(ix, s1) {
  var dariS2 = ix.select('lswi').add(0.05).gte(ix.select('ndvi'))
    .and(ix.select('ndvi').lt(0.3));
  var dariS1 = s1.select('VV').lt(AMBANG.vvAir);
  return dariS2.unmask(dariS1).rename('genang');
}

function vis(s2) {
  return s2.visualize({ bands: ['B4', 'B3', 'B2'], min: 0.02, max: 0.24, gamma: 1.25 });
}
function visRadar(s1) {
  var rasio = s1.select('VV').subtract(s1.select('VH')).rename('rasio');
  return s1.addBands(rasio).visualize({
    bands: ['VV', 'VH', 'rasio'], min: [-20, -26, 2], max: [-3, -10, 14] });
}

var WARNA = { kering: 'A8865B', genang: '2F7FB8', tanam: '3E9B4F', tertinggal: 'E5484D' };

// ================================ PROSES =================================
function proses(pusat, nama) {
  var kt = kotak(pusat), aoi = kt.geom;
  var sb = kompositS2(aoi, TGL_SEBELUM), ss = kompositS2(aoi, TGL_SESUDAH);
  var rb = kompositS1(aoi, TGL_SEBELUM), rs = kompositS1(aoi, TGL_SESUDAH);
  var ib = indeks(sb.analisis), is = indeks(ss.analisis);

  // --- Kelas per piksel (hanya bermakna di sawah) ---
  var genangB = genang(ib, rb.img);
  var genangS = genang(is, rs.img);
  var tanamS2 = is.select('ndvi').gte(AMBANG.ndviTanam)
    .and(is.select('ndvi').subtract(ib.select('ndvi')).gte(AMBANG.naikNdvi));
  var tanamS1 = rs.img.select('VH').subtract(rb.img.select('VH')).gte(AMBANG.naikVh)
    .and(rs.img.select('VH').gt(-19));
  var tanamS = tanamS2.unmask(tanamS1).rename('tanam');

  var sawah = ASSET_SAWAH
    ? ee.Image(ASSET_SAWAH).select('sawah').unmask(0).gt(0)
    : ee.ImageCollection('ESA/WorldCover/v200').first().eq(40);
  sawah = sawah.rename('sawah');

  // --- "Petak": segmen SNIC dari citra sebelum + sesudah ---
  var bahan = sb.tampil.select(['B4', 'B8', 'B11'])
    .addBands(ss.tampil.select(['B4', 'B8', 'B11']));
  var snic = ee.Algorithms.Image.Segmentation.SNIC({
    image: bahan, size: UKURAN_PETAK_PX, compactness: 1.5, connectivity: 8,
    neighborhoodSize: 4 * UKURAN_PETAK_PX,
    seeds: ee.Algorithms.Image.Segmentation.seedGrid(UKURAN_PETAK_PX)
  }).select('clusters').reproject({ crs: 'EPSG:32749', scale: 10 });

  var stack = snic.int().addBands(ee.Image.cat([
    sawah.toFloat().rename('f_sawah'),
    genangB.toFloat().rename('f_genang_b'),
    genangS.toFloat().rename('f_genang_s'),
    tanamS.toFloat().rename('f_tanam_s')
  ]));
  var petak = stack.reduceToVectors({
    geometry: aoi, scale: 10, crs: 'EPSG:32749', geometryType: 'polygon',
    labelProperty: 'id', eightConnected: false, maxPixels: 1e9,
    reducer: ee.Reducer.mean().forEach(['f_sawah', 'f_genang_b', 'f_genang_s', 'f_tanam_s'])
  })
    .filter(ee.Filter.gte('f_sawah', 0.6))
    .randomColumn('r1', 11).randomColumn('r2', 22);

  petak = petak.map(function (f) {
    var g;
    if (MODE_LABEL === 'dummy') {
      var gB = ee.Number(f.get('r1')).lt(DUMMY.genang);
      var pT = ee.Number(ee.Algorithms.If(gB, DUMMY.tanamDariGenang, DUMMY.tanamDariKering));
      var tS = ee.Number(f.get('r2')).lt(pT);
      g = { gB: gB, tS: tS, gS: gB.and(tS.not()) };
    } else {
      g = {
        gB: ee.Number(f.get('f_genang_b')).gte(0.5),
        tS: ee.Number(f.get('f_tanam_s')).gte(0.5),
        gS: ee.Number(f.get('f_genang_s')).gte(0.5)
      };
    }
    var sebelum = ee.String(ee.Algorithms.If(g.gB, 'genang', 'kering'));
    var sesudah = ee.String(ee.Algorithms.If(g.tS, 'tanam', ee.Algorithms.If(g.gS, 'genang', 'kering')));
    var tertinggal = g.gB.and(g.tS.not());
    var luas = f.geometry().area(1).divide(1e4);
    return ee.Feature(f.geometry(), {
      sebelum: sebelum, sesudah: sesudah, tertinggal: tertinggal,
      kelas_sesudah: ee.Algorithms.If(tertinggal, 'tertinggal', sesudah),
      luas_ha: luas
    });
  });

  // --- Gambar per kelas ---
  function lukisKelas(prop) {
    var kode = { kering: 1, genang: 2, tanam: 3, tertinggal: 4 };
    var fc = petak.map(function (f) {
      return f.set('k', ee.Dictionary(kode).get(f.get(prop)));
    });
    var isi = ee.Image().byte().paint(fc, 'k');
    var tepi = ee.Image().byte().paint(fc, 1, 1);
    return isi.visualize({ min: 1, max: 4,
      palette: [WARNA.kering, WARNA.genang, WARNA.tanam, WARNA.tertinggal], opacity: 0.85 })
      .blend(tepi.visualize({ palette: ['FFFFFF'], opacity: 0.6 }));
  }
  var tertinggalFc = petak.filter(ee.Filter.eq('tertinggal', 1));
  var garisMerah = ee.Image().byte().paint(tertinggalFc, 1, 2)
    .visualize({ palette: [WARNA.tertinggal] });

  var img = {
    sebelum: vis(sb.tampil),
    sesudah: vis(ss.tampil).blend(garisMerah),
    sebelum_kelas: vis(sb.tampil).blend(lukisKelas('sebelum')),
    sesudah_kelas: vis(ss.tampil).blend(lukisKelas('kelas_sesudah')),
    sebelum_radar: visRadar(rb.img),
    sesudah_radar: visRadar(rs.img)
  };

  // --- Peta ---
  Map.layers().reset();
  Map.centerObject(aoi, 15);
  Map.addLayer(img.sebelum, {}, 'Sebelum (S2 ' + TGL_SEBELUM + ')', false);
  Map.addLayer(img.sesudah, {}, 'Sesudah (S2 ' + TGL_SESUDAH + ')');
  Map.addLayer(img.sebelum_kelas, {}, 'Kelas sebelum', false);
  Map.addLayer(img.sesudah_kelas, {}, 'Kelas sesudah', false);
  Map.addLayer(img.sebelum_radar, {}, 'Radar sebelum (S1)', false);
  Map.addLayer(img.sesudah_radar, {}, 'Radar sesudah (S1)', false);
  Map.addLayer(ee.Image().byte().paint(aoi, 1, 2), { palette: ['FFFF00'] }, 'Kotak slider');

  // --- Angka untuk tiga kotak di bawah slider ---
  var n = petak.size();
  function pct(fc) { return ee.Number(fc.size()).divide(n.max(1)).multiply(100); }
  var luasTotal = petak.aggregate_sum('luas_ha');
  var meta = ee.Dictionary({
    lokasi: nama,
    pusat: pusat,
    kotak_km: [LEBAR_KM, TINGGI_KM],
    bbox: kt.bbox,             // [barat, selatan, timur, utara], derajat
    tanggal_sebelum: TGL_SEBELUM,
    tanggal_sesudah: TGL_SESUDAH,
    jendela_hari: JENDELA,
    mode_label: MODE_LABEL,
    jumlah_citra: { s2_sebelum: sb.n, s2_sesudah: ss.n, s1_sebelum: rb.n, s1_sesudah: rs.n },
    stat: {
      jumlah_petak: n,
      luas_sawah_ha: luasTotal,
      genang_sebelum_pct: pct(petak.filter(ee.Filter.eq('sebelum', 'genang'))),
      tertanam_sesudah_pct: pct(petak.filter(ee.Filter.eq('sesudah', 'tanam'))),
      tertinggal_pct: pct(tertinggalFc)
    },
    sumber: 'Copernicus Sentinel-2 SR & Sentinel-1 GRD via Google Earth Engine; petak = segmen SNIC; label ' +
      (MODE_LABEL === 'dummy' ? 'acak (simulasi)' : 'aturan ambang (belum divalidasi)')
  });

  // --- Tautan unduhan ---
  print('════ TERAWANG · ' + nama + ' · pusat ' + pusat[0].toFixed(4) + ', ' + pusat[1].toFixed(4) + ' ════');
  Object.keys(img).forEach(function (k) {
    var url = img[k].getThumbURL({ region: aoi, dimensions: LEBAR_PNG, crs: 'EPSG:3857', format: 'png' });
    print(ui.Label('⬇ ' + k + '.png', { color: '1a73e8' }, url));
  });
  var tif = sb.tampil.select(['B4', 'B3', 'B2', 'B8', 'B11'])
    .addBands(ss.tampil.select(['B4', 'B3', 'B2', 'B8', 'B11']).rename(
      ['B4_s', 'B3_s', 'B2_s', 'B8_s', 'B11_s'])).toFloat();
  print(ui.Label('⬇ citra_10m.tif (GeoTIFF, band sebelum + _s sesudah)', { color: '1a73e8' },
    tif.getDownloadURL({ name: 'terawang_citra_10m', region: aoi, scale: 10,
      crs: 'EPSG:32749', format: 'GEO_TIFF' })));
  print(ui.Label('⬇ petak.geojson', { color: '1a73e8' },
    petak.getDownloadURL({ format: 'geojson', filename: 'petak' })));

  // meta.json: salin teks yang tercetak lalu simpan sebagai meta.json
  print('meta.json (salin teks di bawah ini):', ee.String.encodeJSON(meta));
  print('Jumlah petak per kelas sesudah:', petak.aggregate_histogram('kelas_sesudah'));

  if (EKSPOR_DRIVE) {
    var folder = 'TERAWANG_citra';
    Export.table.toDrive({ collection: petak, description: 'petak_' + nama,
      folder: folder, fileNamePrefix: 'petak_' + nama, fileFormat: 'GeoJSON' });
    Export.image.toDrive({ image: tif, description: 'citra10m_' + nama, folder: folder,
      fileNamePrefix: 'citra10m_' + nama, region: aoi, scale: 10, crs: 'EPSG:32749' });
    Object.keys(img).forEach(function (k) {
      Export.image.toDrive({ image: img[k], description: k + '_' + nama, folder: folder,
        fileNamePrefix: k + '_' + nama, region: aoi, dimensions: LEBAR_PNG, crs: 'EPSG:3857' });
    });
    print('Tugas ekspor Drive dibuat: buka tab Tasks, klik RUN.');
  }
}

// ============================== JALANKAN =================================
Map.setOptions('SATELLITE');
proses(PRESET[LOKASI], LOKASI);

Map.style().set('cursor', 'crosshair');
Map.onClick(function (c) {
  proses([c.lon, c.lat], LOKASI + '_klik');
});
