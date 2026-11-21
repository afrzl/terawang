"""TERAWANG K1 · Penaksir panen dari kurva kehijauan EVI (hijau awal, puncak, menguning), bukan dari genangan.

Celah awan: (a) interpolasi linear antar pengamatan jernih, (b) fusi radar (regresi VH -> EVI) lalu interpolasi sisa celah.
Per titik, state machine pada EVI: naik >= A_NAIK dari palung = hijau awal; puncak; turun >= A_TURUN dari puncak = menguning.
Tiga penaksir tanggal panen: hijau awal + L, puncak + L, menguning + L. Parameter dipilih dari data latih 2025; uji Jan-Sep 2026.

  python scripts/k1/hijau_awal_s2.py
"""
import datetime as dt
import itertools
import sys

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor

sys.path.insert(0, "scripts/k1")
import siklus_tanam as st  # noqa: E402
from fusi_s1_s2 import fitur  # noqa: E402

HARI = 12


def isi_celah(x):
    ok = ~np.isnan(x)
    if ok.sum() < len(x) * 0.5:
        return None
    return np.interp(np.arange(len(x)), np.arange(len(x))[ok], x[ok])


def halus(x):
    return pd.Series(x).rolling(3, center=True, min_periods=1).median().rolling(3, center=True, min_periods=1).mean().to_numpy()


def siklus_evi(x, a_naik, a_turun, puncak_min=0.5):
    out, n = [], len(x)
    mn, i = x[0], 1
    while i < n:
        if x[i] < mn:
            mn = x[i]
        elif x[i] - mn >= a_naik:
            up, mx, mx_i, j, sen = i, x[i], i, i + 1, None
            while j < n:
                if x[j] > mx:
                    mx, mx_i = x[j], j
                elif mx - x[j] >= a_turun:
                    sen = j
                    break
                j += 1
            if mx >= puncak_min:
                out.append((up, mx_i, sen))
            if sen is None:
                break
            i, mn = sen, x[sen]
        i += 1
    return out


def main():
    v = pd.read_csv(st.TITIK)
    s = pd.read_csv("data/satelit/s2_titik_12harian_kabkota.csv.gz")
    tgl = [dt.date.fromisoformat(c) for c in v.columns[3:]]
    kab = s.kabkota.to_numpy()
    W = len(tgl)
    evi = s[[c for c in s.columns if c.startswith("evi_")]].to_numpy(float)

    # fusi: tebak EVI dari VH pada jendela berawan (dilatih pada jendela jernih <= 2025)
    vh = np.vstack([x if (x := st.bersihkan(r)) is not None else np.full(W, np.nan) for r in v.iloc[:, 3:].to_numpy()])
    doy = np.array([(t + dt.timedelta(days=HARI // 2)).timetuple().tm_yday for t in tgl], float)
    X = fitur(vh, doy)
    ye = evi.reshape(-1)
    win = np.tile(np.arange(W), len(s))
    cut = max(i for i, t in enumerate(tgl) if t <= dt.date(2025, 12, 31))
    tr = np.where(~np.isnan(ye) & (win <= cut))[0]
    tr = np.random.default_rng(7).choice(tr, size=min(400_000, len(tr)), replace=False)
    pe = HistGradientBoostingRegressor(max_iter=250, learning_rate=0.08, random_state=7).fit(X[tr], ye[tr]).predict(X)
    evi_fusi = np.where(np.isnan(ye), pe, ye).reshape(evi.shape)

    def bulan_idx(i):
        t = tgl[0] + dt.timedelta(days=HARI * i + HARI // 2)
        return t.year * 12 + t.month

    sawah = pd.read_csv(st.SAWAH).drop_duplicates("kabkota").set_index("kabkota").luas_sawah_ha
    bps = st.sql("""select w.nama_repo kabkota, w.jenis, p.granularitas g, p.tahun, p.bulan_awal ba, p.bulan_akhir bk,
                           p.luas_panen_ha luas, p.produksi_beras_ton beras
                    from silver.produksi_padi p join ref.wilayah w on w.id=p.wilayah_id where w.level='KABKOTA'""")
    prov = st.sql("select p.tahun*12+p.bulan_awal t, p.luas_panen_ha luas from silver.produksi_padi p join ref.wilayah w on w.id=p.wilayah_id where w.level='PROVINSI' and p.granularitas='BULANAN'").set_index("t").luas
    b25 = bps[(bps.g == "BULANAN") & (bps.tahun == 2025)].copy()
    b25["t"] = b25.tahun * 12 + b25.ba
    s26 = bps[(bps.g == "PERIODE") & (bps.tahun == 2026) & (bps.ba == 1) & (bps.bk == 9)].set_index("kabkota")
    s25 = bps[(bps.g == "PERIODE") & (bps.tahun == 2025) & (bps.ba == 1) & (bps.bk == 9)].set_index("kabkota")
    T = s26[["jenis", "luas", "beras"]].join(s25[["luas", "beras"]].add_suffix("_lalu"))
    T["prod25"] = T.beras_lalu / T.luas_lalu
    jml = pd.Series(kab).value_counts()

    def est_dari(idx_list, lag):
        rows = {}
        for k, evs in zip(kab, idx_list):
            for e in evs:
                if e is None:
                    continue
                m = bulan_idx(e + lag)
                rows[(k, m)] = rows.get((k, m), 0) + 1
        return pd.DataFrame([(k, m, c / jml[k] * sawah[k]) for (k, m), c in rows.items()], columns=["kabkota", "t", "est"])

    def metrik(est):
        dd = b25.merge(est, on=["kabkota", "t"], how="left").fillna({"est": 0})
        if dd.est.sum() == 0:
            return np.nan, np.nan, np.nan
        beta = dd.luas.sum() / dd.est.sum()
        dc = dd.copy()
        for c in ("luas", "est"):
            dc[c] = dc[c] - dc.groupby("kabkota")[c].transform("mean")
        j = dd.groupby("ba")[["luas", "est"]].sum()
        return beta, j.luas.corr(j.est), dc.luas.corr(dc.est)

    def uji(est, beta):
        lo, hi = 2026 * 12 + 1, 2026 * 12 + 9
        e26 = est[(est.t >= lo) & (est.t <= hi)].groupby("kabkota").est.sum() * beta
        t = T.join(e26.rename("l")).fillna({"l": 0})
        t["b"] = t.l * t.prod25
        kb, kt = t[t.jenis == "KABUPATEN"], t[t.jenis == "KOTA"]
        jt = est.groupby("t").est.sum() * beta
        wj = st.wape([prov[2026 * 12 + m] for m in range(1, 10)], [jt.get(2026 * 12 + m, 0) for m in range(1, 10)])
        return st.wape(t.beras, t.b), st.wape(kb.beras, kb.b), st.wape(kt.beras, kt.b), (t.b.sum() - t.beras.sum()) / t.beras.sum() * 100, wj

    sumber = {"optik + interpolasi": evi, "fusi radar + interpolasi": evi_fusi}
    hasil = []
    for nama, E in sumber.items():
        seri = [isi_celah(E[i]) for i in range(len(E))]
        seri = [halus(x) if x is not None else None for x in seri]
        for a_n, a_t in itertools.product((0.15, 0.20, 0.25, 0.30), (0.15, 0.20, 0.25, 0.30)):
            ev = [siklus_evi(x, a_n, a_t) if x is not None else [] for x in seri]
            for pen, ix, Ls in [("hijau awal", 0, (5, 6, 7)), ("puncak", 1, (2, 3, 4)), ("menguning", 2, (0, 1, 2))]:
                idxs = [[c[ix] for c in e] for e in ev]
                for L in Ls:
                    est = est_dari(idxs, L)
                    if est.empty:
                        continue
                    beta, rj, rk = metrik(est)
                    hasil.append(dict(sumber=nama, pen=pen, a_n=a_n, a_t=a_t, L=L, rj=rj, rk=rk, beta=beta, est=est,
                                      ip=np.mean([len(e) for e in ev])))
    print("Latih 2025: 3 terbaik per sumber dan penaksir (korelasi dalam kabupaten)")
    for nama in sumber:
        for pen in ("hijau awal", "puncak", "menguning"):
            top = sorted([h for h in hasil if h["sumber"] == nama and h["pen"] == pen], key=lambda h: -(h["rk"] if h["rk"] == h["rk"] else -9))
            if not top:
                continue
            b = top[0]
            w = uji(b["est"], b["beta"])
            print(f"  {nama:25s} {pen:10s} EVI naik>={b['a_n']:.2f} turun>={b['a_t']:.2f} L={b['L']} | siklus/titik {b['ip']:.2f} | latih r Jatim {b['rj']:.2f}, dalam kab {b['rk']:.2f}"
                  f" | UJI 2026 WAPE {w[0]:.1f}% (kab {w[1]:.1f}%, kota {w[2]:.1f}%, bias {w[3]:+.1f}%, Jatim bulanan {w[4]:.1f}%)")
    print(f"\nPembanding: aturan banjir optik 14,0% (korelasi dalam kab 0,76); fusi banjir 14,8%; baseline BPS {st.wape(T.beras, T.beras_lalu):.1f}%")
    best = sorted(hasil, key=lambda h: -(h["rk"] if h["rk"] == h["rk"] else -9))[0]
    jt = best["est"].groupby("t").est.sum() * best["beta"]
    print(f"\nTerbaik di latih: {best['sumber']} / {best['pen']}. Jatim bulanan (ribu ha) bulan BPS26 citra26 | BPS25 citra25")
    for m in range(1, 10):
        print(f"  {m:2d}  {prov[2026 * 12 + m] / 1000:5.0f} {jt.get(2026 * 12 + m, 0) / 1000:6.0f} | {prov[2025 * 12 + m] / 1000:5.0f} {jt.get(2025 * 12 + m, 0) / 1000:6.0f}")


if __name__ == "__main__":
    main()
