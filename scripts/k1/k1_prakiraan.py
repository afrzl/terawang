"""TERAWANG K1 · Prakiraan luas panen per kab (model gabungan) untuk bulan target tertentu, dipakai oleh K2.

Gabungan = w1 x Citra (koefisien per kab) + w2 x Rata-rata musiman + w3 x Tahun lalu, bobot NNLS leave-one-year-out pada tahun latih.
Taksiran citra per jarak waktu: lead 0 (bulan berjalan), 28 hari (bulan depan), 56 hari (dua bulan lagi).

Perbaikan 24 Nov 2026 (lihat ai-notes/evaluasi-k1-perbaikan.md):
  - bobot dipelajari terpisah untuk KOTA dan KABUPATEN (sebelumnya satu set bobot yang didominasi kabupaten besar);
  - bila taksiran citra bulan target tidak ada (citra belum diperbarui, tahun belum dihitung), komponen citra TIDAK diisi 0 lagi:
    wilayah itu memakai bobot cadangan tanpa citra (rata-rata musiman + tahun lalu) dan muncul peringatan;
  - tahun latih bawaan = semua tahun BPS bulanan yang lengkap (tidak di-hardcode);
  - galat_empiris(): sebaran galat prakiraan dari uji bergulir, per jarak dan jenis wilayah, untuk pita ketidakpastian K2.

  from k1_prakiraan import prakiraan
  prakiraan(targets=[(2026, 11, 0), (2026, 12, 1), (2027, 1, 2)])          # tr bawaan = tahun_final()
  python scripts/k1/k1_prakiraan.py --galat                                  # tulis data/satelit/k1_galat_empiris.csv
"""
import argparse
import datetime as dt
import os
import sys
import warnings

import numpy as np
import pandas as pd
from scipy.optimize import nnls

sys.path.insert(0, "scripts/k1")
from nowcast_eval import muat_bps  # noqa: E402

LEAD = {0: 0, 1: 28, 2: 56}
FIT3 = ["sat_kab", "klim", "musiman"]
FIT2 = ["klim", "musiman"]  # cadangan bila citra bulan target tidak tersedia
BPS_BULANAN_2025 = "data/bps/produksi_padi/kabkota/bulanan/bps_jatim_padi_kabkota_bulanan_2025.csv"
GALAT_CSV = "data/satelit/k1_galat_empiris.csv"
Z80 = 1.2816


def daftar_kota():
    b = pd.read_csv(BPS_BULANAN_2025)
    return set(b.loc[b.jenis.str.lower() == "kota", "nama_repo"])


def tahun_final(Yw):
    """Tahun BPS bulanan yang lengkap (12 bulan terisi untuk semua wilayah, kecuali Jan-Mar 2019 yang sengaja dikosongkan)."""
    ok = []
    for th in Yw.columns:
        col = Yw[th]
        if th == 2019:
            col = col[col.index.get_level_values(1) > 3]
        if col.notna().all():
            ok.append(int(th))
    return ok


def muat_citra(Yw):
    def est_wide(est):
        e = est.copy()
        e["tahun"], e["bulan"] = (e.t - 1) // 12, (e.t - 1) % 12 + 1
        e.loc[(e.tahun == 2019) & (e.bulan <= 3), "est"] = np.nan
        return e.pivot(index=["kabkota", "bulan"], columns="tahun", values="est").reindex(Yw.index)

    ES = {}
    for h, L in LEAD.items():
        a = pd.read_csv(f"data/satelit/est_nowcast2_lead{L}.csv")[["kabkota", "t", "est"]]
        p_b = os.path.join(os.environ.get("TERAWANG_K1_DIR", "data/satelit"), f"est_nowcast2_lead{L}_2026.csv")
        b = pd.read_csv(p_b)[["kabkota", "t", "est"]] if os.path.exists(p_b) else a.iloc[:0]
        ES[h] = est_wide(pd.concat([a, b]).drop_duplicates(["kabkota", "t"], keep="last"))
    return ES


class Gabungan:
    """Model gabungan untuk satu jarak waktu dan satu set tahun latih."""

    def __init__(self, Yw, E, tr, kota):
        self.Yw, self.E, self.tr, self.kota = Yw, E, list(tr), kota
        self.par = self._latih(self.tr)
        self.w3 = self._bobot(FIT3)
        self.w2 = self._bobot(FIT2)

    def _latih(self, trn):
        Yw, E = self.Yw, self.E
        sy, se = Yw[trn].sum(axis=1, min_count=1), E[trn].sum(axis=1, min_count=1)
        m = sy.notna() & se.notna() & (se > 0)
        bg = sy[m].sum() / se[m].sum()
        tau = se[m].groupby(level=0).sum().mean() / max(len(trn), 1)
        bk = (sy[m].groupby(level=0).sum() + tau * bg) / (se[m].groupby(level=0).sum() + tau)
        return bg, bk, Yw[trn].mean(axis=1)

    def komponen(self, th, prev_y, par=None):
        """Komponen per (kab, bulan). sat_kab = NaN bila taksiran citra tahun th tidak ada."""
        bg, bk, clim = par if par is not None else self.par
        Yw = self.Yw
        es = self.E[th] if th in self.E.columns else pd.Series(np.nan, index=Yw.index)
        prev = Yw[prev_y].fillna(clim) if prev_y in Yw.columns else clim
        return pd.DataFrame({"sat_kab": es.to_numpy() * bk.reindex(es.index.get_level_values(0)).to_numpy(),
                             "klim": clim.to_numpy(), "musiman": prev.to_numpy()}, index=es.index)

    def _bobot(self, cols):
        """Bobot NNLS dari prediksi leave-one-year-out, terpisah untuk kota dan kabupaten."""
        rows = []
        for th in self.tr:
            lain = [x for x in self.tr if x != th]
            if th == 2019 or not lain:
                continue
            rows.append(self.komponen(th, th - 1, self._latih(lain)).assign(y=self.Yw[th].to_numpy()).dropna())
        d = pd.concat(rows)
        iskota = d.index.get_level_values(0).isin(self.kota)
        semua = nnls(d[cols].to_numpy(), d.y.to_numpy())[0]
        w = {}
        for nama, m in (("kota", iskota), ("kab", ~iskota)):
            w[nama] = nnls(d.loc[m, cols].to_numpy(), d.y[m].to_numpy())[0] if m.sum() >= 3 * len(cols) * 12 else semua
        return w

    def prediksi(self, th, prev_y):
        """Prediksi per (kab, bulan) untuk tahun th. Kolom 'gabungan' dan 'citra_ada'."""
        p = self.komponen(th, prev_y)
        iskota = p.index.get_level_values(0).isin(self.kota)
        ada = p.sat_kab.notna().to_numpy()
        g3 = np.where(iskota, p[FIT3].fillna(0).to_numpy() @ self.w3["kota"], p[FIT3].fillna(0).to_numpy() @ self.w3["kab"])
        g2 = np.where(iskota, p[FIT2].to_numpy() @ self.w2["kota"], p[FIT2].to_numpy() @ self.w2["kab"])
        p["gabungan"] = np.where(ada, g3, g2)
        p["citra_ada"] = ada
        return p


def prakiraan(tr=None, targets=()):
    y = muat_bps()
    Yw = y.pivot(index=["kabkota", "bulan"], columns="tahun", values="y")
    tr = list(tr) if tr is not None else tahun_final(Yw)
    ES, kota = muat_citra(Yw), daftar_kota()
    model = {h: Gabungan(Yw, ES[h], tr, kota) for h in sorted({h for _, _, h in targets})}
    out, kosong = {}, []
    for ty, tm, h in targets:
        p = model[h].prediksi(ty, max(tr))
        p = p[p.index.get_level_values(1) == tm]
        if not p.citra_ada.all():
            kosong.append(f"{ty}-{tm:02d} (lead {h}): {int((~p.citra_ada).sum())} wilayah")
        out[(ty, tm)] = pd.Series(p.gabungan.to_numpy(), index=p.index.get_level_values(0))
    if kosong:
        warnings.warn("K1: taksiran citra tidak tersedia, memakai bobot cadangan tanpa citra untuk " + "; ".join(kosong), stacklevel=2)
    df = pd.DataFrame(out)
    df.attrs["citra_kosong"] = kosong
    return df


def uji_bergulir(lead_h, tahun_uji=None, kausal_bps=True):
    """Prediksi bulanan per kab dengan batas informasi nyata (BPS tahun lalu rilis 1 Maret), tahun uji 2022.. tahun final terakhir."""
    y = muat_bps()
    Yw = y.pivot(index=["kabkota", "bulan"], columns="tahun", values="y")
    fin = tahun_final(Yw)
    ES, kota = muat_citra(Yw), daftar_kota()
    E, L = ES[lead_h], LEAD[lead_h]
    tahun_uji = tahun_uji or [t for t in fin if t >= 2022]
    parts = []
    for Y in tahun_uji:
        for m in range(1, 13):
            C = dt.date(Y, m, 1) - dt.timedelta(days=L)
            tr = [t for t in fin if t < Y] if (C >= dt.date(Y, 3, 1) or not kausal_bps) else [t for t in fin if t < Y - 1]
            if len(tr) < 2:
                continue
            p = Gabungan(Yw, E, tr, kota).prediksi(Y, max(tr))
            p = p[p.index.get_level_values(1) == m].copy()
            p["y"], p["tahun"], p["lead"] = Yw[Y].reindex(p.index).to_numpy(), Y, lead_h
            parts.append(p)
    R = pd.concat(parts).dropna(subset=["y"])
    R["kota"] = R.index.get_level_values(0).isin(kota)
    return R


def galat_empiris(simpan=True):
    """Pita galat relatif per (lead, jenis wilayah) dari uji bergulir: kuantil P10/P90 log(aktual/prediksi), luas panen bulanan per kab.

    sd_relatif = (q90 - q10) / (2 x 1,2816), sehingga P10-P90 = prediksi x exp(q10..q90). Baris kecil (< 50 ha) dibuang.
    """
    rows = []
    for h in LEAD:
        R = uji_bergulir(h)
        R = R[(R.y >= 50) & (R.gabungan > 0)]
        lr = np.log(R.y / R.gabungan)
        for jenis, m in (("KABUPATEN", ~R.kota), ("KOTA", R.kota)):
            q10, q50, q90 = np.quantile(lr[m], [0.1, 0.5, 0.9])
            rows.append((h, jenis, int(m.sum()), q10, q50, q90, (q90 - q10) / (2 * Z80)))
    G = pd.DataFrame(rows, columns=["lead", "jenis", "n", "q10_log", "q50_log", "q90_log", "sd_relatif"])
    if simpan:
        G.round(4).to_csv(GALAT_CSV, index=False)
    return G


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--galat", action="store_true", help="hitung ulang pita galat empiris dan simpan ke " + GALAT_CSV)
    a = ap.parse_args()
    if a.galat:
        print(galat_empiris().round(3).to_string(index=False))
