"""TERAWANG K3a · Peringatan dini beras medium melewati HET dalam h hari: gabungan EW60 + regresi logistik + Panel Harga Bapanas.

Dasar uji: ai-notes/evaluasi-k3-peringatan.md (scripts/k3/uji_k3_peringatan_episode.py, uji_k3_fitur_bapanas.py, 26 Nov 2026).
  Kejadian KAPAN: harga kab di atas HET kapan saja pada (t, t+h], untuk kab yang pada t masih <= HET.
  EW60:  peluang dari sebaran empiris kenaikan maksimum log harga pada (t, t+h], jendela 365 hari, bobot paruh 60 hari.
  LOGIT: regresi logistik berbobot kelas (C=0,3) pada fitur harga eceran kecil + fitur Bapanas (harga penggilingan / HET, dll.),
         dilatih sejak Jun 2024 (HET Rp12.500), tanpa periode yang melintasi pergantian HET.
  Skor gabungan = rerata peringkat persentil EW60 dan LOGIT, diukur terhadap sebaran skor backtest. WASPADA bila skor >= ambang;
  ambang = F1 maksimum pada backtest walk-forward bulanan sejak 22 Agu 2025 (model dilatih ulang tiap bulan).

Masukan: P / P2 (harga medium / premium harian per kab, kolom = nama kab di ref.wilayah), harga pasar medium (CSV SISKAPERBAPO),
folder Panel Harga Bapanas (kabkota_harian_<nama>.csv dari scripts/bapanas/ambil_panel_harga.py).
"""
from __future__ import annotations

import os

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

PARUH = 60
JENDELA = 365
MULAI_LATIH = pd.Timestamp("2024-06-01")
MULAI_UJI = pd.Timestamp("2025-08-22")
# HET beras medium Jawa sebelum HET kini (app.ambang_harga), dipakai fitur riwayat (atas90/atas365/hari_sejak_atas) dan label.
# Rp10.900 (Mar 2023) dan Rp12.500 (Jun 2024) DITAKSIR dari harga yang menumpuk di satu nilai, belum diverifikasi ke teks resmi.
HET_RIWAYAT = [(pd.Timestamp("2023-03-15"), 10900.0), (pd.Timestamp("2024-06-01"), 12500.0)]
KECIL = ["d", "di_het", "atas90", "atas365", "hari_sejak_atas", "pasar_di_het", "pasar_di_atas", "pasar_maks", "m28", "prov_atas"]
BAPANAS = ["pg_het", "pg_m28", "pg_hilang", "gkg_m28", "gkp_m28", "sphp_ada", "sphp_prov"]
KOLOM = KECIL + BAPANAS
BERKAS_BAPANAS = {"pg": "beras_medium_penggilingan", "gkg": "gkg_penggilingan", "gkp": "gkp_petani", "sphp": "beras_sphp_konsumen"}


def het_seri(idx: pd.DatetimeIndex, het_kini: float) -> pd.Series:
    s = pd.Series(np.nan, index=idx)
    for t0, v in HET_RIWAYAT:
        s[s.index >= t0] = v
    s[s.index >= MULAI_UJI] = het_kini
    return s


def tumpuk(df: pd.DataFrame) -> pd.Series:
    s = df.rename_axis(columns="kab").stack(future_stack=True)
    s.index.names = ["tgl", "kab"]
    return s


def maju_maks(df: pd.DataFrame, h: int) -> pd.DataFrame:
    """maksimum pada (t, t+h]"""
    return df[::-1].rolling(h, min_periods=h).max()[::-1].shift(-1)


def _kons(v, P):
    return pd.DataFrame(np.repeat(np.asarray(v)[:, None], P.shape[1], 1), index=P.index, columns=P.columns)


def pasar(folder_harga: str, H: pd.Series) -> pd.DataFrame:
    ps = pd.read_csv(os.path.join(folder_harga, "pasar_harian_beras_medium.csv.gz"), parse_dates=["tanggal"]).dropna(subset=["harga_rp_kg"])
    ps = ps[ps.tanggal >= H.first_valid_index()]
    ps["het"] = H.reindex(ps.tanggal).to_numpy()
    ps["di_atas"] = ps.harga_rp_kg > ps.het
    ps["di_het"] = (ps.harga_rp_kg - ps.het).abs() < 1
    g = ps.groupby(["tanggal", "kabkota"])
    return pd.DataFrame({"pasar_di_atas": g.di_atas.mean(), "pasar_di_het": g.di_het.mean(), "pasar_maks": np.log(g.harga_rp_kg.max())})


def fitur_harga(P: pd.DataFrame, H: pd.Series, pas: pd.DataFrame) -> pd.DataFrame:
    L, lh = np.log(P), np.log(H)
    d = (-L).add(lh, axis=0)  # log(HET/p), >= 0 bila di bawah HET
    atas = P.gt(H, axis=0).astype(float).where(P.notna() & H.notna().to_numpy()[:, None])
    hs = atas.copy()
    for c in atas.columns:
        r, out = 400, []
        for v in atas[c].to_numpy():
            r = 0 if v == 1 else min(r + 1, 400)
            out.append(r)
        hs[c] = out
    F = {"d": d, "di_het": (d.abs() < 1e-4).astype(float), "atas90": atas.rolling(90, min_periods=30).mean(),
         "atas365": atas.rolling(365, min_periods=90).mean(), "hari_sejak_atas": np.log1p(hs), "m28": L.diff(28),
         "prov_atas": _kons(atas.mean(axis=1), P)}
    for k in ("pasar_di_atas", "pasar_di_het", "pasar_maks"):
        F[k] = pas[k].unstack().reindex(index=P.index, columns=P.columns)
    F["pasar_maks"] = F["pasar_maks"].sub(lh, axis=0)
    return pd.concat({k: tumpuk(v) for k, v in F.items()}, axis=1)


def _seri_bapanas(folder: str, nama: str, P: pd.DataFrame) -> pd.DataFrame:
    b = pd.read_csv(os.path.join(folder, f"kabkota_harian_{nama}.csv"), parse_dates=["tanggal"])
    b["kab"] = b.kabkota_sumber.str.strip().map(lambda s: "Kabupaten " + s[5:].strip() if s.startswith("Kab.") else s)
    return b.pivot_table(index="tanggal", columns="kab", values="harga_rp_kg").reindex(index=P.index, columns=P.columns)


def fitur_bapanas(folder: str, P: pd.DataFrame, H: pd.Series) -> pd.DataFrame:
    """Diketahui pada t, isi maju <= 7 hari; kab tanpa data memakai median Jatim + penanda pg_hilang."""
    lh = np.log(H)
    S = {k: _seri_bapanas(folder, v, P) for k, v in BERKAS_BAPANAS.items()}
    pgf = np.log(S["pg"].ffill(limit=7))
    pg_prov = np.log(S["pg"].median(axis=1).ffill(limit=7))
    pg = pgf.apply(lambda c: c.fillna(pg_prov))
    med = lambda k: np.log(S[k].median(axis=1).ffill(limit=7)).diff(28)  # noqa: E731
    sp = S["sphp"]
    F = {"pg_het": pg.sub(lh, axis=0), "pg_m28": pg.diff(28), "pg_hilang": pgf.isna().astype(float),
         "gkg_m28": _kons(med("gkg"), P), "gkp_m28": _kons(med("gkp"), P),
         "sphp_ada": sp.notna().astype(float).rolling(7, min_periods=1).mean(), "sphp_prov": _kons(sp.notna().mean(axis=1), P)}
    return pd.concat({k: tumpuk(v) for k, v in F.items()}, axis=1)


def _latih(tr: pd.DataFrame):
    X, y = np.nan_to_num(tr[KOLOM].to_numpy()), tr.y.to_numpy().astype(int)
    w = np.where(y == 1, (len(y) - y.sum()) / max(y.sum(), 1), 1.0)  # bobot kelas seimbang
    m = make_pipeline(StandardScaler(), LogisticRegression(C=0.3, max_iter=3000))
    m.fit(X, y, logisticregression__sample_weight=w)
    return m


def _p_ew(G: pd.DataFrame, t: pd.Timestamp, d: np.ndarray) -> np.ndarray:
    pool = G[(G.tgt <= t) & (G.tgt > t - pd.Timedelta(days=JENDELA))]
    e = pool["max"].to_numpy()
    w = np.exp(-np.log(2) * (t - pool.tgt).dt.days.to_numpy() / PARUH)
    o = np.argsort(e)
    e, cw = e[o], np.cumsum(w[o]) / w.sum()
    k = np.searchsorted(e, d, side="right")
    return 1 - np.where(k > 0, cw[np.maximum(k - 1, 0)], 0.0)


def _pct(ref: np.ndarray, v: np.ndarray) -> np.ndarray:
    """Peringkat persentil v terhadap sebaran ref (sama dengan rank(pct=True) di dalam ref)."""
    r = np.sort(ref)
    return np.searchsorted(r, v, side="right") / len(r)


def hitung(P: pd.DataFrame, het_kini: float, folder_harga: str, folder_bapanas: str, horizon=(7, 14, 21, 28), log=print) -> tuple[pd.DataFrame, dict]:
    """Kembalikan (S, kal): S = kab, horizon_hari, p_ew, p_logit, skor, waspada (hanya kab <= HET pada tanggal acuan);
    kal = per horizon {ambang, f1, presisi, recall, terdeteksi, alarm_palsu, kejadian, auc, pr_auc}."""
    P = P[P.index >= HET_RIWAYAT[0][0] - pd.Timedelta(days=30)]
    H = het_seri(P.index, het_kini)
    X = fitur_harga(P, H, pasar(folder_harga, H)).join(fitur_bapanas(folder_bapanas, P, H))
    L = np.log(P)
    atas = P.gt(H, axis=0).astype(float).where(P.notna() & H.notna().to_numpy()[:, None])
    t_acuan = P.index.max()
    kini = X.xs(t_acuan, level="tgl", drop_level=False)
    kini = kini[kini.d >= 0]
    hasil, kal = [], {}
    for h in horizon:
        y = tumpuk(maju_maks(atas, h).where((H.shift(-h) == H), axis=0)).rename("y")
        D = X.join(y)
        D["tgt"] = D.index.get_level_values("tgl") + pd.Timedelta(days=h)
        D = D[(D.index.get_level_values("tgl") >= MULAI_LATIH) & (D.d >= 0)].dropna(subset=["y"])
        G = pd.DataFrame({"max": tumpuk(maju_maks(L, h) - L)}).dropna()
        G["tgt"] = G.index.get_level_values("tgl") + pd.Timedelta(days=h)
        tg = D.index.get_level_values("tgl")
        ew, lg = pd.Series(np.nan, index=D.index), pd.Series(np.nan, index=D.index)
        for bm in pd.date_range(MULAI_UJI.replace(day=1), t_acuan, freq="MS"):
            sel = (tg >= max(bm, MULAI_UJI)) & (tg < bm + pd.offsets.MonthBegin(1))
            if not sel.any():
                continue
            te = D[sel]
            lg[sel] = _latih(D[D.tgt < bm]).predict_proba(np.nan_to_num(te[KOLOM].to_numpy()))[:, 1]
            for t in te.index.get_level_values("tgl").unique():
                s = sel & (tg == t)
                ew[s] = _p_ew(G, t, D.d[s].to_numpy())
        uji = ew.notna()
        ew_b, lg_b, yb = ew[uji].to_numpy(), lg[uji].to_numpy(), D.y[uji].to_numpy().astype(int)
        sk_b = (_pct(ew_b, ew_b) + _pct(lg_b, lg_b)) / 2
        best = (0.0, 1.0, 0, 0)
        for th in np.unique(np.quantile(sk_b, np.linspace(0.80, 0.999, 60))):
            a = sk_b >= th
            tp, fp = int((a & (yb == 1)).sum()), int((a & (yb == 0)).sum())
            f1 = 2 * tp / max(2 * tp + fp + (yb.sum() - tp), 1)
            if f1 > best[0]:
                best = (f1, float(th), tp, fp)
        f1, th, tp, fp = best
        r = pd.Series(sk_b).rank().to_numpy()
        pos, neg = int(yb.sum()), int(len(yb) - yb.sum())
        auc = float((r[yb == 1].sum() - pos * (pos + 1) / 2) / (pos * neg)) if pos and neg else None
        kal[h] = dict(ambang=round(th, 3), f1=round(f1, 3), presisi=round(tp / max(tp + fp, 1), 3), recall=round(tp / max(pos, 1), 3),
                      terdeteksi=tp, alarm_palsu=fp, kejadian=pos, auc=None if auc is None else round(auc, 3),
                      pr_auc=round(float(average_precision_score(yb, sk_b)), 3) if pos else None, baris_uji=int(len(yb)))
        m = _latih(D)  # model kini: semua baris yang labelnya sudah diketahui
        p_ew = _p_ew(G, t_acuan, kini.d.to_numpy())
        p_lg = m.predict_proba(np.nan_to_num(kini[KOLOM].to_numpy()))[:, 1]
        sk = (_pct(ew_b, p_ew) + _pct(lg_b, p_lg)) / 2
        hasil.append(pd.DataFrame({"kab": kini.index.get_level_values("kab"), "horizon_hari": h, "p_ew": p_ew, "p_logit": p_lg,
                                   "skor": sk, "waspada": sk >= th}))
        log(f"  peringatan gabungan {h:2d} hari: ambang skor {th:.3f} | F1 {f1:.2f} | presisi {kal[h]['presisi']:.2f} recall {kal[h]['recall']:.2f} "
            f"| PR-AUC {kal[h]['pr_auc']} | {int((sk >= th).sum())} kab WASPADA hari ini")
    return pd.concat(hasil, ignore_index=True), kal
