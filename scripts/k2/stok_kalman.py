"""TERAWANG K2 · Stok non-Bulog per kabupaten sebagai keadaan laten dengan ketidakpastian (state-space, setara filter/smoother Kalman).

Persamaan keadaan (per kab, bulanan):  x_t = x_{t-1} + u_t + w_t
  u_t = (1 - phi) * produksi_t - konsumsi + arus_masuk - arus_keluar   (bagian yang diketahui)
  w_t ~ N(0, q_t),  q_t = (sigma_phi * produksi_t)^2 + (sigma_C * konsumsi)^2   (ketidakpastian porsi keluar provinsi dan konsumsi)
Pengamatan: satu titik tingkat stok, Juni (akhir bulan 6): cakupan 0,98 bulan konsumsi (survei Cadangan Beras Nasional Juni 2022:
pedagang 1,04 + penggilingan 0,69 = 1,73 juta ton / konsumsi bulanan nasional), galat pengamatan sd 0,4 bulan konsumsi karena nasional
dipakai untuk tiap kabupaten dan tahun 2022 dipakai untuk 2025.
Prior awal difus, sehingga kondisional pada satu pengamatan itu: x_t = x_6 -/+ jumlah (u + w). Rerata dan varians dihitung tertutup.
Keluaran: rerata dan sd cakupan per kab per bulan; P(cakupan < ambang). Kuantil P10/P50/P90 dipetakan ke skenario RENDAH/TENGAH/TINGGI.

Siap menerima pengamatan baru (hasil SCBN provinsi, stok Bulog): tambahkan ke daftar OBS (bulan, cakupan, sd).

  python scripts/k2/stok_kalman.py [--simpan]
"""
import argparse
import json
import subprocess
import sys

import numpy as np
import pandas as pd
from scipy.stats import norm

sys.path.insert(0, "scripts/k2")
import model_stok as ms  # noqa: E402

SIGMA_PHI, SIGMA_C = 0.15, 0.05
OBS = [(6, 0.98, 0.40)]  # (bulan akhir, cakupan bulan konsumsi, sd)


def lintasan(P, C, masuk, keluar, phi):
    """Rerata dan varians stok akhir bulan t=1..12 (ton), dari pengamatan OBS (satu atau lebih) dengan prior awal difus."""
    u = (1 - phi) * P - C + masuk - keluar
    q = (SIGMA_PHI * P) ** 2 + (SIGMA_C * C) ** 2
    # x_t = x_0 + U_t + W_t, W_t = jumlah w; diinformasikan oleh pengamatan y_j = x_j + v_j
    U = np.cumsum(u)
    Q = np.cumsum(q)
    ob = [(j, y * C, (s * C) ** 2) for j, y, s in OBS]
    # x_0 difus: posterior x_0 dari pengamatan tunggal/ganda (GLS). Covarians W_i,W_j = Q_min(i,j)
    idx = [j - 1 for j, _, _ in ob]
    S = np.array([[Q[min(a, b)] for b in idx] for a in idx]) + np.diag([r for _, _, r in ob])
    A = np.ones(len(ob))
    yv = np.array([y - U[j - 1] for j, y, _ in ob])
    Si = np.linalg.inv(S)
    v0 = 1.0 / (A @ Si @ A)
    m0 = v0 * (A @ Si @ yv)
    mean = np.zeros(12)
    var = np.zeros(12)
    for t in range(12):
        c = np.array([Q[min(t, b)] for b in idx])  # Cov(W_t, W_j)
        # kondisional (Gaussian) x_t | pengamatan: x_t = x_0 + U_t + W_t
        gain = c @ Si
        mean[t] = m0 + U[t] + gain @ (yv - m0 * A)
        var[t] = v0 + Q[t] - gain @ c + 0.0
        # tambahan ketidakpastian x_0 yang tersisa: sudah dalam v0
    return mean, np.maximum(var, 1e-9)


def hitung():
    w, P, C, D, bl = ms.muat()
    kab = list(w.index)
    net = P.sum(axis=1) - 12 * C
    F = ms.arus_lp(net, D)
    masuk, keluar = pd.Series(0.0, index=kab), pd.Series(0.0, index=kab)
    masuk[F.columns] = F.sum(axis=0)
    keluar[F.index] = F.sum(axis=1)
    sisa = (net.clip(lower=0) - keluar).clip(lower=0)
    rows = []
    for k in kab:
        p = P.loc[k].to_numpy(float)
        phi = sisa[k] / p.sum() if p.sum() > 0 else 0.0
        mean, var = lintasan(p, C[k], masuk[k] / 12, keluar[k] / 12, phi)
        for t in range(12):
            m, s = mean[t] / C[k], np.sqrt(var[t]) / C[k]
            rows.append((k, ms.TAHUN, t + 1, mean[t], m, s, norm.cdf((ms.AMBANG_TIPIS - m) / s), norm.cdf((ms.AMBANG_CUKUP - m) / s),
                         m + norm.ppf(0.1) * s, m + norm.ppf(0.9) * s))
    R = pd.DataFrame(rows, columns=["kab", "tahun", "bulan", "stok_ton", "cak", "sd", "p_defisit", "p_tipis_atau_defisit", "cak_p10", "cak_p90"])
    R["status"] = np.where(R.p_defisit >= 0.5, "DEFISIT", np.where(R.p_tipis_atau_defisit >= 0.5, "TIPIS", "CUKUP"))
    return R, dict(w=w, C=C, net=net, F=F)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--simpan", action="store_true")
    a = ap.parse_args()
    R, i = hitung()
    C = i["C"]
    print(f"Pengamatan stok: {OBS} (bulan, cakupan bulan konsumsi, sd). Prior awal difus. Ambang CUKUP >= {ms.AMBANG_CUKUP}, DEFISIT < {ms.AMBANG_TIPIS} bulan konsumsi.")
    print("\nJumlah kab per status (status = kategori dengan peluang >= 50%):")
    print(R.pivot_table(index="bulan", columns="status", values="kab", aggfunc="count", fill_value=0).reindex(columns=["CUKUP", "TIPIS", "DEFISIT"], fill_value=0).T.to_string())
    tot = R.groupby("bulan").stok_ton.sum() / 1e3
    print("\nStok non-Bulog seluruh Jatim, rerata posterior (rb ton):", ", ".join(f"{x:.0f}" for x in tot))
    print("Ketidakpastian: sd cakupan rata-rata per bulan (bulan konsumsi):", ", ".join(f"{x:.2f}" for x in R.groupby("bulan").sd.mean()))
    print(f"Peluang defisit rata-rata (semua kab-bulan): {R.p_defisit.mean():.2f}; kab-bulan dengan peluang antara 0,2 dan 0,8 (tidak pasti): {((R.p_defisit > 0.2) & (R.p_defisit < 0.8)).mean() * 100:.0f}%")
    R.to_csv("data/satelit/k2_stok_kalman_2025.csv", index=False)
    if a.simpan:
        w = i["w"]
        par = {"model": "state-space, prior awal difus, 1 pengamatan (SCBN Juni 2022, nasional)", "obs": OBS, "sigma_phi": SIGMA_PHI, "sigma_C": SIGMA_C}
        rid = int(ms.sql(f"insert into app.model_run (jenis, nama_versi, parameter, selesai_pada) values ('K2_STOK','kalman_v1_{ms.TAHUN}','{json.dumps(par)}'::jsonb, now()) returning id").iloc[0, 0])
        ids = w.id.to_dict()
        vals = []
        for r in R.itertuples():
            C_k = C[r.kab]
            for nm, z in (("RENDAH", -1.2816), ("TENGAH", 0.0), ("TINGGI", 1.2816)):
                cak = r.cak + z * r.sd
                vals.append(f"({rid},{ids[r.kab]},{r.tahun},{r.bulan},'{nm}',{cak * C_k},{cak},'{'DEFISIT' if cak < ms.AMBANG_TIPIS else ('TIPIS' if cak < ms.AMBANG_CUKUP else 'CUKUP')}','DUMMY')")
        subprocess.run(["psql", "-d", "terawang", "-c", "insert into app.estimasi_stok (model_run_id,wilayah_id,tahun,bulan,skenario,stok_ton,cakupan_bulan,status,jenis_data) values " + ",".join(vals)], check=True, capture_output=True)
        print(f"tersimpan: model_run {rid}, {len(vals)} baris")


if __name__ == "__main__":
    main()
