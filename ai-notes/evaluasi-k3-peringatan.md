# Evaluasi peringatan dini harga K3a: kenapa F1/recall rendah dan cara menaikkannya (26 Nov 2026)

Dasar: branch `model-afrizal` (740da4d), `scripts/k3/k3_harga_operasional.py` (EW60). Data: CSV SISKAPERBAPO beras medium di repo (s.d. 17 Nov 2026), tanpa database. Uji: 22 Agu 2025 s.d. data terakhir (HET Rp13.500), kab yang masih <= HET pada tanggal asal.

Skrip: `scripts/k3/uji_k3_peringatan.py` (definisi kejadian x model x ambang, ±10 menit) dan `scripts/k3/uji_k3_peringatan_episode.py` (sapuan ambang, recall episode, ±10 menit). Hasil: `data/satelit/k3_uji_peringatan.csv`, `data/satelit/k3_uji_peringatan_episode.csv`.

## Angka sekarang

F1 medium 0,14 (7 hari) s.d. 0,24 (28 hari), presisi ±15-25%. Kejadian = harga **tepat pada hari t+h** > HET. Ambang dipilih F1 maksimum **pada data uji itu sendiri**, jadi angka ini sedikit optimistis.

## Penyebab

1. **Kejadian langka.** 31 episode lewat HET dalam 15 bulan di 12 kab; positif hanya 0,9-3,3% kab-hari. F1 acak = prevalensi (0,01-0,03), jadi F1 0,2-0,3 sudah 10x di atas acak. Plafon F1 harian untuk data seperti ini memang rendah (Saito & Rehmsmeier 2015).
2. **Harga menempel di HET.** Harga medium berubah hanya pada 4% hari; harga pasar berupa angka bulat (13.000/13.500/14.000), rata-rata 2-6 pasar. HET menjadi titik fokus (Knittel & Stango 2003), jadi lewat HET berupa lompatan diskret, bukan tren yang bisa diekstrapolasi.
3. **Lintasan sesaat bukan penyebab utama** (dugaan awal saya keliru). Definisi MATERI (>= 1% di atas HET atau bertahan >= 7 hari) hanya membuang 1-3 episode; hasilnya hampir sama dengan KAPAN.
4. **Model tanpa informasi per kab.** EW60 hanya memakai jarak ke HET + sebaran galat gabungan. Tidak tahu riwayat kab (Madiun, Sidoarjo, Situbondo bolak-balik), atau berapa pasar di kab yang sudah di HET.
5. **Definisi dan ukuran tidak sesuai tujuan peringatan dini.** "Harga di hari t+h" bukan "lewat HET dalam h hari"; dinilai per kab-hari, bukan per episode; ambang dipilih di data uji.

## Hasil uji

### A. Definisi kejadian "lewat HET kapan saja dalam h hari" (KAPAN), model sama (EW60)

| Horizon | F1 sekarang (TITIK) | F1 KAPAN | PR-AUC TITIK -> KAPAN |
|---|---|---|---|
| 7 | 0,18 | 0,20 | 0,10 -> 0,12 |
| 14 | 0,22 | 0,25 | 0,11 -> 0,17 |
| 21 | 0,26 | 0,29 | 0,12 -> 0,19 |
| 28 | 0,25 | 0,32 | 0,11 -> 0,20 |

Lebih sesuai pertanyaan kebijakan dan lebih mudah diprediksi. **Disarankan dipakai.**

### B. Ambang jujur (dipilih sebelum bulan uji) vs oracle (dipilih di data uji)

EW60 KAPAN: F1 oracle 0,20/0,25/0,29/0,32 -> jujur 0,15/0,18/0,21/0,26. Pada TITIK 7 hari, ambang jujur hampir tidak pernah membunyikan alarm (F1 0,03). Angka yang dilaporkan sekarang sebaiknya diganti angka jujur.

### C. Model berfitur per kab, cost-sensitive (bobot kelas seimbang), latih ulang bulanan

Fitur: jarak ke HET, sedang tepat di HET, porsi hari di atas HET 30/90/365 hari, hari sejak terakhir di atas HET, porsi pasar di/di atas HET, harga pasar maksimum, momentum 7-56 hari, porsi kab Jatim di atas HET, selisih premium, musim. HET historis Rp10.900 (Mar 2023) dan Rp12.500 (Jun 2024) ditaksir dari harga yang menumpuk; **tanggal perlu diverifikasi**.

KAPAN, sapuan ambang (presisi harian pada recall episode tertentu; recall episode = episode yang didahului >= 1 alarm dalam h hari):

| Horizon | Model | PR-AUC | F1 maks | Presisi @ recall episode >= 70% | Hari alarm per episode |
|---|---|---|---|---|---|
| 14 | EW60 (sekarang) | 0,172 | 0,248 | 0,11 | 63 |
| 14 | Logit fitur kecil, latih sejak Jun 2024 | 0,148 | 0,283 | 0,14 | 43 |
| 14 | **EW60 + logit (rerata peringkat)** | **0,191** | **0,293** | **0,17** | **37** |
| 28 | EW60 (sekarang) | 0,196 | 0,319 | 0,16 | 81 |
| 28 | **Logit fitur kecil, latih sejak Jun 2024** | 0,188 | **0,353** | **0,28** | **31** |
| 28 | EW60 + logit (rerata peringkat) | **0,245** | 0,341 | 0,23 | 45 |

(7 hari: gabungan PR-AUC 0,119 -> 0,136, F1 0,20 -> 0,24.)

Temuan:
- Logit sendiri tidak mengalahkan EW60 di PR-AUC; **gabungan keduanya yang menang** di semua horizon (PR-AUC +14-25%, F1 +0,02-0,05, presisi pada recall 70% naik 0,11 -> 0,17 dan 0,16 -> 0,23).
- Latih dengan data HET Rp10.900 (2023-24) **memperburuk** (kenaikan harga 2023-24 berbeda rezim). Latih sejak Jun 2024 lebih baik.
- GBM lebih buruk daripada logit (terlalu sedikit kejadian).
- Cost-sensitive + ambang rendah menaikkan **recall episode** dari 18-35% (EW60, ambang jujur) ke 50-80%, dengan bayaran alarm lebih banyak (presisi 10-16%).

Catatan kehati-hatian: hanya 26-29 episode uji; selisih antar model belum diuji bootstrap, jadi beda kecil (< 0,03 F1) masih bisa derau.

## Rekomendasi (urut prioritas)

1. **Ganti definisi kejadian ke KAPAN** ("lewat HET dalam h hari") dan **laporkan PR-AUC + recall episode + F1 dengan ambang jujur**. Ini perubahan evaluasi, bukan model, dan sesuai praktik EWS krisis: evaluasi dalam jendela sebelum kejadian (Kaminsky dkk. 1998; Drehmann & Juselius 2014).
2. **Pilih ambang dari fungsi rugi kebijakan, bukan F1.** F1 menganggap alarm palsu dan kejadian terlewat sama mahal. Untuk SPHP, terlewat biasanya lebih mahal: ambang p* = c_FP / (c_FP + c_FN) (Elkan 2001), atau loss Sarlin (2013) dengan preferensi μ. Dua tingkat: WASPADA (recall episode ~70-80%) untuk pemantauan, SIAGA (presisi tinggi) untuk tindakan.
3. **Pasang gabungan EW60 + logit fitur kecil (latih sejak Jun 2024, bobot kelas seimbang)**. Paling konsisten di semua horizon. Verifikasi dulu tanggal HET Rp12.500.
4. Uji lanjutan: bootstrap blok untuk selisih model; gabungan EW60 + logit-2024; fitur stok Bulog per cabang / harga gabah petani bila ada (Tadesse dkk. 2014 soal pemicu lonjakan); kuantil kondisional tinggi gaya IFPRI EFPV (Martins-Filho dkk. 2015) sebagai pembanding.
5. Proposal: jangan menjanjikan F1 tinggi; tulis sebagai recall episode pada tingkat alarm tertentu (mis. "70% episode lewat HET didahului peringatan 2-4 minggu, dengan ±1 alarm benar per 4-6 alarm").

## Referensi (DOI diverifikasi di halaman penerbit/RePEc, 26 Nov 2026)

- Saito, T., Rehmsmeier, M. (2015). The precision-recall plot is more informative than the ROC plot when evaluating binary classifiers on imbalanced datasets. PLoS ONE 10(3): e0118432. doi:10.1371/journal.pone.0118432
- Davis, J., Goadrich, M. (2006). The relationship between Precision-Recall and ROC curves. ICML 2006, 233-240. doi:10.1145/1143844.1143874
- Lipton, Z.C., Elkan, C., Naryanaswamy, B. (2014). Optimal thresholding of classifiers to maximize F1 measure. ECML PKDD 2014, LNCS 8725. doi:10.1007/978-3-662-44851-9_15
- Elkan, C. (2001). The foundations of cost-sensitive learning. IJCAI-01, 973-977. https://ijcai.org/proceedings/2001/133 (tanpa DOI)
- He, H., Garcia, E.A. (2009). Learning from imbalanced data. IEEE TKDE 21(9), 1263-1284. doi:10.1109/TKDE.2008.239
- Sarlin, P. (2013). On policymakers' loss functions and the evaluation of early warning systems. Economics Letters 119(1), 1-7. doi:10.1016/j.econlet.2012.12.030
- Drehmann, M., Juselius, M. (2014). Evaluating early warning indicators of banking crises: Satisfying policy requirements. Int. J. Forecasting 30(3), 759-780. doi:10.1016/j.ijforecast.2013.10.002
- Kaminsky, G., Lizondo, S., Reinhart, C.M. (1998). Leading indicators of currency crises. IMF Staff Papers 45(1), 1-48. http://www.jstor.org/stable/3867328 (DOI belum terverifikasi)
- Tatbul, N. dkk. (2018). Precision and recall for time series. NeurIPS 31. arXiv:1803.03639
- Ferro, C.A.T., Stephenson, D.B. (2011). Extremal dependence indices: improved verification measures for deterministic forecasts of rare binary events. Weather and Forecasting 26(5), 699-713. doi:10.1175/WAF-D-10-05030.1
- Gneiting, T., Balabdaoui, F., Raftery, A.E. (2007). Probabilistic forecasts, calibration and sharpness. JRSS-B 69(2), 243-268. doi:10.1111/j.1467-9868.2007.00587.x
- Knittel, C.R., Stango, V. (2003). Price ceilings as focal points for tacit collusion: Evidence from credit cards. AER 93(5), 1703-1729. doi:10.1257/000282803322655509
- Martins-Filho, C., Yao, F., Torero, M. (2015). High-order conditional quantile estimation based on nonparametric models of regression. Econometric Reviews 34(6-10), 907-958. doi:10.1080/07474938.2014.956612 (dasar EFPV IFPRI)
- Martins-Filho, C., Yao, F., Torero, M. (2018). Nonparametric estimation of conditional value-at-risk and expected shortfall based on extreme value theory. Econometric Theory 34(1), 23-67. doi:10.1017/S0266466616000517
- Baquedano, F.G. (2015). Developing a price warning indicator as an early warning tool: a compound growth approach. FAO. https://www.fao.org/giews/food-prices/research/detail/en/c/235685/
- Tadesse, G., Algieri, B., Kalkuhl, M., von Braun, J. (2014). Drivers and triggers of international food price spikes and volatility. Food Policy 47, 117-128. doi:10.1016/j.foodpol.2013.08.014
- Lentz, E.C., Michelson, H., Baylis, K., Zhou, Y. (2019). A data-driven approach improves food insecurity crisis prediction. World Development 122, 399-409. doi:10.1016/j.worlddev.2019.06.008
- Richardson, D.S. (2000). Skill and relative economic value of the ECMWF ensemble prediction system. QJRMS 126, 649-667 (DOI Wiley belum terverifikasi; versi memo ECMWF doi:10.21957/2xjs554nr)

## Tambahan 26 Nov 2026 siang: fitur dari Panel Harga Bapanas

Data: `data/bapanas/panel_harga/` (harian per kab Jatim, 1 Jan 2024 s.d. 25 Nov 2026, ditarik dengan `scripts/bapanas/ambil_panel_harga.py` dari API publik Panel Harga Bapanas; 26-38 kab per komoditas). Uji: `scripts/k3/uji_k3_fitur_bapanas.py`, kejadian KAPAN, semua model dilatih sejak Jun 2024, walk-forward bulanan, periode uji sama.

Fitur baru: harga beras medium penggilingan kab terhadap HET (`pg_het`, cadangan median Jatim bila kab kosong), perubahan 28 hari harga penggilingan, GKG, GKP, dan penanda SPHP beredar (harga beras SPHP tercatat di kab). Harga medium non-SPHP dibuang dari versi utama karena serinya baru ±321 hari, sehingga penanda kosongnya ikut menangkap efek periode (hasil dengan non-SPHP: `data/satelit/k3_uji_fitur_bapanas_dengan_ns.csv`, PR-AUC sedikit lebih tinggi tetapi tidak bisa dipercaya).

| Horizon | Model | PR-AUC | F1 maks | Presisi @ recall episode >= 50% |
|---|---|---|---|---|
| 7 | EW60 + logit | 0,148 | 0,262 | 0,10 |
| 7 | EW60 + logit + Bapanas | **0,164** | 0,251 | 0,11 |
| 14 | EW60 + logit | 0,226 | 0,300 | 0,18 |
| 14 | EW60 + logit + Bapanas | **0,250** | **0,330** | 0,20 |
| 28 | EW60 + logit | 0,253 | 0,341 | 0,30 |
| 28 | EW60 + logit + Bapanas | **0,282** | 0,337 | **0,36** |

- PR-AUC naik 10-11% di semua horizon. Uji dengan fitur acak (data tiruan) hanya menggeser PR-AUC ±0,01, jadi kenaikan 0,016-0,029 kemungkinan nyata, tetapi kecil.
- F1 maksimum hampir tidak berubah (kecuali 14 hari +0,03); keuntungan terutama pada presisi di tingkat recall menengah.
- Fitur terkuat: **harga beras di penggilingan terhadap HET** (koefisien terstandar +0,8 s.d. +0,9, kedua setelah jarak harga eceran ke HET). Sesuai dugaan: saat margin penggilingan ke HET menipis, eceran menyusul lewat HET.
- Rekomendasi: masukkan `pg_het` ke model gabungan. Harga pedagang besar (PIHPS BI) belum diuji.

## Tambahan 26 Nov 2026 sore: variabel dari kajian harga beras Indonesia

Ringkasan kajian (DOI dicek di halaman penerbit). Belum ada kajian harian tingkat kabupaten untuk Indonesia; hampir semuanya bulanan dan tingkat nasional atau provinsi.

| Variabel | Arah dan temuan | Kajian | Ada di model kita? |
|---|---|---|---|
| Harga sendiri (lag) | Paling kuat; AR(2) sulit dikalahkan untuk 1 bulan | Persada dkk. 2026, 10.3389/fsufs.2026.1844670 | Ya (EW60, `d`, `m28`) |
| Harga hulu (gabah, penggilingan) | Memimpin eceran 1-3 bulan; elastisitas jangka pendek 0,26 | Kharisma & Indrawan 2023, 10.1080/23311932.2023.2266198; Shaffitri 2024, 10.1051/bioconf/202411902007 | Ya (`pg_het`, terkuat; `gkg_m28`, `gkp_m28`) |
| Transmisi asimetris / ambang | Kenaikan diteruskan lebih cepat dari penurunan; penyesuaian 46-57 hari | Zahra 2026, 10.14710/agrisocionomics.v10i2.28636; Difah 2019, 10.25181/jofsa.v3i2.1561; Arida 2023, 10.51599/are.2023.09.01.04 | Diuji hari ini, tidak menambah |
| HET | Mendorong pergeseran ke beras premium | Rachman 2019, 10.21082/akp.v17n1.2019.59-77 | Ya (target); premium penggilingan sudah ditarik, belum dipakai |
| Operasi pasar SPHP / penyaluran Bulog | Endogen; pengaruh lemah atau tidak signifikan | Persada 2026; Maharani (skripsi IPB) | Sebagian (`sphp_ada`, hanya penanda harga tercatat) |
| Harga BBM | Positif, dengan lag | Ismaya & Anugrah 2018, 10.21098/bemp.v21i1.926; Persada 2026 (lag 3) | **Belum** |
| ENSO / IOD | El Niño dan La Niña menaikkan harga; indeks iklim lebih baik dari curah hujan mentah | Fajri 2019, 10.22004/ag.econ.296761; Putra 2021, 10.3390/su13084465 | **Belum** |
| Produksi / panen | Negatif (lag 1 bulan); stok cadangan negatif di daerah surplus | Persada 2026 | Tidak langsung (dari K1/K2 bisa disambung) |
| Ramadan / Idulfitri | Kenaikan musiman | Saleh 2019 | Diuji hari ini, tidak menambah |
| Impor | Bereaksi terhadap harga t-2 (endogen) | Yafi 2025, 10.22146/ae.100774 | Belum (lebih cocok sebagai penanda rezim) |
| Harga daerah lain | Jatim pemimpin harga; integrasi pasar spasial | Ariga 2022 (tesis IPB); Varela 2012 (WB WP 6098) | Sebagian (`prov_atas`, `pasar_*`) |

### Uji fitur dari kajian (`scripts/k3/uji_k3_fitur_literatur.py`)

Ditambahkan ke model gabungan + Bapanas: deviasi marjin eceran-penggilingan dari rerata 180 hari, perubahan penggilingan 28 hari dipisah naik/turun, dummy Idulfitri H-30 s.d. H+7, momentum eceran positif. Kejadian KAPAN, walk-forward sama.

| Horizon | + Bapanas | + Bapanas + kajian |
|---|---|---|
| 7 | PR-AUC 0,164 / F1 0,251 | 0,157 / 0,249 |
| 14 | 0,250 / 0,330 | 0,229 / 0,323 |
| 28 | 0,282 / 0,337 | 0,266 / 0,328 |

Semuanya sedikit lebih buruk. Penjelasan yang paling mungkin: informasinya sudah tertangkap oleh `pg_het` dan `m28`, dan data latih hanya ±17 bulan (satu Idulfitri dalam periode latih), jadi fitur tambahan menambah varians. Fitur ini tidak dipakai.

### Kesimpulan untuk model

- Data yang sudah ada relevan: harga eceran (lag) dan harga penggilingan memang variabel terkuat di kajian Indonesia, dan juga terkuat di uji kita.
- Struktur model tidak perlu dirombak. Kajian menunjukkan model sederhana berbasis lag sulit dikalahkan; yang menaikkan hasil adalah definisi kejadian (KAPAN), gabungan EW60 + logit, dan `pg_het`.
- Data yang kurang, urut perkiraan manfaat: (1) harga pedagang besar PIHPS BI (mata rantai antara penggilingan dan eceran, publik, harian); (2) tanggal perubahan harga BBM (penanda kejadian, mudah dibuat manual); (3) indeks ONI/IOD (NOAA/BoM, bulanan, gratis) untuk horizon lebih panjang; (4) stok dan penyaluran SPHP Bulog per kab (tidak publik, perlu permintaan data). Curah hujan CHIRPS lebih cocok untuk K1 daripada K3 jangka 1-4 minggu.
- Batas utama tetap jumlah kejadian (31 episode lewat HET dalam 15 bulan). Menambah variabel tidak akan menaikkan F1 jauh di atas ±0,35 selama riwayat sependek ini.

## Tambahan 26 Nov 2026 sore: harga pedagang besar dan produsen PIHPS BI

Data: `data/pihps/` (endpoint publik `bi.go.id/hargapangan/WebSite/TabelHarga/GetGridDataDaerah`, skrip `scripts/pihps/ambil_pihps.py`), 1 Jan 2024 s.d. 25 Nov 2026, hanya hari kerja. Pedagang besar hanya 8 kota/kab (Surabaya, Malang, Kediri, Madiun, Probolinggo, Blitar, Jember, Banyuwangi); produsen beras medium I/super I 14 kab. `city_id` adalah id PIHPS, bukan kode BPS; padanan lewat nama.

Uji (`scripts/k3/uji_k3_fitur_pihps.py`, KAPAN, walk-forward sama, ditambahkan di atas model gabungan + Bapanas):

| Horizon | + Bapanas | + semua fitur PIHPS | + hanya pedagang besar/HET |
|---|---|---|---|
| 7 | PR-AUC 0,164 / F1 0,251 | 0,149 / 0,233 | 0,162 / 0,251 |
| 14 | 0,250 / 0,330 | 0,227 / 0,326 | 0,241 / 0,326 |
| 28 | 0,282 / 0,337 | 0,251 / 0,332 | 0,272 / 0,336 |

PIHPS tidak menambah, di semua varian (juga pedagang besar + produsen tanpa/dengan penanda kosong). Sebabnya: pedagang besar hanya 8 lokasi sehingga 79% baris memakai median Jatim, produsen hanya 14 kab, dan informasinya sudah tertangkap harga penggilingan Bapanas (`pg_het`, 17-28 kab). Data PIHPS tetap disimpan untuk dasbor atau kajian transmisi harga, tetapi tidak dipakai di model peringatan.

## Tambahan 26 Nov 2026 sore: inflasi bulanan kab/kota IHK (BPS)

Data: `data/bps/inflasi_kota_jatim_bulanan.csv` (WebAPI BPS, skrip `scripts/bps/ambil_inflasi_kota.py`), Jan 2023 s.d. Okt 2026, 11 kab/kota IHK Jatim (8 pada 2023). Ukuran: umum, kelompok makanan-minuman-tembakau, subkelompok makanan (m-to-m, y-on-y, IHK). Beras per kota tidak tersedia di WebAPI. Fitur harian memakai bulan terakhir yang sudah rilis (bulan m dianggap terbit 1 bulan m+1); 27 kab tanpa IHK diisi median 11 kota.

Uji (`scripts/k3/uji_k3_fitur_inflasi.py`, KAPAN, walk-forward sama), PR-AUC:

| Model | 7 | 14 | 28 |
|---|---|---|---|
| EW60 + logit + Bapanas | 0,164 | 0,250 | 0,282 |
| + semua fitur inflasi | 0,150 | 0,244 | 0,264 |
| + inflasi makanan m-to-m | 0,157 | 0,240 | 0,271 |
| + inflasi makanan y-on-y | 0,163 | 0,248 | 0,275 |

Tidak menambah. Inflasi bulanan terbit sebulan kemudian (terlambat untuk horizon 7-28 hari), hanya 11 dari 38 kab/kota, dan isinya sudah tercermin di harga harian. Tidak dipakai.
