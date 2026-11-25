"""TERAWANG K3a · Uji varian peringatan dini harga (tanpa database, dari CSV SISKAPERBAPO di repo).

Pembanding: model operasional sekarang (k3_harga_operasional.py) = harga hari terakhir + sebaran galat empiris gabungan semua kab,
jendela 365 hari, ambang WASPADA per horizon dipilih F1 maksimum.

Varian yang diuji (rekomendasi dokumen "Referensi metodologi model TERAWANG", 25 Nov 2026):
  W180, W90      jendela galat lebih pendek (menanggapi pergeseran rezim, mendekati conformal adaptif)
  EW60           galat dibobot eksponensial, paruh waktu 60 hari
  MOM            sebaran galat bersyarat keadaan momentum: perubahan log harga 14 hari terakhir (turun / datar / naik)
  ANOM           sebaran galat bersyarat anomali harga gaya FAO: z = (pertumbuhan 90 hari - rerata) / sd pada 365 hari terakhir,
                 dikelompokkan normal (< 0,5), waspada (0,5-1), tinggi (>= 1)
  MOM+ANOM       keduanya
  ACI            pita P10-P90 dengan conformal adaptif (Gibbs & Candes 2021): tingkat kuantil disetel daring tiap hari

Ukuran (uji sejak 22 Agu 2025, saat HET Rp13.500 / Rp14.900 berlaku; galat hanya yang targetnya sudah terjadi pada tanggal asal):
  - peluang melewati HET (kab yang masih <= HET): Brier, Brier skill terhadap model sekarang, AUC, F1 pada ambang terbaik
  - nilai ekonomi relatif (Richardson 2000) pada rasio biaya/rugi 0,1 / 0,2 / 0,3 dengan ambang = rasio biaya/rugi
  - cakupan dan lebar pita P10-P90 (nominal 80%), MAPE harga titik

  python scripts/k3/uji_k3_varian.py            # keluaran ke layar + data/satelit/k3_uji_varian.csv
"""
import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score

HOR = (7, 14, 21, 28)
MULAI_UJI = pd.Timestamp("2025-08-22")
HET = {"medium": 13500.0, "premium": 14900.0}
CSV = "data/siskaperbapo/harga_beras/kabkota_harian_beras_{}.csv"


def harian(kom):
    h = pd.read_csv(CSV.format(kom), parse_dates=["tanggal"])
    return h.pivot(index="tanggal", columns="kabkota", values="harga_rata2_rp_kg").asfreq("D").ffill(limit=3)


def keadaan(L):
    """Keadaan per (tanggal, kab) yang diketahui pada tanggal asal."""
    d14 = L - L.shift(14)
    mom = pd.DataFrame(np.select([d14 < -0.002, d14 > 0.002], [0, 2], 1), index=L.index, columns=L.columns).where(d14.notna())
    g90 = L - L.shift(90)
    mu, sd = g90.rolling(365, min_periods=180).mean(), g90.rolling(365, min_periods=180).std()
    z = (g90 - mu) / sd.replace(0, np.nan)
    anom = pd.DataFrame(np.select([z >= 1, z >= 0.5], [2, 1], 0), index=L.index, columns=L.columns).where(z.notna())
    return mom, anom


def tabel(L, h, mom, anom):
    def st(df, nama):
        s = df.stack().rename(nama).reset_index()
        s.columns = ["tgl", "kab", nama]
        return s
    y = st(L.shift(-h) - L, "y")
    y = y.merge(st(L, "lp"), on=["tgl", "kab"]).merge(st(mom, "mom"), on=["tgl", "kab"], how="left").merge(st(anom, "anom"), on=["tgl", "kab"], how="left")
    y["tgt"] = y.tgl + pd.Timedelta(days=h)
    y[["mom", "anom"]] = y[["mom", "anom"]].fillna(-1)  # keadaan belum terdefinisi (awal deret) = kelompok sendiri
    return y.dropna(subset=["lp"])


VARIAN = {
    "SEKARANG (W365)": dict(w=365),
    "W180": dict(w=180),
    "W90": dict(w=90),
    "EW60": dict(w=365, hl=60),
    "MOM": dict(w=365, by=["mom"]),
    "ANOM": dict(w=365, by=["anom"]),
    "MOM+ANOM": dict(w=365, by=["mom", "anom"]),
}


def peluang_dan_pita(kn, te, w, hl=None, by=None, qs=(0.1, 0.5, 0.9)):
    """Untuk tiap baris uji: P(y > d) dan kuantil galat, dari galat yang targetnya sudah terjadi dalam jendela w hari."""
    n = len(te)
    pe, Q = np.full(n, np.nan), np.full((n, len(qs)), np.nan)
    kn = kn.dropna(subset=["y"])
    for t, sub in te.groupby("tgl"):
        pool = kn[(kn.tgt <= t) & (kn.tgt > t - pd.Timedelta(days=w))]
        groups = [((), sub.index)] if not by else list(sub.groupby(by if len(by) > 1 else by[0]).groups.items())
        for key, idx in groups:
            pl = pool
            if by:
                key = key if isinstance(key, tuple) else (key,)
                m = np.ones(len(pool), bool)
                for b, v in zip(by, key):
                    m &= (pool[b] == v).to_numpy()
                pl = pool[m] if m.sum() >= 200 else pool  # terlalu sedikit -> kembali ke sebaran gabungan
            e = pl.y.to_numpy()
            wt = np.exp(-np.log(2) * (t - pl.tgt).dt.days.to_numpy() / hl) if hl else np.ones(len(e))
            o = np.argsort(e)
            e, wt = e[o], wt[o]
            cw = np.cumsum(wt) / wt.sum()
            pos = te.index.get_indexer(idx)
            d = te.loc[idx, "d"].to_numpy()
            k = np.searchsorted(e, d, side="right")
            pe[pos] = 1 - np.where(k > 0, cw[np.maximum(k - 1, 0)], 0.0)
            Q[pos] = np.array([e[min(np.searchsorted(cw, q), len(e) - 1)] for q in qs])
    return pe, Q


def f1_terbaik(p, ev):
    best = (0.0, np.nan, 0, 0)
    for th in np.arange(0.05, 0.75, 0.05):
        tp, fp = ((p >= th) & (ev == 1)).sum(), ((p >= th) & (ev == 0)).sum()
        f1 = 2 * tp / max(2 * tp + fp + (ev.sum() - tp), 1)
        if f1 > best[0]:
            best = (f1, th, tp, fp)
    return best


def nilai_ekonomi(p, ev, a):
    """Nilai ekonomi relatif (Richardson 2000) untuk rasio biaya/rugi a, bertindak bila p >= a."""
    s = ev.mean()
    act = p >= a
    H = (act & (ev == 1)).sum() / max(ev.sum(), 1)
    F = (act & (ev == 0)).sum() / max((ev == 0).sum(), 1)
    e_clim, e_perf = min(a, s), a * s
    e_fc = a * (H * s + F * (1 - s)) + (1 - H) * s
    return (e_clim - e_fc) / (e_clim - e_perf) if e_clim > e_perf else np.nan


def aci(kn, te, w, gamma=0.005, alpha=0.2):
    """Pita P10-P90 conformal adaptif: alpha_t disetel daring dari kejadian di luar pita yang sudah terlihat."""
    tg = sorted(te.tgl.unique())
    a_t, cov, wid = alpha, [], []
    kn = kn.dropna(subset=["y"])
    hist = []
    for t in tg:
        pool = kn[(kn.tgt <= t) & (kn.tgt > t - pd.Timedelta(days=w))].y.to_numpy()
        lo, hi = np.quantile(pool, [np.clip(a_t / 2, 0.001, 0.499), np.clip(1 - a_t / 2, 0.501, 0.999)])
        sub = te[te.tgl == t]
        inside = ((sub.y >= lo) & (sub.y <= hi)).to_numpy()
        cov.append(inside)
        wid.append(np.full(len(sub), hi - lo))
        hist.append((t + pd.Timedelta(days=int(sub.h.iloc[0])), 1 - inside.mean()))
        seen = [e for (tt, e) in hist if tt <= t]  # umpan balik hanya dari galat yang targetnya sudah terjadi
        if seen:
            a_t = a_t + gamma * (alpha - seen[-1])
    return np.concatenate(cov).mean(), np.concatenate(wid).mean()


def main():
    rows = []
    for kom in ("medium", "premium"):
        P = harian(kom)
        L = np.log(P)
        mom, anom = keadaan(L)
        H = HET[kom]
        for h in HOR:
            kn = tabel(L, h, mom, anom)
            te = kn[(kn.tgl >= MULAI_UJI) & (kn.tgt <= P.index.max())].dropna(subset=["y"]).copy().reset_index(drop=True)
            te["h"] = h
            te["d"] = np.log(H) - te.lp
            base_p = None
            for nama, cfg in VARIAN.items():
                pe, Q = peluang_dan_pita(kn, te, **cfg)
                m = (te.d >= 0).to_numpy()  # kab yang masih <= HET
                ev = (te.y > te.d).astype(int).to_numpy()[m]
                p = pe[m]
                if base_p is None:
                    base_p = p.copy()
                brier, b0 = np.mean((p - ev) ** 2), np.mean((base_p - ev) ** 2)
                f1, th, tp, fp = f1_terbaik(p, ev)
                pred = np.exp(te.lp + Q[:, 1])
                act = np.exp(te.lp + te.y)
                cov = ((te.y >= Q[:, 0]) & (te.y <= Q[:, 2])).mean()
                rows.append(dict(komoditas=kom, h=h, varian=nama, kejadian=int(ev.sum()), n=int(m.sum()), brier=brier, bss_vs_sekarang=1 - brier / b0,
                                 auc=roc_auc_score(ev, p) if 0 < ev.sum() < len(ev) else np.nan, f1=f1, ambang_f1=th, terdeteksi=int(tp), alarm_palsu=int(fp),
                                 rev_010=nilai_ekonomi(p, ev, 0.1), rev_020=nilai_ekonomi(p, ev, 0.2), rev_030=nilai_ekonomi(p, ev, 0.3),
                                 cakupan_p10_p90=cov, lebar_pita_pct=np.mean(np.exp(Q[:, 2]) - np.exp(Q[:, 0])) * 100,
                                 mape=np.mean(np.abs(pred - act) / act) * 100))
            c, wdt = aci(kn, te, 365)
            rows.append(dict(komoditas=kom, h=h, varian="ACI (pita saja)", cakupan_p10_p90=c, lebar_pita_pct=wdt * 100))
            print(f"{kom} {h} hari selesai", flush=True)
    R = pd.DataFrame(rows)
    R.round(4).to_csv("data/satelit/k3_uji_varian.csv", index=False)
    kol = ["komoditas", "h", "varian", "kejadian", "brier", "bss_vs_sekarang", "auc", "f1", "terdeteksi", "alarm_palsu", "rev_010", "rev_020", "rev_030", "cakupan_p10_p90", "lebar_pita_pct", "mape"]
    with pd.option_context("display.width", 250, "display.max_columns", 30):
        print(R[kol].round(3).to_string(index=False))


if __name__ == "__main__":
    main()
