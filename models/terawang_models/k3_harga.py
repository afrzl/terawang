"""K3 · Prediksi harga beras 2 dan 4 minggu ke depan per kab/kota.

BASELINE: naif (harga terakhir). Interval dari kuantil 10%-90% perubahan relatif historis pada horizon yang sama.
Model sungguhan (SARIMA, gradient boosting) harus mengalahkan MAPE baseline ini di backtest.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

VERSI = "k3-naif-0.1"
JENIS_DATA = "MODEL"
HORIZON_HARI = (14, 28)


def _seri(harga: pd.DataFrame) -> pd.DataFrame:
    df = harga.dropna(subset=["harga"]).copy()
    df["tanggal"] = pd.to_datetime(df["tanggal"])
    return df.sort_values(["wilayah_id", "komoditas_id", "tanggal"])


def prediksi_harga(harga: pd.DataFrame, horizon_hari: tuple[int, ...] = HORIZON_HARI) -> pd.DataFrame:
    """harga: wilayah_id, komoditas_id, tanggal, harga (Rp/kg, harian).

    Keluaran: wilayah_id, komoditas_id, tanggal_acuan, horizon_hari, harga_prediksi, batas_bawah, batas_atas.
    """
    df = _seri(harga)
    baris = []
    for (wid, kid), g in df.groupby(["wilayah_id", "komoditas_id"]):
        s = g.set_index("tanggal")["harga"].asfreq("D").ffill()
        acuan = s.index[-1]
        terakhir = float(s.iloc[-1])
        for h in horizon_hari:
            rel = (s.shift(-h) / s - 1).dropna()
            lo, hi = (np.quantile(rel, [0.1, 0.9]) if len(rel) > 30 else (-0.05, 0.05))
            baris.append((wid, kid, acuan.date(), h, terakhir, terakhir * (1 + lo), terakhir * (1 + hi)))
    return pd.DataFrame(baris, columns=["wilayah_id", "komoditas_id", "tanggal_acuan", "horizon_hari", "harga_prediksi", "batas_bawah", "batas_atas"])


def backtest_naif(harga: pd.DataFrame, horizon_hari: tuple[int, ...] = HORIZON_HARI, hari_uji: int = 365) -> dict:
    """MAPE prediksi naif pada `hari_uji` hari terakhir (rolling origin harian). Keluaran: {"mape_14": 0.012, ...}."""
    df = _seri(harga)
    hasil = {}
    for h in horizon_hari:
        err = []
        for _, g in df.groupby(["wilayah_id", "komoditas_id"]):
            s = g.set_index("tanggal")["harga"].asfreq("D").ffill()
            uji = s.iloc[-(hari_uji + h):]
            pred, akt = uji.shift(h).iloc[h:], uji.iloc[h:]
            err.append((pred - akt).abs() / akt)
        semua = pd.concat(err).dropna()
        hasil[f"mape_{h}"] = round(float(semua.mean()), 5) if len(semua) else None
    return hasil


def status_harga(harga: float, het: float | None, siaga_pct: float = 3.0) -> str | None:
    """AMAN <= HET, WASPADA di atas HET s.d. HET + siaga_pct%, SIAGA di atasnya. None kalau HET belum ada."""
    if het is None or harga is None or np.isnan(harga):
        return None
    if harga <= het:
        return "AMAN"
    return "WASPADA" if harga <= het * (1 + siaga_pct / 100) else "SIAGA"


# ---------------------------------------------------------------------------------------------------------------------
# K3a operasional: scripts/k3/k3_harga_operasional.py (+ k3_peringatan_gabungan.py). Dipakai pipeline; baseline naif di atas tetap untuk pembanding.
VERSI_K3A = "k3a-harian-ew60-gabungan-2026.11"
HORIZON_K3A = (7, 14, 21, 28)


def prediksi_harga_k3a(akar, env: dict[str, str]) -> tuple[pd.DataFrame, dict]:
    """Jalankan K3a Danang. Keluaran (R, parameter): R = komoditas, kab, tanggal_acuan, horizon_hari, harga, p10, p90, status, p_di_atas_het."""
    from .danang import di_repo, modul

    with di_repo(akar, env):
        ko = modul("k3_harga_operasional")
        R, het, kal = ko.hitung(cetak=False)
        return R, ko.parameter_run(het, kal)


# K3 GKP: prakiraan harga GKP petani Jatim bulanan 1-3 bulan (gabungan naif + SARIMAX HPP + luas panen),
# scripts/k3/k3_gkp_operasional.py. Butuh statsmodels.
VERSI_K3_GKP = "k3-gkp-sarimax-gab-0.1"


def prakiraan_gkp(akar, env: dict[str, str], hari_ini=None, dir_bapanas=None) -> tuple[pd.DataFrame, dict]:
    """Keluaran (R, parameter): R = bulan_acuan, bulan_target, horizon_bulan, harga_prediksi, p10, p90, luas_panen_ha, sumber_luas, hpp."""
    from .danang import di_repo, modul

    with di_repo(akar, env):
        return modul("k3_gkp_operasional").hitung(hari_ini=hari_ini, dir_bapanas=dir_bapanas)
