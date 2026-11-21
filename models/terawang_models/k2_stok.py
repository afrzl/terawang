"""K2 stok: model milik Danang (scripts/k2/k2_operasional.py). Metodologi: ai-notes/metodologi-k2.md.

Neraca stok non-Bulog per kab (produksi K1 - konsumsi Susenas + arus antar kab hasil LP jarak jalan - keluar provinsi dari
kelebihan panen), satu jangkar asumsi (cakupan terendah Jatim = 1,0 bulan), pita ketidakpastian ala Kalman tanpa pengamatan.
Status: DEFISIT < 0,75 | TIPIS 0,75-1,0 | CUKUP 1,0-1,5 | SURPLUS >= 1,5 bulan konsumsi.
"""

import datetime as dt
from pathlib import Path

import pandas as pd

from .danang import di_repo, modul

VERSI = "k2-neraca-lp-kalman-2026.11"
JENIS_DATA = "MODEL"


def estimasi_stok(akar: str | Path, hari_ini: dt.date, produksi: pd.DataFrame, env: dict[str, str]) -> dict:
    """produksi = keluaran k1_produksi.prediksi_produksi. Kembalikan dict: skenario (baris app.estimasi_stok, kolom kab),
    rinci (cakupan, sd, peluang per kab-bulan), konsumsi (ton/bulan per kab), hari_ke_defisit, jangkar."""
    prod = {(int(t), int(b)): g.set_index("kab").produksi_beras_ton for (t, b), g in produksi.groupby(["tahun", "bulan"])}
    sd = {(int(t), int(b)): float(g.sd_relatif.iloc[0]) for (t, b), g in produksi.groupby(["tahun", "bulan"])}
    with di_repo(akar, env):
        ko = modul("k2_operasional")
        h = ko.hitung(hari_ini, prod=prod, sd_prod=sd)
        sk = ko.skenario(h["R"], h["C"])
        param = {"ambang": {"defisit": ko.AMBANG_DEFISIT, "cukup": ko.AMBANG_CUKUP, "surplus": ko.AMBANG_SURPLUS},
                 "sigma": {"keluar_provinsi": ko.SIGMA_X, "konsumsi": ko.SIGMA_C, "prod_model": ko.SIGMA_P_MODEL, "prod_k1": ko.SIGMA_P_K1},
                 "jangkar_min_bulan": ko.JANGKAR_MIN, "sd_jangkar": ko.SD_JANGKAR}
    return {"skenario": sk, "rinci": h["R"], "konsumsi": h["C"].rename("konsumsi_ton_bulan"), "hari_ke_defisit": h["hit"],
            "jangkar": float(h["a_jangkar"]), "parameter": param}
