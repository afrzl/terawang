"""TERAWANG K1 · Ringkasan akurasi model gabungan (dipakai untuk membandingkan varian, mis. jumlah titik sampel).

  python scripts/k1/uji_k1_ringkas.py                 # memakai data/satelit/est_nowcast2_lead{0,28,56}.csv
Keluaran: uji bergulir 2022-2025 (luas panen bulanan per kab: WAPE, MAPE kota) dan uji akhir produksi beras Jan-Sep 2026
per kab/kota (WAPE, MAPE, MAPE kab, MAPE kota), untuk jarak 0/28/56 hari. Tidak butuh database.
"""
import datetime as dt
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, "scripts/k1")
import k1_prakiraan as kp  # noqa: E402
from nowcast_eval import muat_bps  # noqa: E402

PERIODE = "data/bps/produksi_padi/kabkota/periode/bps_jatim_padi_kabkota_periode_2025_2026.csv"


def wape(a, p):
    return np.abs(np.asarray(p) - np.asarray(a)).sum() / np.asarray(a).sum() * 100


def mape(a, p):
    a, p = np.asarray(a, float), np.asarray(p, float)
    return np.mean(np.abs(p - a) / a) * 100


def main():
    y = muat_bps()
    Yw = y.pivot(index=["kabkota", "bulan"], columns="tahun", values="y")
    ES, kota, fin = kp.muat_citra(Yw), kp.daftar_kota(), kp.tahun_final(Yw)
    P = pd.read_csv(PERIODE).set_index("nama_repo")
    prod25 = P.produksi_beras_jan_sep_2025_ton / P.luas_panen_jan_sep_2025_ha
    a26 = P.produksi_beras_jan_sep_2026s_ton
    k = a26.index.isin(kota)
    print("jarak | bergulir 2022-25 bulanan: WAPE, MAPE kota | uji Jan-Sep 2026 produksi: WAPE, MAPE, MAPE kab, MAPE kota | citra saja WAPE 2026")
    for h, L in kp.LEAD.items():
        R = kp.uji_bergulir(h)
        b = R[R.y > 50]
        parts = []
        for m in range(1, 10):
            C = dt.date(2026, m, 1) - dt.timedelta(days=L)
            tr = [t for t in fin if t < 2026] if C >= dt.date(2026, 3, 1) else [t for t in fin if t < 2025]
            p = kp.Gabungan(Yw, ES[h], tr, kota).prediksi(2026, max(tr))
            parts.append(p[p.index.get_level_values(1) == m])
        S = pd.concat(parts).groupby(level=0)[["gabungan", "sat_kab"]].sum().reindex(a26.index).mul(prod25, axis=0)
        print(f"{L:3d} h | {wape(R.y, R.gabungan):5.1f}% {mape(b.y[b.kota], b.gabungan[b.kota]):5.1f}% | "
              f"{wape(a26, S.gabungan):5.1f}% {mape(a26, S.gabungan):5.1f}% {mape(a26[~k], S.gabungan[~k]):5.1f}% {mape(a26[k], S.gabungan[k]):5.1f}% | "
              f"{wape(a26, S.sat_kab):5.1f}%", flush=True)


if __name__ == "__main__":
    main()
