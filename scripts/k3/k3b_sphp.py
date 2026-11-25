"""TERAWANG K3b · Rekomendasi penyaluran SPHP (Bulog cabang -> kab) dari stok K2 dan peringatan harga K3a.

Masukan: stok K2 (cakupan rerata dan sd per kab-bulan, Nov 2026-Jan 2027), peluang harga > HET (K3a, medium), jarak jalan, stok Bulog.
Model : program linear (HiGHS) dua tahap berbasis skenario (stochastic LP). Keputusan x[i,j,t] = ton dari sumber i ke kab j pada bulan t.
        Stok kab-skenario = rerata K2 + derau (faktor bersama 0,4 bulan + derau khas kab) + kiriman kumulatif.
        Minimalkan rata-rata (bobot x kekurangan di bawah target) + h x (kelebihan di atas batas) + lambda x ton-km.
        Target cakupan = (1 + beta x P(harga>HET)) bulan konsumsi; bobot = 1 + gamma x P(harga>HET).
Sumber: Bulog cabang (anggaran rilis dibatasi) dan, opsional, kab surplus (stok di atas surplus_batas bulan konsumsi).
"""
import sys

import numpy as np
import pandas as pd
import scipy.sparse as sp
from scipy.optimize import linprog

sys.path.insert(0, "scripts/k2")
import model_stok as ms  # noqa: E402

BULAN = [(2026, 11), (2026, 12), (2027, 1)]
CABANG = {1: "Kota Surabaya", 2: "Kota Surabaya", 3: "Bojonegoro", 4: "Kota Madiun", 5: "Kota Kediri", 6: "Bondowoso", 7: "Kota Malang",
          8: "Kota Probolinggo", 9: "Banyuwangi", 10: "Tulungagung", 11: "Jember", 12: "Pamekasan", 13: "Ponorogo"}  # lokasi kantor cabang (ASUMSI)
SD_JANGKAR = 0.4
PARAM = dict(beta=0.25, gamma=1.0, h=0.3, lam=1 / 2000, eps=0.01, Rtot=0.15, Rbln=0.10, frac=(0.3, 1.0, 1.0), hold=0.02, S=100, kab_surplus=False, surplus_batas=1.5, deterministik=False)


def bulan_dari(hari_ini):
    """Bulan berjalan dan dua bulan sesudahnya, mis. 2026-11-25 -> [(2026, 11), (2026, 12), (2027, 1)]."""
    y, m = hari_ini.year, hari_ini.month
    return [(y + (m - 1 + i) // 12, (m - 1 + i) % 12 + 1) for i in range(3)]


def muat(k2_rinci=None, k3_harga=None):
    """k2_rinci: rincian K2 (kab, tahun, bulan, stok_ton, cak, sd); k3_harga: keluaran K3a (komoditas, kab, horizon_hari, p_di_atas_het).
    Tanpa argumen dibaca dari CSV di data/satelit (jalankan k2_operasional.py --keluar dan k3_harga_operasional.py dulu)."""
    w, P, C, D, bl = ms.muat()
    kab = list(w.index)
    R = pd.read_csv("data/satelit/k2_operasional_2026.csv") if k2_rinci is None else k2_rinci
    k2 = {b: R[(R.tahun == b[0]) & (R.bulan == b[1])].set_index("kab").reindex(kab) for b in BULAN}
    nov = k2[BULAN[0]]
    K = pd.read_csv("data/satelit/k3_harga_operasional.csv") if k3_harga is None else k3_harga
    K = K[K.komoditas == 1]
    ph = {b: K[K.horizon_hari == (7 if b == BULAN[0] else 28)].set_index("kab").p_di_atas_het.reindex(kab).fillna(0) for b in BULAN}
    peng = ms.sql("select cabang_id, sum(volume_kg) v from silver.pengadaan_bulog where tahun=2025 group by 1")
    pj = peng.assign(kab=peng.cabang_id.map(CABANG)).groupby("kab").v.sum()
    return dict(kab=kab, C=(nov.stok_ton / nov.cak).to_numpy(), D=D.loc[kab, kab].to_numpy(), k2=k2, ph=ph, nodes=list(pj.index),
                share=(pj / pj.sum()).to_numpy(), S0=float(bl.akhir.iloc[9] / 1e3), w=w)  # S0: stok Bulog akhir Okt 2025 (ASLI) sebagai proksi Okt 2026 (ASUMSI), rb ton


def instans(M, p, seed):
    C = M["C"]
    n, T = len(M["kab"]), len(BULAN)
    A = np.array([M["k2"][b].cak.to_numpy() for b in BULAN]).T * C[:, None]
    sd = np.array([M["k2"][b].sd.to_numpy() for b in BULAN]).T
    sdi = np.sqrt(np.maximum(sd ** 2 - SD_JANGKAR ** 2, 0)) * C[:, None]
    ph = np.array([M["ph"][b].to_numpy() for b in BULAN]).T
    rng = np.random.default_rng(seed)
    z0, z = rng.standard_normal(p["S"]), rng.standard_normal((p["S"], n))
    noise = SD_JANGKAR * C[None, :, None] * z0[:, None, None] + sdi[None] * z[:, :, None]
    return A, ph, noise


def solusi(M, p, A, ph, noise):
    kab, C, D = M["kab"], M["C"], M["D"]
    n, T = len(kab), len(BULAN)
    ix = {k: i for i, k in enumerate(kab)}
    nb = len(M["nodes"])
    ks = bool(p["kab_surplus"])
    sloc = [ix[k] for k in M["nodes"]] + (list(range(n)) if ks else [])
    ns = len(sloc)
    nx = ns * n * T
    if p["deterministik"]:
        noise = np.zeros((1,) + A.shape)
    S = noise.shape[0]
    X = lambda i, j, t: (i * n + j) * T + t
    # aliran bersih kumulatif ke (j,t): masuk dari semua sumber (tidak dari diri sendiri bila sumber kab) dikurangi keluar bila j sumber kab
    r, c, v = [], [], []
    for j in range(n):
        for t in range(T):
            for tau in range(t + 1):
                for i in range(ns):
                    if i >= nb and sloc[i] == j:
                        continue
                    r.append(j * T + t); c.append(X(i, j, tau)); v.append(1.0)
                if ks:
                    for jj in range(n):
                        if jj != j:
                            r.append(j * T + t); c.append(X(nb + j, jj, tau)); v.append(-1.0)
    Flow = sp.csr_matrix((v, (r, c)), shape=(n * T, nx))
    tgt = (1 + p["beta"] * ph) * C[:, None]
    upr = (1.5 + p["beta"] * ph) * C[:, None]
    wgt = 1 + p["gamma"] * ph
    nU = S * n * T
    cost = np.zeros(nx + 2 * nU)
    for i in range(ns):
        for j in range(n):
            for t in range(T):
                cost[X(i, j, t)] = p["lam"] * D[sloc[i], j] + p["eps"] + p["hold"] * (T - 1 - t)
    cost[nx:nx + nU] = np.tile(wgt.reshape(-1), S) / S
    cost[nx + nU:] = p["h"] / S
    base = (A[None] + noise).reshape(S, -1)  # S x (n*T) dengan indeks j*T+t
    ones = sp.csr_matrix(np.ones((S, 1)))
    FlowS = sp.kron(ones, Flow)
    I = sp.identity(nU, format="csr")
    Z = sp.csr_matrix((nU, nU))
    row1 = sp.hstack([-FlowS, -I, Z])  # tgt - base - flow <= u
    b1 = -(np.tile(tgt.reshape(-1), S) - base.reshape(-1))
    row2 = sp.hstack([FlowS, Z, -I])  # base + flow - upr <= o
    b2 = -(base.reshape(-1) - np.tile(upr.reshape(-1), S))
    Rtot, Rbln = p["Rtot"] * M["S0"] * 1e3, p["Rbln"] * M["S0"] * 1e3
    rr, cc, bb = [], [], []
    k = 0
    for t in range(T):  # anggaran bulanan Bulog
        for i in range(nb):
            for j in range(n):
                rr.append(k); cc.append(X(i, j, t))
        bb.append(Rbln * p["frac"][t]); k += 1
    for i in range(nb):  # anggaran per cabang (porsi pengadaan 2025)
        for j in range(n):
            for t in range(T):
                rr.append(k); cc.append(X(i, j, t))
        bb.append(M["share"][i] * Rtot); k += 1
    for i in range(nb):  # anggaran total
        for j in range(n):
            for t in range(T):
                rr.append(k); cc.append(X(i, j, t))
    bb.append(Rtot); k += 1
    # (baris total terakhir menumpuk semua i; perbaiki indeks)
    rr = [x if idx < len(rr) - nb * n * T else k - 1 for idx, x in enumerate(rr)]
    if ks:
        for j in range(n):
            for t in range(T):
                for tau in range(t + 1):
                    for jj in range(n):
                        rr.append(k); cc.append(X(nb + j, jj, tau))
                bb.append(max(A[j, t] - p["surplus_batas"] * C[j], 0)); k += 1
    Rm = sp.csr_matrix((np.ones(len(rr)), (rr, cc)), shape=(k, nx))
    Rm = sp.hstack([Rm, sp.csr_matrix((k, 2 * nU))])
    res = linprog(cost, A_ub=sp.vstack([row1, row2, Rm]).tocsr(), b_ub=np.concatenate([b1, b2, bb]), bounds=(0, None), method="highs")
    assert res.status == 0, res.message
    return res.x[:nx].reshape(ns, n, T), sloc, nb


def evaluasi(M, p, A, ph, noise, x, sloc, nb):
    C, D = M["C"], M["D"]
    n, T = len(M["kab"]), len(BULAN)
    tgt = (1 + p["beta"] * ph) * C[:, None]
    wgt = 1 + p["gamma"] * ph
    masuk = np.cumsum(sum(x[i] for i in range(x.shape[0]) if True), axis=1)
    keluar = np.zeros((n, T))
    for i in range(nb, x.shape[0]):
        keluar[sloc[i]] += np.cumsum(x[i].sum(axis=0))
    stok0 = A[None] + noise
    stok1 = stok0 + (masuk - keluar)[None]
    k0, k1 = np.maximum(tgt[None] - stok0, 0), np.maximum(tgt[None] - stok1, 0)
    dm = np.zeros(x.shape[2])
    tot = x.sum()
    tonkm = sum(x[i, j].sum() * D[sloc[i], j] for i in range(x.shape[0]) for j in range(n))
    bulog = x[:nb].sum()
    # ketepatan: bagian kiriman (akhir periode) yang menutup kekurangan awal, rata-rata skenario
    masuk_net = (masuk - keluar)[:, -1]
    guna = np.minimum(np.maximum(masuk_net, 0)[None], k0.max(axis=2)).sum(axis=1) / max(np.maximum(masuk_net, 0).sum(), 1e-9)
    return dict(ton_rb=tot / 1e3, ton_bulog_rb=bulog / 1e3, km_rata=tonkm / max(tot, 1e-9),
                kurang_sebelum_rb=(k0.sum(axis=(1, 2)) / T).mean() / 1e3, kurang_sesudah_rb=(k1.sum(axis=(1, 2)) / T).mean() / 1e3,
                kurang_berbobot_turun_pct=(1 - (wgt[None] * k1).sum() / (wgt[None] * k0).sum()) * 100,
                defisit_sebelum_pct=(stok0 < 0.75 * C[None, :, None]).mean() * 100, defisit_sesudah_pct=(stok1 < 0.75 * C[None, :, None]).mean() * 100,
                ketepatan_pct=guna.mean() * 100 if np.isfinite(guna.mean()) else np.nan)


def main():
    import argparse
    import json
    import subprocess
    ap = argparse.ArgumentParser()
    ap.add_argument("--simpan", action="store_true")
    a = ap.parse_args()
    R, M, p, met = hitung()
    print("Anggaran rilis Bulog: %.0f rb ton (%.0f%% stok proksi %.0f rb ton); rencana %.0f rb ton, jarak rata-rata %.0f km" % (p["Rtot"] * M["S0"], p["Rtot"] * 100, M["S0"], R.volume_ton.sum() / 1e3, (R.volume_ton * R.jarak_km).sum() / R.volume_ton.sum()))
    print("Per bulan (rb ton):", R.groupby("bulan").volume_ton.sum().div(1e3).round(1).to_dict(), "| rute:", len(R), "| kab penerima:", R.ke.nunique())
    print("Kekurangan berbobot turun %.1f%%; peluang cakupan < 0,75 turun %.1f%% -> %.1f%% (skenario uji K2)" % (met["kurang_berbobot_turun_pct"], met["defisit_sebelum_pct"], met["defisit_sesudah_pct"]))
    print(R.sort_values("volume_ton", ascending=False).head(10).round(0).to_string(index=False))
    R.to_csv("data/satelit/k3b_rekomendasi_sphp.csv", index=False)
    ids = M["w"].id.to_dict()
    if a.simpan:
        par = parameter_run(M, p, met)
        rid = int(ms.sql(f"insert into app.model_run (jenis, nama_versi, parameter, selesai_pada) values ('K3_SPHP','k3b_lp_stokastik_2026_11','{json.dumps(par)}'::jsonb, now()) returning id").iloc[0, 0])
        vals = [f"({rid},{r.tahun},{r.bulan},{ids[r.dari]},{ids[r.ke]},{r.volume_ton},{r.jarak_km},'DUMMY')" for r in R.itertuples()]
        res = subprocess.run(["psql", "-d", "terawang", "-v", "ON_ERROR_STOP=1", "-c", "insert into app.rekomendasi_sphp (model_run_id,tahun,bulan,dari_id,ke_id,volume_ton,jarak_jalan_km,jenis_data) values " + ",".join(vals)], capture_output=True, text=True)
        if res.returncode:
            raise SystemExit("gagal menyimpan: " + res.stderr[:400])
        print(f"tersimpan: model_run {rid}, {len(vals)} rute di app.rekomendasi_sphp (jenis_data DUMMY: bergantung anggaran rilis dan stok Bulog proksi)")


def parameter_run(M, p, met):
    return {"model": "LP stokastik berbasis skenario (S=150) dari stok K2 + peluang harga > HET K3a", "periode": [f"{t}-{b:02d}" for t, b in BULAN], "param": {k: (list(v) if isinstance(v, tuple) else v) for k, v in p.items()},
            "stok_bulog_proksi_rb_ton": M["S0"], "asumsi": "stok Bulog 2026 = proksi akhir Okt 2025; anggaran rilis 15% stok; lokasi cabang dipetakan ke kab (asumsi)", "metrik_uji": {k: float(v) for k, v in met.items()}}


def hitung(hari_ini=None, k2_rinci=None, k3_harga=None):
    """Rencana SPHP bulan berjalan sampai +2. Kembalikan (R, M, p, metrik): R = tahun, bulan, dari, ke (nama kab), volume_ton, jarak_km."""
    global BULAN
    if hari_ini is not None:
        BULAN = bulan_dari(hari_ini)
    M = muat(k2_rinci, k3_harga)
    p = dict(PARAM, S=150)
    A, ph, nz = instans(M, p, 1)
    x, sloc, nb = solusi(M, p, A, ph, nz)
    te = instans(M, dict(p, S=500), 4242)[2]
    met = evaluasi(M, p, A, ph, te, x, sloc, nb)
    kab, D = M["kab"], M["D"]
    n, T = len(kab), len(BULAN)
    rows = []
    for i in range(nb):
        for j in range(n):
            for t in range(T):
                if x[i, j, t] >= 50:  # abaikan kiriman < 50 ton
                    rows.append((BULAN[t][0], BULAN[t][1], M["nodes"][i], kab[j], x[i, j, t], D[sloc[i], j]))
    R = pd.DataFrame(rows, columns=["tahun", "bulan", "dari", "ke", "volume_ton", "jarak_km"]).groupby(["tahun", "bulan", "dari", "ke"], as_index=False).agg(volume_ton=("volume_ton", "sum"), jarak_km=("jarak_km", "first"))
    return R, M, p, met


if __name__ == "__main__":
    main()
