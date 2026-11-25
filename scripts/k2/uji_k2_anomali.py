"""TERAWANG K2 · Uji status stok berbasis ANOMALI neraca terhadap normal musiman (tanpa database, dari CSV di repo).

Masalah model sekarang (lihat evaluasi-model-k2.md): level stok per kab bergantung pada satu jangkar asumsi (mengubah 11-19 dari 38
status), dan cakupan stok tidak berkorelasi dengan harga (r = +0,05 pada 2025).

Usulan: bandingkan neraca bersih 3 bulan terakhir per kab dengan normal musimannya sendiri.
  A_t = ( Σ_{3 bln} P - normal_3bln ) / C        (satuan: bulan konsumsi; normal = rerata periode yang sama pada tahun lain)
Konsumsi dan jangkar stok awal hilang dari perbandingan (keduanya konstan dalam tahun), sehingga status tidak lagi bergantung pada asumsi.

Validasi (teori stok: harga peka hanya saat pasokan ketat, jadi uji peluang kejadian, bukan korelasi):
  kejadian = harga beras medium kab naik >= 2% dalam 28 hari sesudah akhir bulan, atau naik >= 1% LEBIH tinggi dari median Jatim
  skor = -A (makin negatif anomali, makin ketat). Dibandingkan dengan skor cakupan stok model sekarang (k2_stok_kalman_2025.csv).
  Ukuran: AUC (0,5 = acak), dan peluang kejadian pada kuintil anomali terbawah vs sisanya.

  python scripts/k2/uji_k2_anomali.py
"""
import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score

B19 = "data/bps/produksi_padi/kabkota/bulanan/bps_jatim_padi_kabkota_bulanan_luas_panen_2019_2024.csv"
B25 = "data/bps/produksi_padi/kabkota/bulanan/bps_jatim_padi_kabkota_bulanan_2025.csv"
TAH = "data/bps/produksi_padi/kabkota/tahunan/bps_jatim_padi_kabkota_tahunan_2024_2025.csv"
KON = "data/bps/konsumsi_beras/kabkota/tahunan/bps_jatim_konsumsi_beras_kabkota_tahunan_2025.csv"
PEN = "data/bps/penduduk/kabkota/tahunan/bps_jatim_penduduk_kabkota_tahunan_2020_2026.csv"
HARGA = "data/siskaperbapo/harga_beras/kabkota_harian_beras_medium.csv"
K2_LAMA = "data/satelit/k2_stok_kalman_2025.csv"


def nama_harga(s):
    return "Batu" if s == "Kota Batu" else s.replace("Kabupaten ", "")


def produksi_beras():
    """Beras bulanan per kab 2019-2025 = luas panen BPS x rasio beras/luas panen tahunan BPS (2024 untuk 2019-2024, 2025 untuk 2025)."""
    b = pd.read_csv(B19)[["nama_repo", "tahun", "bulan", "luas_panen_ha"]]
    b25 = pd.read_csv(B25)[["nama_repo", "tahun", "bulan", "luas_panen_ha"]]
    y = pd.concat([b, b25])
    t = pd.read_csv(TAH).set_index("nama_repo")
    r24, r25 = t.produksi_beras_2024_ton / t.luas_panen_2024_ha, t.produksi_beras_2025_ton / t.luas_panen_2025_ha
    y["rasio"] = np.where(y.tahun == 2025, y.nama_repo.map(r25), y.nama_repo.map(r24))
    y["P"] = y.luas_panen_ha * y.rasio
    y.loc[(y.tahun == 2019) & (y.bulan <= 3), "P"] = np.nan
    return y.pivot_table(index=["tahun", "bulan"], columns="nama_repo", values="P")


def konsumsi():
    k = pd.read_csv(KON).set_index("nama_repo").konsumsi_beras_2025_kg_kapita_minggu
    p = pd.read_csv(PEN).set_index("nama_repo").penduduk_2025_proyeksi_jiwa
    return k * 30 / 7 * p / 1000  # ton per bulan


def anomali(P, C, jendela=3):
    S = P.rolling(jendela, min_periods=jendela).sum()
    S = S.reset_index()
    out = []
    for th in S.tahun.unique():
        cur = S[S.tahun == th].set_index("bulan").drop(columns="tahun")
        lain = S[S.tahun != th].groupby("bulan").mean().drop(columns="tahun")
        a = (cur - lain.reindex(cur.index)) / C
        a["tahun"] = th
        out.append(a.reset_index())
    return pd.concat(out).melt(id_vars=["tahun", "bulan"], var_name="kab", value_name="A").dropna()


def kejadian_harga():
    h = pd.read_csv(HARGA, parse_dates=["tanggal"])
    h["kab"] = h.kabkota.map(nama_harga)
    P = h.pivot(index="tanggal", columns="kab", values="harga_rata2_rp_kg").asfreq("D").ffill(limit=3)
    L = np.log(P)
    rows = []
    for t in pd.date_range("2022-01-31", "2025-12-31", freq="ME"):
        if t + pd.Timedelta(days=28) > P.index.max():
            break
        d = L.loc[t + pd.Timedelta(days=28)] - L.loc[t]
        rel = d - d.median()
        rows.append(pd.DataFrame({"tahun": t.year, "bulan": t.month, "kab": d.index, "naik": d.to_numpy(), "rel": rel.to_numpy()}))
    return pd.concat(rows).dropna()


def ringkas(df, skor, nama):
    out = []
    for ev_nama, ev in (("naik >= 2% / 28 hari", df.naik >= np.log(1.02)), ("naik >= 1% di atas median Jatim", df.rel >= np.log(1.01))):
        ev = ev.astype(int).to_numpy()
        s = df[skor].to_numpy()
        auc = roc_auc_score(ev, s) if 0 < ev.sum() < len(ev) else np.nan
        q = s >= np.quantile(s, 0.8)
        out.append(dict(skor=nama, kejadian=ev_nama, n=len(ev), jumlah_kejadian=int(ev.sum()), auc=auc,
                        peluang_kuintil_teratas=ev[q].mean(), peluang_sisanya=ev[~q].mean()))
    return out


def main():
    P, C = produksi_beras(), konsumsi()
    A = anomali(P, C)
    H = kejadian_harga()
    D = H.merge(A, on=["tahun", "bulan", "kab"])
    D["skor_anomali"] = -D.A
    print(f"pasangan kab-bulan 2022-2025: {len(D)} ({D.kab.nunique()} kab)")
    res = ringkas(D, "skor_anomali", "ANOMALI 3 bln (usulan), 2022-2025")
    D25 = D[D.tahun == 2025]
    res += ringkas(D25, "skor_anomali", "ANOMALI 3 bln (usulan), 2025")
    lama = pd.read_csv(K2_LAMA)[["kab", "tahun", "bulan", "cak"]]
    D2 = D25.merge(lama, on=["kab", "tahun", "bulan"])
    D2["skor_cak"] = -D2.cak
    res += ringkas(D2, "skor_cak", "CAKUPAN STOK model sekarang, 2025")
    for j in (1, 6):
        Aj = anomali(P, C, j)
        Dj = H.merge(Aj, on=["tahun", "bulan", "kab"])
        Dj["s"] = -Dj.A
        res += ringkas(Dj, "s", f"ANOMALI {j} bln, 2022-2025")
    # tingkat provinsi: anomali produksi Jatim vs median kenaikan harga Jatim (pasar terintegrasi)
    Pj = P.sum(axis=1, min_count=30).to_frame("Jatim")
    Aj = anomali(Pj, pd.Series({"Jatim": C.sum()}))
    Hj = H.groupby(["tahun", "bulan"]).naik.median().rename("naik").reset_index().assign(kab="Jatim", rel=0.0)
    Dp = Hj.merge(Aj, on=["tahun", "bulan", "kab"])
    Dp["s"] = -Dp.A
    r = ringkas(Dp, "s", "ANOMALI 3 bln tingkat PROVINSI, 2022-2025")[0]
    r["korelasi_spearman"] = Dp[["s", "naik"]].corr("spearman").iloc[0, 1]
    res.append(r)
    R = pd.DataFrame(res)
    R.round(4).to_csv("data/satelit/k2_uji_anomali.csv", index=False)
    with pd.option_context("display.width", 200):
        print(R.round(3).to_string(index=False))
    # status usulan (ambang dalam bulan konsumsi), sebaran per tahun
    D["status"] = pd.cut(D.A, [-np.inf, -0.5, -0.2, 0.2, np.inf], labels=["KETAT", "WASPADA", "NORMAL", "LONGGAR"])
    print("\nPeluang harga naik >= 2% / 28 hari menurut status anomali (2022-2025):")
    print(D.groupby("status", observed=True).apply(lambda g: pd.Series({"n": len(g), "peluang_naik": (g.naik >= np.log(1.02)).mean(),
                                                                          "peluang_naik_relatif": (g.rel >= np.log(1.01)).mean()}), include_groups=False).round(3).to_string())


if __name__ == "__main__":
    main()
