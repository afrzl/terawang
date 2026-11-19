"""K1 · Estimasi produksi beras bulanan per kab/kota.

BASELINE: musiman naif. Produksi bulan m tahun target = produksi bulan m pada tahun terakhir yang tersedia.
Ganti dengan model citra (luas panen satelit x produktivitas, kalibrasi BPS) tanpa mengubah kolom keluaran.
"""
from __future__ import annotations

import pandas as pd

VERSI = "k1-musiman-naif-0.1"
JENIS_DATA = "MODEL"
LEBAR_INTERVAL = 0.10  # +-10%, placeholder


def prediksi_produksi(produksi_bulanan: pd.DataFrame, tahun_target: int, bulan_target: list[int]) -> pd.DataFrame:
    """produksi_bulanan: wilayah_id, tahun, bulan, produksi_beras_ton (angka BPS bulanan).

    Keluaran: wilayah_id, tahun, bulan, produksi_beras_ton, batas_bawah_ton, batas_atas_ton.
    """
    df = produksi_bulanan.dropna(subset=["produksi_beras_ton"])
    df = df[df["tahun"] < tahun_target]
    if df.empty:
        raise ValueError("tidak ada produksi bulanan sebelum tahun target")
    # tahun terakhir per (wilayah, bulan)
    terakhir = df.sort_values("tahun").groupby(["wilayah_id", "bulan"], as_index=False).last()
    out = terakhir[terakhir["bulan"].isin(bulan_target)].copy()
    out["tahun"] = tahun_target
    out["batas_bawah_ton"] = out["produksi_beras_ton"] * (1 - LEBAR_INTERVAL)
    out["batas_atas_ton"] = out["produksi_beras_ton"] * (1 + LEBAR_INTERVAL)
    return out[["wilayah_id", "tahun", "bulan", "produksi_beras_ton", "batas_bawah_ton", "batas_atas_ton"]].reset_index(drop=True)
