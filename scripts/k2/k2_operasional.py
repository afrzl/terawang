"""TERAWANG K2 · Stok beredar per kabupaten: neraca + filter Kalman, memakai prakiraan K1 untuk bulan ke depan (versi operasional dengan data dummy).

Alur:
  produksi  : Jan-Sep 2026 = pola bulanan K1 (gabungan) diskalakan ke total BPS Jan-Sep 2026 per kab (asli); Okt-Nov 2026 = K1 bulan berjalan;
              Des 2026 dan Jan 2027 = PRAKIRAAN K1 (jarak 4 dan 8 minggu). Beras = luas panen x produktivitas beras/ha BPS per kab.
  konsumsi  : penduduk proyeksi 2026 x Susenas Maret 2025 (kg/kapita/minggu x 30/7)
  arus      : optimasi jarak jalan (surplus -> defisit), struktur 2025
  keluar provinsi: hanya dari KELEBIHAN panen: X_t = theta x max(P_t - C, 0); theta dari sisa surplus 2025 (jadi tidak ada pengiriman keluar di
              bulan paceklik), dengan ketidakpastian 20% dari X_t
  stok      : x_t = a*C + kumulatif(P - C + arus - X); ketidakpastian = jangkar (sd 0,4 bulan) + derau w_t terakumulasi (setara filter Kalman tanpa pengamatan).
              Derau w_t = ketidakpastian keluar provinsi + konsumsi + galat produksi (model 0,15; prakiraan K1 0,30).
  jangkar    : satu konstanta (ASUMSI) a bulan konsumsi: stok awal Jan 2026 = a x C, dipilih agar cakupan terendah Jatim = 1,0 bulan.
              Tidak ada pengamatan stok acak; ganti dengan survei SCBN/Bulog nyata saat tersedia. Kalman hanya memberi pita ketidakpastian.
Status (ambang aplikasi untuk stok beredar): CUKUP >= 1,0 bulan konsumsi; TIPIS 0,75-1,0; DEFISIT < 0,75; berdasarkan peluang >= 50%.
Hitung mundur: hari dari 19 Nov 2026 sampai rerata cakupan melewati 0,75 (interpolasi linear antar akhir bulan); kosong bila tidak sampai Jan 2027.

  python scripts/k2/k2_operasional.py [--simpan]
"""
import argparse
import datetime as dt
import json
import subprocess
import sys

import numpy as np
import pandas as pd
from scipy.stats import norm

sys.path.insert(0, "scripts/k1")
sys.path.insert(0, "scripts/k2")
import model_stok as ms  # noqa: E402
from k1_prakiraan import prakiraan  # noqa: E402

SIGMA_X, SIGMA_C = 0.20, 0.05
SIGMA_P_MODEL, SIGMA_P_K1 = 0.15, 0.30
HARI_INI = dt.date(2026, 11, 19)
BULAN = [(2026, m) for m in range(1, 13)] + [(2027, 1)]
AMBANG_CUKUP, AMBANG_DEFISIT, AMBANG_SURPLUS = 1.0, 0.75, 1.5
JANGKAR_MIN, SD_JANGKAR = 1.0, 0.4  # ASUMSI: cakupan terendah Jatim 1,0 bulan (SCBN Juni 2022 nasional); sd 0,4 bulan


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--simpan", action="store_true")
    a = ap.parse_args()
    w, P25, C25, D, bl = ms.muat()
    kab = list(w.index)
    pop26 = ms.sql("select w.nama_repo kab, p.jumlah_jiwa from silver.penduduk p join ref.wilayah w on w.id=p.wilayah_id where w.level='KABKOTA' and p.tahun=2026").set_index("kab").jumlah_jiwa.loc[kab]
    pop25 = ms.sql("select w.nama_repo kab, p.jumlah_jiwa from silver.penduduk p join ref.wilayah w on w.id=p.wilayah_id where w.level='KABKOTA' and p.tahun=2025").set_index("kab").jumlah_jiwa.loc[kab]
    C = C25 * pop26 / pop25  # ton/bulan, 2026

    # struktur arus dan porsi keluar provinsi dari neraca 2025
    net = P25.sum(axis=1) - 12 * C25
    F = ms.arus_lp(net, D)
    masuk = pd.Series(0.0, index=kab)
    keluar = pd.Series(0.0, index=kab)
    masuk[F.columns] = F.sum(axis=0) / 12
    keluar[F.index] = F.sum(axis=1) / 12
    sisa = (net.clip(lower=0) - 12 * keluar).clip(lower=0)
    lebih25 = np.maximum(P25.sub(C25, axis=0), 0).sum(axis=1)
    theta = (sisa / lebih25.replace(0, np.nan)).fillna(0)

    # produksi 2026-2027 dari K1
    tg = [(2026, m, 0) for m in range(1, 12)] + [(2026, 12, 1), (2027, 1, 2)]
    L = prakiraan(list(range(2019, 2026)), tg).reindex(kab)  # luas panen (ha)
    per = ms.sql("select w.nama_repo kab, p.tahun, p.bulan_awal ba, p.bulan_akhir bk, p.luas_panen_ha luas, p.produksi_beras_ton beras from silver.produksi_padi p join ref.wilayah w on w.id=p.wilayah_id where w.level='KABKOTA' and p.granularitas='PERIODE'")
    b26 = per[(per.tahun == 2026) & (per.ba == 1) & (per.bk == 9)].set_index("kab").loc[kab]
    b25 = per[(per.tahun == 2025) & (per.ba == 10) & (per.bk == 12)].set_index("kab").loc[kab]
    skala = b26.luas / L.loc[:, [(2026, m) for m in range(1, 10)]].sum(axis=1)
    prod = {}
    sd_prod = {}
    for (ty, tm) in BULAN:
        luas = L[(ty, tm)] * (skala if (ty == 2026 and tm <= 9) else 1.0)
        r26 = b26.beras / b26.luas
        rasio = r26 if (ty == 2026 and tm <= 9) else (b25.beras / b25.luas).where(b25.luas > 0, r26)  # cadangan bila tak ada panen Okt-Des 2025
        prod[(ty, tm)] = luas * rasio
        sd_prod[(ty, tm)] = SIGMA_P_K1 if (ty, tm) >= (2026, 12) else SIGMA_P_MODEL

    # Lintasan stok deterministik: x_t = a*C + kumulatif neraca. Satu jangkar a (bulan konsumsi) dipilih agar cakupan TERENDAH
    # seluruh Jatim (Jan-Nov 2026) = JANGKAR_MIN. Tidak ada pengamatan stok acak.
    U, Q = {}, {}
    for k in kab:
        Pk = np.array([prod[b][k] for b in BULAN])
        Xk = theta[k] * np.maximum(Pk - C[k], 0)
        U[k] = np.cumsum(Pk - C[k] + masuk[k] - keluar[k] - Xk)
        Q[k] = np.cumsum((SIGMA_X * Xk) ** 2 + (SIGMA_C * C[k]) ** 2 + (np.array([sd_prod[b] for b in BULAN]) * Pk) ** 2)
    tot = sum(U[k] for k in kab) / C.sum()
    a_jangkar = JANGKAR_MIN - tot[:11].min()
    print(f"Jangkar a = {a_jangkar:.2f} bulan konsumsi (stok awal Jan 2026 = a x konsumsi; asumsi)")

    rows = []
    for k in kab:
        for i, (ty, tm) in enumerate(BULAN):
            m = a_jangkar * C[k] + U[k][i]
            v = (SD_JANGKAR * C[k]) ** 2 + Q[k][i]
            cak, sd = m / C[k], np.sqrt(v) / C[k]
            rows.append((k, ty, tm, m, cak, sd, norm.cdf((AMBANG_DEFISIT - cak) / sd), norm.cdf((AMBANG_CUKUP - cak) / sd),
                         cak + norm.ppf(0.1) * sd, cak + norm.ppf(0.9) * sd, "perkiraan" if (ty, tm) > (2026, 11) else "taksiran"))
    R = pd.DataFrame(rows, columns=["kab", "tahun", "bulan", "stok_ton", "cak", "sd", "p_defisit", "p_tipis_atau_defisit", "cak_p10", "cak_p90", "jenis"])
    R["p_surplus"] = norm.sf((AMBANG_SURPLUS - R.cak) / R.sd)
    R["status"] = np.where(R.p_defisit >= 0.5, "DEFISIT", np.where(R.p_tipis_atau_defisit >= 0.5, "TIPIS", np.where(R.p_surplus >= 0.5, "SURPLUS", "CUKUP")))
    R["surplus_ton"] = np.maximum(R.cak - AMBANG_CUKUP, 0) * R.kab.map(C)
    R["kebutuhan_ton"] = np.maximum(AMBANG_CUKUP - R.cak, 0) * R.kab.map(C)

    # hitung mundur ke defisit (rerata cakupan melewati ambang), mulai HARI_INI
    ak = {(ty, tm): dt.date(ty + (tm == 12), tm % 12 + 1, 1) - dt.timedelta(days=1) for ty, tm in BULAN}
    hit = {}
    for k in kab:
        g = R[R.kab == k].set_index(["tahun", "bulan"]).cak
        pts = [(ak[(2026, 10)], g[(2026, 10)])] + [(ak[b], g[b]) for b in BULAN if b >= (2026, 11)]
        now_cak = np.interp(HARI_INI.toordinal(), [x[0].toordinal() for x in pts], [x[1] for x in pts])
        if now_cak < AMBANG_DEFISIT:
            hit[k] = 0
            continue
        hari = None
        for (d0, c0), (d1, c1) in zip(pts[:-1], pts[1:]):
            if d1 <= HARI_INI:
                continue
            if c1 < AMBANG_DEFISIT:
                d_start = max(d0, HARI_INI)
                c_start = np.interp(d_start.toordinal(), [d0.toordinal(), d1.toordinal()], [c0, c1])
                frac = (c_start - AMBANG_DEFISIT) / max(c_start - c1, 1e-9)
                hari = (d_start - HARI_INI).days + frac * (d1 - d_start).days
                break
        hit[k] = hari
    R["hari_ke_defisit"] = R.kab.map(hit)

    now = R[(R.tahun == 2026) & (R.bulan == 11)]
    fut = R[(R.tahun == 2027) & (R.bulan == 1)]
    print("Produksi beras (rb ton) per bulan, seluruh Jatim:", ", ".join(f"{prod[b].sum() / 1e3:.0f}" for b in BULAN), "(Jan 2026 .. Jan 2027; Des dan Jan = prakiraan K1)")
    print(f"Konsumsi bulanan Jatim: {C.sum() / 1e3:.0f} rb ton")
    print("\nStatus per kab, akhir Nov 2026 (taksiran) dan akhir Jan 2027 (perkiraan):")
    print(pd.DataFrame({"Nov 2026": now.status.value_counts(), "Jan 2027": fut.status.value_counts()}).fillna(0).astype(int).reindex(["SURPLUS", "CUKUP", "TIPIS", "DEFISIT"]).fillna(0).astype(int).to_string())
    sudah = [k for k, v in hit.items() if v == 0]
    segera = sorted([(v, k) for k, v in hit.items() if v not in (None, 0)])
    print(f"\nHitung mundur ke defisit (cakupan < {AMBANG_DEFISIT} bulan konsumsi) dari {HARI_INI}: sudah defisit {len(sudah)} kab; akan defisit dalam horizon {len(segera)} kab; aman sampai Jan 2027 {sum(v is None for v in hit.values())} kab")
    print("  paling cepat:", ", ".join(f"{k} {v:.0f} hari" for v, k in segera[:8]))
    print(f"  sd cakupan rata-rata: taksiran Nov {now.sd.mean():.2f} bulan; perkiraan Jan {fut.sd.mean():.2f} bulan (sudah memuat galat prakiraan K1)")
    R.to_csv("data/satelit/k2_operasional_2026.csv", index=False)

    if a.simpan:
        par = {"k1": "prakiraan gabungan (K1) untuk Des 2026 dan Jan 2027", "produksi_2026": "pola K1 diskalakan ke BPS Jan-Sep 2026", "jangkar": f"a={a_jangkar:.2f} bulan konsumsi (asumsi)",
               "ambang": [AMBANG_CUKUP, AMBANG_DEFISIT], "sigma": {"keluar_provinsi": SIGMA_X, "C": SIGMA_C, "prod_model": SIGMA_P_MODEL, "prod_k1": SIGMA_P_K1}}
        hm = {k: (None if v is None else float(v)) for k, v in hit.items()}
        rid = int(ms.sql(f"insert into app.model_run (jenis, nama_versi, parameter, metrik, selesai_pada) values ('K2_STOK','k2_operasional_2026_11','{json.dumps(par)}'::jsonb,'{json.dumps({'hari_ke_defisit': hm})}'::jsonb, now()) returning id").iloc[0, 0])
        ids = w.id.to_dict()
        vals = []
        for r in R.itertuples():
            for nm, z in (("RENDAH", -1.2816), ("TENGAH", 0.0), ("TINGGI", 1.2816)):
                cak = r.cak + z * r.sd
                st = "DEFISIT" if cak < AMBANG_DEFISIT else ("TIPIS" if cak < AMBANG_CUKUP else ("SURPLUS" if cak >= AMBANG_SURPLUS else "CUKUP"))
                sur, keb = max(cak - AMBANG_CUKUP, 0) * C[r.kab], max(AMBANG_CUKUP - cak, 0) * C[r.kab]
                vals.append(f"({rid},{ids[r.kab]},{r.tahun},{r.bulan},'{nm}',{cak * C[r.kab]},{cak},'{st}','MODEL',{sur},{keb})")
        hasil = subprocess.run(["psql", "-d", "terawang", "-v", "ON_ERROR_STOP=1", "-c", "insert into app.estimasi_stok (model_run_id,wilayah_id,tahun,bulan,skenario,stok_ton,cakupan_bulan,status,jenis_data,surplus_ton,kebutuhan_ton) values " + ",".join(vals)], capture_output=True, text=True)
        if hasil.returncode:
            raise SystemExit("gagal menyimpan: " + hasil.stderr[:400])
        print(f"\ntersimpan: model_run {rid}, {len(vals)} baris di app.estimasi_stok (jenis_data MODEL)")


if __name__ == "__main__":
    main()
