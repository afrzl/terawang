"""K2 · Neraca stok beras beredar per kab/kota per bulan.

BASELINE: stok_t = stok_{t-1} + produksi_t - konsumsi_t, tanpa arus antarwilayah dan tanpa filter Kalman.
Stok awal tidak diketahui (tidak dipublikasikan), jadi dibuat tiga skenario DUMMY sebagai kelipatan konsumsi bulanan.
Ganti dengan model state-space (Kalman) + jangkar stok Bulog tanpa mengubah kolom keluaran.
"""
from __future__ import annotations

import pandas as pd

VERSI = "k2-neraca-tanpa-arus-0.1"
JENIS_DATA = "MODEL"
# Stok awal = N bulan konsumsi. DUMMY, bukan data.
SKENARIO_STOK_AWAL_BULAN = {"RENDAH": 1.0, "TENGAH": 2.0, "TINGGI": 3.0}
BATAS_DEFISIT = 0.0  # cakupan < 0 bulan
BATAS_TIPIS = 1.0  # cakupan < 1 bulan


def _status(cakupan: float) -> str:
    if cakupan < BATAS_DEFISIT:
        return "DEFISIT"
    if cakupan < BATAS_TIPIS:
        return "TIPIS"
    return "CUKUP"


def estimasi_stok(produksi: pd.DataFrame, konsumsi_bulanan: pd.DataFrame) -> pd.DataFrame:
    """produksi: wilayah_id, tahun, bulan, produksi_beras_ton (gabungan BPS historis + prediksi K1).
    konsumsi_bulanan: wilayah_id, konsumsi_ton_bulan (penduduk x kg/kapita/bulan / 1000).

    Keluaran: wilayah_id, tahun, bulan, skenario, stok_ton, cakupan_bulan, status.
    """
    p = produksi.merge(konsumsi_bulanan, on="wilayah_id", how="inner").sort_values(["wilayah_id", "tahun", "bulan"])
    baris = []
    for wid, g in p.groupby("wilayah_id"):
        kons = float(g["konsumsi_ton_bulan"].iloc[0])
        for skenario, n_bulan in SKENARIO_STOK_AWAL_BULAN.items():
            stok = n_bulan * kons
            for r in g.itertuples(index=False):
                stok = stok + float(r.produksi_beras_ton) - kons
                cakupan = stok / kons if kons else 0.0
                baris.append((wid, int(r.tahun), int(r.bulan), skenario, stok, cakupan, _status(cakupan)))
    return pd.DataFrame(baris, columns=["wilayah_id", "tahun", "bulan", "skenario", "stok_ton", "cakupan_bulan", "status"])
