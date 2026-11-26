"""TERAWANG K3a · Uji perbaikan peringatan dini lewat HET (beras medium), tanpa database.

Pertanyaan: kenapa F1/recall peringatan rendah, dan apa yang menaikkannya?
Periode uji sama dengan k3_harga_operasional.py (22 Agu 2025 s.d. data terakhir, HET Rp13.500), kab yang masih <= HET pada tanggal asal.

  Definisi kejadian
    TITIK   harga tepat pada hari t+h > HET (definisi operasional sekarang)
    KAPAN   harga > HET pada hari mana pun dalam (t, t+h]  ("akan lewat HET dalam h hari")
    MATERI  seperti KAPAN, tetapi hanya lintasan yang >= 1% di atas HET (>= Rp13.635) atau bertahan >= 7 hari
            (membuang lintasan sesaat, mis. rata-rata 3 pasar naik Rp33 karena 1 pasar berubah)

  Model peluang
    EW60    sebaran galat empiris gabungan semua kab, bobot paruh 60 hari (operasional sekarang)
    LOGIT   regresi logistik berbobot kelas (cost-sensitive) dengan fitur per kab
    GBM     HistGradientBoosting berbobot kelas, fitur sama
  LOGIT/GBM dilatih ulang tiap awal bulan uji (walk-forward) hanya pada baris yang targetnya sudah terjadi. Data latih memakai HET
  historis (Rp10.900 lalu Rp12.500, ditaksir dari harga yang menumpuk di angka itu; tanggal PERLU VERIFIKASI), jadi kejadian latih
  jauh lebih banyak daripada hanya sejak Agu 2025.

  Ambang
    oracle  ambang ber-F1 maksimum dipilih PADA data uji (cara skrip operasional sekarang; optimistis)
    jujur   ambang ber-F1 maksimum dipilih pada 6 bulan terakhir data latih (sebelum bulan uji), lalu dipakai ke bulan uji
            (EW60: ambang dipilih dari backtest bulan-bulan uji sebelumnya)

  Ukuran: PR-AUC (average precision), ROC-AUC, Brier, F1/presisi/recall per kab-hari, dan recall EPISODE: dari episode lewat HET
  (hari pertama > HET setelah <= HET), berapa yang didahului >= 1 peringatan dalam h hari sebelumnya.

  python scripts/k3/uji_k3_peringatan.py         # ±5 menit, hasil ke data/satelit/k3_uji_peringatan.csv
"""
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

DIR = "data/siskaperbapo/harga_beras/"
HOR = (7, 14, 21, 28)
MULAI_UJI = pd.Timestamp("2025-08-22")
MULAI_LATIH = pd.Timestamp("2023-03-15")
PARUH = 60
EVS = ("TITIK", "KAPAN", "MATERI")
# HET beras medium zona Jawa; dua yang pertama ditaksir dari pengelompokan harga pasar (PERLU VERIFIKASI ke Perbadan)
HET_SERI = [(pd.Timestamp("2023-03-15"), 10900.0), (pd.Timestamp("2024-06-01"), 12500.0), (pd.Timestamp("2025-08-22"), 13500.0)]


def het_di(idx):
    s = pd.Series(np.nan, index=idx)
    for t0, v in HET_SERI:
        s[s.index >= t0] = v
    return s


def muat():
    h = pd.read_csv(DIR + "kabkota_harian_beras_medium.csv", parse_dates=["tanggal"])
    P = h.pivot(index="tanggal", columns="kabkota", values="harga_rata2_rp_kg").asfreq("D").ffill(limit=3)
    h2 = pd.read_csv(DIR + "kabkota_harian_beras_premium.csv", parse_dates=["tanggal"])
    P2 = h2.pivot(index="tanggal", columns="kabkota", values="harga_rata2_rp_kg").reindex(P.index).ffill(limit=3)
    ps = pd.read_csv(DIR + "pasar_harian_beras_medium.csv.gz", parse_dates=["tanggal"]).dropna(subset=["harga_rp_kg"])
    H = het_di(P.index)
    ps["het"] = H.reindex(ps.tanggal).to_numpy()
    ps["di_atas"] = ps.harga_rp_kg > ps.het
    ps["di_het"] = (ps.harga_rp_kg - ps.het).abs() < 1
    g = ps.groupby(["tanggal", "kabkota"])
    pas = pd.DataFrame({"pasar_di_atas": g.di_atas.mean(), "pasar_di_het": g.di_het.mean(), "pasar_maks": np.log(g.harga_rp_kg.max())})
    return P, P2, H, pas


def tumpuk(df):
    s = df.rename_axis(columns="kab").stack(future_stack=True)
    s.index.names = ["tgl", "kab"]
    return s


def fitur(P, P2, H, pas):
    L, lh = np.log(P), np.log(H)
    d = (-L).add(lh, axis=0)  # log(HET/p), >= 0 bila di bawah HET
    atas = P.gt(H, axis=0).astype(float).where(P.notna())
    hs = atas.copy()
    for c in atas.columns:
        r, out = 400, []
        for v in atas[c].to_numpy():
            r = 0 if v == 1 else min(r + 1, 400)
            out.append(r)
        hs[c] = out
    ch = (L.diff().abs() > 1e-9).astype(float)
    doy = P.index.dayofyear.to_numpy()

    def kons(v):
        return pd.DataFrame(np.repeat(np.asarray(v)[:, None], P.shape[1], 1), index=P.index, columns=P.columns)

    F = {
        "d": d, "di_het": (d.abs() < 1e-4).astype(float), "dekat1": (d < 0.01).astype(float),
        "atas30": atas.rolling(30, min_periods=10).mean(), "atas90": atas.rolling(90, min_periods=30).mean(),
        "atas365": atas.rolling(365, min_periods=90).mean(), "hari_sejak_atas": np.log1p(hs),
        "m7": L.diff(7), "m14": L.diff(14), "m28": L.diff(28), "m56": L.diff(56),
        "gerak28": ch.rolling(28).mean(), "vol28": L.diff().rolling(28).std(),
        "prov_d": kons(d.median(axis=1)), "prov_atas": kons(atas.mean(axis=1)), "prov_m28": kons(L.median(axis=1).diff(28)),
        "prem_gap": np.log(P2) - L, "prem_m28": np.log(P2).diff(28),
        "s": kons(np.sin(2 * np.pi * doy / 365.25)), "c": kons(np.cos(2 * np.pi * doy / 365.25)),
    }
    for k in ("pasar_di_atas", "pasar_di_het", "pasar_maks"):
        F[k] = pas[k].unstack().reindex(index=P.index, columns=P.columns)
    F["pasar_maks"] = F["pasar_maks"].sub(lh, axis=0)
    return pd.concat({k: tumpuk(v) for k, v in F.items()}, axis=1), list(F)


def panjang_rangkaian(atas):
    run = atas.copy()
    for c in atas.columns:
        a = atas[c].fillna(0).to_numpy()
        out, i, n = np.zeros(len(a)), 0, len(a)
        while i < n:
            if a[i] == 1:
                j = i
                while j < n and a[j] == 1:
                    j += 1
                out[i:j] = j - i
                i = j
            else:
                i += 1
        run[c] = out
    return run


def maju_maks(df, h):
    """maks pada (t, t+h]"""
    return df[::-1].rolling(h, min_periods=h).max()[::-1].shift(-1)


def label(P, H, h, run):
    atas = P.gt(H, axis=0).astype(float).where(P.notna())
    mat = (P.gt(H * 1.01, axis=0) | (run >= 7)).astype(float).where(P.notna())
    sama = H.shift(-h) == H
    Y = {"TITIK": atas.shift(-h), "KAPAN": maju_maks(atas, h), "MATERI": maju_maks(mat, h)}
    return pd.DataFrame({k: tumpuk(v.where(sama, axis=0)) for k, v in Y.items()})


def f1_terbaik(p, y):
    best = (0.0, 1.0, 0.0, 0.0)
    if y.sum() == 0:
        return best
    for th in np.unique(np.quantile(p, np.linspace(0.5, 0.9995, 150))):
        a = p >= th
        tp, fp = (a & (y == 1)).sum(), (a & (y == 0)).sum()
        f1 = 2 * tp / max(2 * tp + fp + (y.sum() - tp), 1)
        if f1 > best[0]:
            best = (f1, th, tp / max(tp + fp, 1), tp / max(y.sum(), 1))
    return best


def p_ew60(G, kol, te):
    pe = np.full(len(te), np.nan)
    tg = te.index.get_level_values("tgl")
    dd = te.d.to_numpy()
    for t in np.unique(tg):
        t = pd.Timestamp(t)
        pool = G[(G.tgt <= t) & (G.tgt > t - pd.Timedelta(days=365))]
        e = pool[kol].to_numpy()
        w = np.exp(-np.log(2) * (t - pool.tgt).dt.days.to_numpy() / PARUH)
        o = np.argsort(e)
        e, cw = e[o], np.cumsum(w[o]) / w.sum()
        sel = tg == t
        k = np.searchsorted(e, dd[sel], side="right")
        pe[sel] = 1 - np.where(k > 0, cw[np.maximum(k - 1, 0)], 0.0)
    return pe


def latih(nm, tr, cols, ev):
    X, y = tr[cols].to_numpy(), tr[ev].to_numpy().astype(int)
    w = np.where(y == 1, (len(y) - y.sum()) / max(y.sum(), 1), 1.0)  # bobot kelas seimbang
    if nm == "LOGIT":
        m = make_pipeline(StandardScaler(), LogisticRegression(C=0.3, max_iter=3000))
        m.fit(np.nan_to_num(X), y, logisticregression__sample_weight=w)
        return lambda Z: m.predict_proba(np.nan_to_num(Z))[:, 1]
    m = HistGradientBoostingClassifier(max_depth=3, learning_rate=0.05, max_iter=200, min_samples_leaf=200, l2_regularization=1.0, random_state=0)
    m.fit(X, y, sample_weight=w)
    return lambda Z: m.predict_proba(Z)[:, 1]


def episode(al_ser, P, H, h, ev, run):
    """Recall episode dan jumlah hari-alarm per episode."""
    atas = P.gt(H, axis=0)
    ep = kena = 0
    akhir = P.index.max()
    for kab in P.columns:
        s = atas[kab]
        mulai = s.index[s & ~s.shift(1, fill_value=True) & (s.index >= MULAI_UJI + pd.Timedelta(days=h))]
        for t0 in mulai:
            if ev == "MATERI":
                seg_run = run.at[t0, kab]
                t1 = t0 + pd.Timedelta(days=int(seg_run) - 1)
                if not (seg_run >= 7 or (P.loc[t0:t1, kab] > H[t0] * 1.01).any()):
                    continue
            if t0 > akhir:
                continue
            ep += 1
            idx = pd.MultiIndex.from_tuples([(t, kab) for t in pd.date_range(t0 - pd.Timedelta(days=h), t0 - pd.Timedelta(days=1))])
            kena += int(al_ser.reindex(idx).fillna(False).astype(bool).any())
    return dict(episode=ep, recall_episode=kena / max(ep, 1), hari_alarm_per_episode=al_ser.sum() / max(ep, 1))


def main():
    P, P2, H, pas = muat()
    X, cols = fitur(P, P2, H, pas)
    L = np.log(P)
    run = panjang_rangkaian(P.gt(H, axis=0).astype(float).where(P.notna()))
    bulan = pd.date_range(MULAI_UJI.replace(day=1), P.index.max(), freq="MS")
    rows = []
    for h in HOR:
        D = X.join(label(P, H, h, run))
        D["tgt"] = D.index.get_level_values("tgl") + pd.Timedelta(days=h)
        D = D[(D.index.get_level_values("tgl") >= MULAI_LATIH) & (D.d >= 0)]
        G = pd.DataFrame({"end": tumpuk(L.shift(-h) - L), "max": tumpuk(maju_maks(L, h) - L)}).dropna()
        G["tgt"] = G.index.get_level_values("tgl") + pd.Timedelta(days=h)
        buf = {}
        for bm in bulan:
            be = bm + pd.offsets.MonthBegin(1)
            tg = D.index.get_level_values("tgl")
            te0 = D[(tg >= max(bm, MULAI_UJI)) & (tg < be)]
            tr0 = D[D.tgt < bm]
            for ev in EVS:
                te = te0.dropna(subset=[ev])
                if te.empty:
                    continue
                tr = tr0.dropna(subset=[ev])
                out = {"EW60": p_ew60(G, "end" if ev == "TITIK" else "max", te)}
                th = {}
                # ambang EW60 jujur: dari backtest bulan uji sebelumnya (bulan pertama: ambang operasional 0,2)
                prev = buf.get(("EW60", ev))
                th["EW60"] = f1_terbaik(prev.p.to_numpy(), prev.y.to_numpy())[1] if prev is not None and prev.y.sum() >= 3 else 0.2
                rec = tr[tr.tgt >= bm - pd.Timedelta(days=183)]
                for nm in ("LOGIT", "GBM"):
                    f = latih(nm, tr, cols, ev)
                    out[nm] = f(te[cols].to_numpy())
                    th[nm] = f1_terbaik(f(rec[cols].to_numpy()), rec[ev].to_numpy().astype(int))[1]
                for nm, p in out.items():
                    df = pd.DataFrame({"y": te[ev].to_numpy().astype(int), "p": p, "alarm": p >= th[nm]}, index=te.index)
                    buf[(nm, ev)] = pd.concat([buf[(nm, ev)], df]) if (nm, ev) in buf else df
            print(f"h={h} {bm:%Y-%m} selesai", flush=True)
        for (nm, ev), df in buf.items():
            y, p = df.y.to_numpy(), df.p.to_numpy()
            f1o, _, pro, reo = f1_terbaik(p, y)
            a = df.alarm.to_numpy()
            tp, fp = (a & (y == 1)).sum(), (a & (y == 0)).sum()
            r = dict(h=h, kejadian_def=ev, model=nm, n=len(df), kejadian=int(y.sum()), prevalensi=y.mean(),
                     pr_auc=average_precision_score(y, p), roc_auc=roc_auc_score(y, p), brier=np.mean((p - y) ** 2),
                     f1_oracle=f1o, presisi_oracle=pro, recall_oracle=reo,
                     f1_jujur=2 * tp / max(2 * tp + fp + (y.sum() - tp), 1), presisi_jujur=tp / max(tp + fp, 1), recall_jujur=tp / max(y.sum(), 1))
            r.update(episode(df.alarm, P, H, h, ev, run))
            rows.append(r)
    R = pd.DataFrame(rows).sort_values(["kejadian_def", "h", "model"])
    R.round(4).to_csv("data/satelit/k3_uji_peringatan.csv", index=False)
    kol = ["kejadian_def", "h", "model", "kejadian", "prevalensi", "pr_auc", "roc_auc", "f1_oracle", "f1_jujur", "presisi_jujur", "recall_jujur",
           "episode", "recall_episode", "hari_alarm_per_episode"]
    with pd.option_context("display.width", 260, "display.max_columns", 30):
        print(R[kol].round(3).to_string(index=False))


if __name__ == "__main__":
    main()
