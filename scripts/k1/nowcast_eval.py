"""TERAWANG K1 · Evaluasi nowcast dengan batas informasi nyata.

Untuk bulan target (Y, m) dan jarak waktu 'lead' (hari sebelum awal bulan):
  - citra: taksiran dari scripts/k1/nowcast_est.py (hanya informasi sampai tanggal potong, kalibrasi memakai taksiran jarak yang sama);
  - BPS: angka final tahun Y-1 baru tersedia mulai 1 Maret tahun Y (rilis Feb-Mar). Sebelum itu hanya sampai tahun Y-2.
    Data BPS tahun Y sendiri TIDAK dipakai.
Model: musiman (bulan sama di tahun final terakhir), klimatologi, citra per kab, gabungan (bobot NNLS via leave-one-year-out).
Pembanding 'retro': taksiran retrospektif dan semua tahun < Y tersedia (cara yang dipakai sebelumnya).

  python scripts/k1/nowcast_eval.py
"""
import datetime as dt
import io
import subprocess
import sys

import numpy as np
import pandas as pd
from scipy.optimize import nnls

sys.path.insert(0, "scripts/k1")
import siklus_tanam as st  # noqa: E402

MODEL = ("musiman", "klim", "sat_kab", "gabungan")
PREFIX = sys.argv[1] if len(sys.argv) > 1 else "est_nowcast_lead"


def wape(a, p):
    a, p = np.asarray(a, float), np.asarray(p, float)
    return np.abs(p - a).sum() / a.sum() * 100


def sql(q):
    return pd.read_csv(io.StringIO(subprocess.run(["psql", "-d", "terawang", "--csv", "-c", q], capture_output=True, text=True, check=True).stdout))


def muat_bps():
    b = pd.read_csv("data/bps/produksi_padi/kabkota/bulanan/bps_jatim_padi_kabkota_bulanan_luas_panen_2019_2024.csv")
    b25 = pd.read_csv("data/bps/produksi_padi/kabkota/bulanan/bps_jatim_padi_kabkota_bulanan_2025.csv")
    y = pd.concat([b[["nama_repo", "tahun", "bulan", "luas_panen_ha"]], b25[["nama_repo", "tahun", "bulan", "luas_panen_ha"]]]).rename(
        columns={"nama_repo": "kabkota", "luas_panen_ha": "y"})
    y.loc[(y.tahun == 2019) & (y.bulan <= 3), "y"] = np.nan  # awal deret citra belum lengkap
    return y


def wide(df, v):
    d = df.copy()
    d["tahun"] = (d.t - 1) // 12 if "t" in d else d.tahun
    return d


def main():
    y = muat_bps()
    kk = sorted(y.kabkota.unique())
    Yw = y.pivot(index=["kabkota", "bulan"], columns="tahun", values="y")

    def est_wide(est):
        e = est.copy()
        e["tahun"], e["bulan"] = (e.t - 1) // 12, (e.t - 1) % 12 + 1
        e.loc[(e.tahun == 2019) & (e.bulan <= 3), "est"] = np.nan
        return e.pivot(index=["kabkota", "bulan"], columns="tahun", values="est").reindex(Yw.index)

    def latih(ES, tr):
        sy, se = Yw[tr].sum(axis=1, min_count=1), ES[tr].sum(axis=1, min_count=1)
        m = sy.notna() & se.notna() & (se > 0)
        bg = sy[m].sum() / se[m].sum()
        tau = se[m].groupby(level=0).sum().mean() / max(len(tr), 1)
        bk = (sy[m].groupby(level=0).sum() + tau * bg) / (se[m].groupby(level=0).sum() + tau)
        return bg, bk, Yw[tr].mean(axis=1)

    def pred(ES, par, th, prev_y):
        bg, bk, clim = par
        es = ES[th].fillna(0)
        prev = Yw[prev_y].fillna(clim) if prev_y in Yw.columns else clim
        return pd.DataFrame({"sat_kab": es.to_numpy() * bk.reindex(es.index.get_level_values(0)).to_numpy(), "klim": clim.to_numpy(), "musiman": prev.to_numpy()}, index=es.index)

    def bobot(ES, tr):
        rows = []
        for th in tr:
            lain = [x for x in tr if x != th]
            if th == 2019 or len(lain) < 1:
                continue
            d = pred(ES, latih(ES, lain), th, th - 1).assign(y=Yw[th].to_numpy()).dropna()
            rows.append(d)
        if not rows:
            return np.array([0.5, 0.5, 0.0])
        d = pd.concat(rows)
        return nnls(d[["sat_kab", "klim", "musiman"]].to_numpy(), d.y.to_numpy())[0]

    def avail(Yr, m, lead, retro):
        if retro:
            return list(range(2019, Yr))
        C = dt.date(Yr, m, 1) - dt.timedelta(days=lead)
        return list(range(2019, Yr)) if C >= dt.date(Yr, 3, 1) else list(range(2019, Yr - 1))

    def jalan(est, lead, retro):
        ES = est_wide(est)
        hasil = {}  # (tahun) -> DataFrame prediksi per (kab, bulan)
        for Yr in range(2021, 2027):
            parts = []
            tersedia = {m: avail(Yr, m, lead, retro) for m in range(1, 13)}
            for tr in {tuple(v) for v in tersedia.values()}:
                tr = list(tr)
                bulan_g = [m for m, v in tersedia.items() if tuple(v) == tuple(tr)]
                if len(tr) < 2:
                    continue
                par = latih(ES, tr)
                w = bobot(ES, tr)
                if Yr not in ES.columns:
                    continue
                p = pred(ES, par, Yr, max(tr))
                p["gabungan"] = p[["sat_kab", "klim", "musiman"]].to_numpy() @ w
                p = p[p.index.get_level_values(1).isin(bulan_g)]
                parts.append(p)
            if parts:
                hasil[Yr] = pd.concat(parts)
        return hasil

    def ringkas(hasil, nama):
        tot = {m: [] for m in MODEL}
        for Yr in range(2022, 2026):
            p = hasil[Yr]
            a = Yw[Yr].reindex(p.index)
            ok = a.notna()
            js = p.index.get_level_values(1) <= 9
            for m in MODEL:
                qa = a[ok].groupby([a[ok].index.get_level_values(0), (a[ok].index.get_level_values(1) - 1) // 3]).sum()
                qp = p[m][ok].groupby([p[m][ok].index.get_level_values(0), (p[m][ok].index.get_level_values(1) - 1) // 3]).sum()
                tot[m].append((wape(a[ok], p[m][ok]),
                               wape(a[ok & js].groupby(level=0).sum(), p[m][ok & js].groupby(level=0).sum()),
                               wape(a[ok].groupby(level=1).sum(), p[m][ok].groupby(level=1).sum()),
                               wape(qa, qp)))
        print(f"\n[{nama}] rata-rata 2022-2025 (WAPE luas panen): bulanan per kab | triwulan per kab | Jan-Sep per kab | Jatim bulanan")
        for m in MODEL:
            a = np.mean(tot[m], axis=0)
            print(f"   {m:9s} {a[0]:5.1f}% | {a[3]:5.1f}% | {a[1]:5.1f}% | {a[2]:5.1f}%")
        return {m: np.mean(tot[m], axis=0) for m in MODEL}

    bps = sql("""select w.nama_repo kabkota, w.jenis, p.granularitas g, p.tahun, p.bulan_awal ba, p.bulan_akhir bk, p.luas_panen_ha luas, p.produksi_beras_ton beras
                 from silver.produksi_padi p join ref.wilayah w on w.id=p.wilayah_id where w.level='KABKOTA'""")
    s26 = bps[(bps.g == "PERIODE") & (bps.tahun == 2026) & (bps.ba == 1) & (bps.bk == 9)].set_index("kabkota")
    s25 = bps[(bps.g == "PERIODE") & (bps.tahun == 2025) & (bps.ba == 1) & (bps.bk == 9)].set_index("kabkota")
    T0 = s26[["jenis", "luas", "beras"]].join(s25[["luas", "beras"]].add_suffix("_lalu"))
    T0["prod25"] = T0.beras_lalu / T0.luas_lalu

    def uji2026(hasil):
        p = hasil[2026]
        p = p[p.index.get_level_values(1) <= 9].groupby(level=0).sum()
        T = T0.join(p)
        kb, kt = T[T.jenis == "KABUPATEN"], T[T.jenis == "KOTA"]
        out = {}
        for m in MODEL:
            pb = T[m] * T.prod25
            out[m] = (wape(T.beras, pb), wape(kb.beras, kb[m] * kb.prod25), wape(kt.beras, kt[m] * kt.prod25), (pb.sum() - T.beras.sum()) / T.beras.sum() * 100)
        return out

    ringk = {}
    final = {}
    retro_est = pd.read_csv("data/satelit/est_luas_panen_kabkota_bulanan.csv")[["kabkota", "t", "est"]]
    h = jalan(retro_est, 0, True)
    ringk["retro"] = ringkas(h, "RETROSPEKTIF (informasi lengkap, semua tahun < Y tersedia)")
    final["retro"] = uji2026(h)
    for lead in (56, 28, 0):
        est = pd.read_csv(f"data/satelit/{PREFIX}{lead}.csv")[["kabkota", "t", "est"]]
        h = jalan(est, lead, False)
        ringk[lead] = ringkas(h, f"NOWCAST lead {lead} hari ({lead // 7} minggu) sebelum awal bulan")
        final[lead] = uji2026(h)

    print("\n=== UJI AKHIR Jan-Sep 2026, produksi (WAPE semua | kab | kota | bias) ===")
    for k in ("retro", 56, 28, 0):
        nm = "retrospektif" if k == "retro" else f"nowcast lead {k}"
        print(f"\n{nm}")
        for m in MODEL:
            r = final[k][m]
            print(f"   {m:9s} {r[0]:5.1f}% | {r[1]:5.1f}% | {r[2]:5.1f}% | {r[3]:+5.1f}%")
    print("\nPembanding: baseline BPS (bulan sama 2025) = 4,5% (hanya butuh angka tahun lalu yang sudah rilis)")


if __name__ == "__main__":
    main()
