"""TERAWANG K3 · Prediksi harga operasional 1-4 minggu per kab/kota dan status terhadap HET.

Model: harga terakhir (naif) + sebaran galat empiris per horizon (seluruh riwayat 2022-sekarang). Uji bergulir (prediksi_harga.py):
GBM tidak mengalahkan naif, jadi dipakai yang sederhana. Nilai tambah ada pada pita ketidakpastian dan peluang melewati HET:
  harga_prediksi = p0 x exp(median galat);  batas P10/P90 dari kuantil galat;  P(harga > HET) dari sebaran galat.
Status (HET dari app.ambang_harga; kelas Bapanas: aman <= HET, waspada 0-5% di atas, perlu intervensi > 5%):
  SIAGA   : P(harga > 1,05 x HET) >= 50%
  WASPADA : P(harga > HET) >= 30%  (peringatan dini; ambang 30% agar kejadian baru terdeteksi lebih awal)
  AMAN    : selainnya

  python scripts/k3/k3_harga_operasional.py [--simpan]
"""
import argparse
import json
import subprocess
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, "scripts/k3")
sys.path.insert(0, "scripts/k2")
import model_stok as ms  # noqa: E402
from prediksi_harga import muat  # noqa: E402

P_WASPADA, P_SIAGA = 0.30, 0.50


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--simpan", action="store_true")
    a = ap.parse_args()
    ids = ms.sql("select id, nama_repo kab from ref.wilayah where level='KABKOTA'").set_index("kab").id
    het = ms.sql("select komoditas_id k, het_rp_kg het, ambang_siaga_pct sg from app.ambang_harga where wilayah_id is null order by berlaku_dari").groupby("k").last()
    rows, ringkas = [], []
    for kom in (1, 2):
        W = muat(kom)
        L = np.log(W)
        tgl_acuan = ms.sql(f"select max(tanggal) from silver.harga_kabkota_harian where komoditas_id={kom}").iloc[0, 0]
        H = het.loc[kom, "het"]
        siaga = H * (1 + het.loc[kom, "sg"] / 100)
        p0 = W.ffill().iloc[-1]
        for h in (1, 2, 3, 4):
            e = (L.shift(-h) - L).stack().dropna().to_numpy()
            q10, q50, q90 = np.quantile(e, [0.1, 0.5, 0.9])
            for kab, p in p0.items():
                pred = p * np.exp(q50)
                pw = float((e > np.log(H / p)).mean())
                ps = float((e > np.log(siaga / p)).mean())
                st = "SIAGA" if ps >= P_SIAGA else ("WASPADA" if pw >= P_WASPADA else "AMAN")
                rows.append((kom, kab, str(tgl_acuan), 7 * h, pred, p * np.exp(q10), p * np.exp(q90), st, pw))
    R = pd.DataFrame(rows, columns=["komoditas", "kab", "tanggal_acuan", "horizon_hari", "harga", "p10", "p90", "status", "p_di_atas_het"])
    for kom, nm in ((1, "medium"), (2, "premium")):
        d = R[R.komoditas == kom]
        print(f"\nBeras {nm} (HET Rp{het.loc[kom, 'het']:,}): jumlah kab per status menurut horizon")
        print(d.pivot_table(index="horizon_hari", columns="status", values="kab", aggfunc="count", fill_value=0).reindex(columns=["AMAN", "WASPADA", "SIAGA"], fill_value=0).to_string())
        d28 = d[d.horizon_hari == 28].sort_values("p_di_atas_het", ascending=False).head(6)
        print("  peluang melewati HET tertinggi (4 minggu):", ", ".join(f"{r.kab} {r.p_di_atas_het * 100:.0f}% (Rp{r.harga:,.0f})" for r in d28.itertuples()))
    R.to_csv("data/satelit/k3_harga_operasional.csv", index=False)
    if a.simpan:
        par = {"model": "naif + sebaran galat empiris per horizon", "uji": "rolling-origin 2024-2026: GBM tidak mengalahkan naif; cakupan P10-P90 91-93%",
               "ambang": {"P_waspada": P_WASPADA, "P_siaga": P_SIAGA}, "het": {int(k): int(v) for k, v in het.het.items()}}
        rid = int(ms.sql(f"insert into app.model_run (jenis, nama_versi, parameter, selesai_pada) values ('K3_HARGA','k3_harga_naif_galat_2026_11','{json.dumps(par)}'::jsonb, now()) returning id").iloc[0, 0])
        vals = [f"({rid},{ids[r.kab]},{r.komoditas},'{r.tanggal_acuan}',{r.horizon_hari},{r.harga},{r.p10},{r.p90},'{r.status}','MODEL')" for r in R.itertuples()]
        res = subprocess.run(["psql", "-d", "terawang", "-v", "ON_ERROR_STOP=1", "-c", "insert into app.prediksi_harga (model_run_id,wilayah_id,komoditas_id,tanggal_acuan,horizon_hari,harga_prediksi,batas_bawah,batas_atas,status,jenis_data) values " + ",".join(vals)], capture_output=True, text=True)
        if res.returncode:
            raise SystemExit("gagal menyimpan: " + res.stderr[:400])
        print(f"\ntersimpan: model_run {rid}, {len(vals)} baris di app.prediksi_harga")


if __name__ == "__main__":
    main()
