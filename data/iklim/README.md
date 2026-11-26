# Iklim

| Berkas | Isi | Sumber |
|---|---|---|
| `chirps_jatim_bulanan.csv` | Hujan bulanan (mm) per kab/kota (GAUL 2015 lv2) dan provinsi, Jan 2015–Sep 2026; rata-rata piksel lahan pertanian WorldCover. `hari_data` = jumlah citra harian; `sawah_kosong=True` → diisi rata-rata semua piksel | CHIRPS DAILY lewat GEE, `scripts/gee/chirps_bulanan.py` |
| `noaa_oni.txt`, `noaa_oni_bulanan.csv` | ONI (anomali Niño 3.4, 3 bulanan), `bulan` = bulan tengah musim (DJF=1 … NDJ=12), 1950–ASO 2026 | https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt |
| `noaa_dmi.had.long.txt`, `noaa_dmi_bulanan.csv` | Dipole Mode Index (IOD) HadISST, 1870–Mei 2026 (preliminary) | https://psl.noaa.gov/gcos_wgsp/Timeseries/Data/dmi.had.long.data |

Diunduh 26 Nov 2026. Status: **ASLI**.
