"""TERAWANG K1 · Uji mundur: apakah indeks ONI (NOAA, anomali Nino 3.4) memperbaiki model gabungan K1?

Skema evaluasi SAMA dengan scripts/k1/uji_k1_ringkas.py:
  - uji bergulir 2022-2025, luas panen bulanan per kab (WAPE, MAPE y>50 ha, MAPE kota), batas informasi BPS 1 Maret;
  - uji akhir produksi beras Jan-Sep 2026 per kab/kota (WAPE, MAPE, MAPE kab, MAPE kota), latih <= 2025.

Varian ONI (lag k bulan terhadap bulan target; ONI bulan m = musim 3 bulan berpusat di m):
  A  koreksi kali   : gabungan x exp(b * ONI[m-k]); b = OLS tanpa intersep pada log(y/gabungan) prediksi leave-one-year-out
  A3 koreksi musim  : sama, b terpisah per musim panen (Jan-Apr, Mei-Agu, Sep-Des)
  B  komponen tambah: y ~ w1 citra + w2 musiman + w3 tahun-lalu + w4 (musiman x ONI)   (w1-w3 >= 0, w4 bebas)
  B3 komponen musim : seperti B, w4 terpisah per musim (3 kolom)
Semua koefisien dilatih per kelompok kota/kab seperti model operasional, hanya dari tahun latih.

Ketersediaan ONI: nilai berpusat di bulan m butuh SST s.d. bulan m+1, rilis CPC ~awal bulan m+2. Pada tanggal potong
C (= awal bulan target - jarak), ONI yang aman tersedia = pusat <= bulan(C) - 3. Lag minimum jujur: 3 (jarak 0), 4 (28 hari),
5 (56 hari). Lag lebih kecil ditandai BOCOR (memakai informasi masa depan; hanya pembanding batas atas).

  python scripts/k1/uji_oni.py            # tulis data/satelit/k1_uji_oni.csv
"""
import datetime as dt
import sys

import numpy as np
import pandas as pd
from scipy.optimize import lsq_linear, nnls

sys.path.insert(0, "scripts/k1")
import k1_prakiraan as kp  # noqa: E402
from nowcast_eval import muat_bps  # noqa: E402

PERIODE = "data/bps/produksi_padi/kabkota/periode/bps_jatim_padi_kabkota_periode_2025_2026.csv"
ONI_CSV = "data/iklim/noaa_oni_bulanan.csv"
KELUAR = "data/satelit/k1_uji_oni.csv"
LAG_MIN = {0: 3, 1: 4, 2: 5}
MUSIM = {m: (0 if m <= 4 else 1 if m <= 8 else 2) for m in range(1, 13)}

_o = pd.read_csv(ONI_CSV)
ONI = dict(zip(_o.tahun * 12 + _o.bulan - 1, _o.oni))


def oni_baris(idx, th, lag):
    bln = idx.get_level_values(1).to_numpy()
    return np.array([ONI.get(th * 12 + m - 1 - lag, np.nan) for m in bln])


class GabunganONI(kp.Gabungan):
    def __init__(self, Yw, E, tr, kota, varian, lag):
        self.varian, self.lag = varian, lag
        super().__init__(Yw, E, tr, kota)
        self._latih_oni()

    def _loyo(self):
        rows = []
        for th in self.tr:
            lain = [x for x in self.tr if x != th]
            if th == 2019 or not lain:
                continue
            k = self.komponen(th, th - 1, self._latih(lain)).assign(y=self.Yw[th].to_numpy())
            k["oni"] = oni_baris(k.index, th, self.lag)
            rows.append(k.dropna(subset=["sat_kab", "klim", "musiman", "y", "oni"]))
        return pd.concat(rows)

    def _kolom_b(self, d):
        if self.varian == "B":
            return np.c_[d.klim * d.oni]
        s = d.index.get_level_values(1).map(MUSIM).to_numpy()
        return np.c_[[(d.klim * d.oni).to_numpy() * (s == j) for j in range(3)]].T

    def _latih_oni(self):
        if self.varian is None:
            return
        d = self._loyo()
        iskota = d.index.get_level_values(0).isin(self.kota)
        self.koef = {}
        for nama, m in (("kota", iskota), ("kab", ~iskota)):
            dm = d[m]
            if self.varian in ("A", "A3"):
                w = self.w3[nama]
                g = dm[kp.FIT3].to_numpy() @ w
                ok = (dm.y.to_numpy() >= 50) & (g > 0)
                r, x = np.log(dm.y.to_numpy()[ok] / g[ok]), dm.oni.to_numpy()[ok]
                if self.varian == "A":
                    self.koef[nama] = np.array([(x * r).sum() / (x * x).sum()])
                else:
                    s = dm.index.get_level_values(1).map(MUSIM).to_numpy()[ok]
                    self.koef[nama] = np.array([(x[s == j] * r[s == j]).sum() / (x[s == j] ** 2).sum() for j in range(3)])
            else:  # B, B3: komponen tambahan, tiga komponen asli tetap >= 0
                for cols, key in ((kp.FIT3, nama), (kp.FIT2, nama + "_2")):
                    X = np.c_[dm[cols].to_numpy(), self._kolom_b(dm)]
                    nb = X.shape[1] - len(cols)
                    lo = np.r_[np.zeros(len(cols)), -np.inf * np.ones(nb)]
                    self.koef[key] = lsq_linear(X, dm.y.to_numpy(), bounds=(lo, np.inf)).x

    def prediksi(self, th, prev_y):
        p = super().prediksi(th, prev_y)
        if self.varian is None:
            return p
        p["oni"] = oni_baris(p.index, th, self.lag)
        iskota = p.index.get_level_values(0).isin(self.kota)
        s = p.index.get_level_values(1).map(MUSIM).to_numpy()
        if self.varian in ("A", "A3"):
            b = np.zeros(len(p))
            for nama, m in (("kota", iskota), ("kab", ~iskota)):
                kf = self.koef[nama]
                b[m] = kf[0] if self.varian == "A" else kf[s[m]]
            p["gabungan"] = p.gabungan * np.exp(np.clip(b * p.oni.to_numpy(), -0.7, 0.7))
        else:
            ada = p.citra_ada.to_numpy()
            g = np.zeros(len(p))
            for nama, m in (("kota", iskota), ("kab", ~iskota)):
                pm = p[m]
                g3 = np.c_[pm[kp.FIT3].fillna(0).to_numpy(), self._kolom_b(pm)] @ self.koef[nama]
                g2 = np.c_[pm[kp.FIT2].to_numpy(), self._kolom_b(pm)] @ self.koef[nama + "_2"]
                g[m] = np.where(ada[m], g3, g2)
            p["gabungan"] = np.clip(g, 0, None)
        return p


def wape(a, p):
    return np.abs(np.asarray(p) - np.asarray(a)).sum() / np.asarray(a).sum() * 100


def mape(a, p):
    a, p = np.asarray(a, float), np.asarray(p, float)
    return np.mean(np.abs(p - a) / a) * 100


def tr_pada(fin, Y, m, L):
    C = dt.date(Y, m, 1) - dt.timedelta(days=L)
    return [t for t in fin if t < Y] if C >= dt.date(Y, 3, 1) else [t for t in fin if t < Y - 1]


def evaluasi(Yw, ES, kota, fin, h, varian, lag, a26, prod25):
    E, L = ES[h], kp.LEAD[h]
    parts, koef = [], []
    for Y in [t for t in fin if t >= 2022]:
        for m in range(1, 13):
            tr = tr_pada(fin, Y, m, L)
            if len(tr) < 2:
                continue
            g = GabunganONI(Yw, E, tr, kota, varian, lag)
            p = g.prediksi(Y, max(tr))
            p = p[p.index.get_level_values(1) == m].copy()
            p["y"] = Yw[Y].reindex(p.index).to_numpy()
            parts.append(p)
    R = pd.concat(parts).dropna(subset=["y"])
    R["kota"] = R.index.get_level_values(0).isin(kota)
    b = R[R.y > 50]
    parts = []
    for m in range(1, 10):
        tr = tr_pada(fin, 2026, m, L)
        g = GabunganONI(Yw, E, tr, kota, varian, lag)
        p = g.prediksi(2026, max(tr))
        parts.append(p[p.index.get_level_values(1) == m])
        if varian is not None and m == 9:
            koef = g.koef
    S = pd.concat(parts).groupby(level=0)[["gabungan"]].sum().reindex(a26.index).mul(prod25, axis=0)
    k = a26.index.isin(kota)
    return dict(lead=L, varian=varian or "tanpa ONI", lag=lag if varian else np.nan,
                bocor=bool(varian) and lag < LAG_MIN[h],
                bg_wape=wape(R.y, R.gabungan), bg_mape=mape(b.y, b.gabungan), bg_mape_kota=mape(b.y[b.kota], b.gabungan[b.kota]),
                u26_wape=wape(a26, S.gabungan), u26_mape=mape(a26, S.gabungan),
                u26_mape_kab=mape(a26[~k], S.gabungan[~k]), u26_mape_kota=mape(a26[k], S.gabungan[k]),
                koef_kab_2026=" ".join(f"{v:.3g}" for v in koef.get("kab", [])) if koef else "")


def main():
    y = muat_bps()
    Yw = y.pivot(index=["kabkota", "bulan"], columns="tahun", values="y")
    ES, kota, fin = kp.muat_citra(Yw), kp.daftar_kota(), kp.tahun_final(Yw)
    P = pd.read_csv(PERIODE).set_index("nama_repo")
    prod25 = P.produksi_beras_jan_sep_2025_ton / P.luas_panen_jan_sep_2025_ha
    a26 = P.produksi_beras_jan_sep_2026s_ton
    rows = []
    for h in kp.LEAD:
        rows.append(evaluasi(Yw, ES, kota, fin, h, None, 0, a26, prod25))
        print(pd.DataFrame(rows[-1:]).round(2).to_string(index=False, header=len(rows) == 1), flush=True)
        for varian in ("A", "A3", "B", "B3"):
            for lag in range(1, 7):
                rows.append(evaluasi(Yw, ES, kota, fin, h, varian, lag, a26, prod25))
                print(pd.DataFrame(rows[-1:]).round(2).to_string(index=False, header=False), flush=True)
    pd.DataFrame(rows).round(3).to_csv(KELUAR, index=False)


if __name__ == "__main__":
    main()
