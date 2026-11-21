"""TERAWANG K2 · Uji balik stok model terhadap perubahan harga beras antar kabupaten (2025).

Hipotesis: kabupaten dengan cakupan stok non-Bulog rendah pada bulan t mengalami kenaikan harga lebih besar dibanding kabupaten
lain pada bulan yang sama dalam 1-2 bulan berikutnya. Uji: korelasi dan selisih rata-rata setelah mengurangi rata-rata bulanan
(efek tetap bulan), dengan bootstrap per kabupaten. Harga: beras medium, rata-rata bulanan per kab/kota (SISKAPERBAPO).

  python scripts/k2/uji_stok_harga.py
"""
import io
import subprocess
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, "scripts/k2")
import model_stok as ms  # noqa: E402


def sql(q):
    return pd.read_csv(io.StringIO(subprocess.run(["psql", "-d", "terawang", "--csv", "-c", q], capture_output=True, text=True, check=True).stdout))


def main():
    h = sql("""select w.nama_repo kab, extract(year from h.tanggal)::int th, extract(month from h.tanggal)::int bln, avg(h.harga_rata2_rp_kg) harga
               from silver.harga_kabkota_harian h join ref.wilayah w on w.id=h.wilayah_id join ref.komoditas k on k.id=h.komoditas_id
               where k.kode='beras_medium' and h.harga_rata2_rp_kg is not null and h.tanggal >= '2025-01-01' and h.tanggal < '2026-04-01' group by 1,2,3""")
    h["t"] = (h.th - 2025) * 12 + h.bln
    H = h.pivot(index="kab", columns="t", values="harga")
    rng = np.random.default_rng(1)
    print("Uji: cakupan stok bulan t vs perubahan harga (log) dari t ke t+1 dan t ke t+2, sesudah menghilangkan rata-rata bulanan")
    for nama, pb in (("A: tanpa penyesuaian Bulog", False), ("B: dengan penyesuaian Bulog", True)):
        R, _ = ms.hitung(pb)
        cak = R[R.skenario == "TENGAH"].pivot(index="kab", columns="bulan", values="cakupan_bulan")
        for lag in (1, 2):
            rows = []
            for t in range(1, 13 - 0):
                if t + lag in H.columns and t in H.columns:
                    d = np.log(H[t + lag] / H[t])
                    x = cak[t].reindex(d.index)
                    rows.append(pd.DataFrame({"kab": d.index, "t": t, "d": d.values - np.nanmean(d.values), "x": x.values - np.nanmean(x.values), "cak": x.values}))
            D = pd.concat(rows).dropna()
            r = D.x.corr(D.d)
            lo = D[D.x < D.x.quantile(0.25)].d.mean()
            hi = D[D.x > D.x.quantile(0.75)].d.mean()
            kabs = D.kab.unique()
            bs = []
            for _ in range(500):
                ss = rng.choice(kabs, len(kabs))
                Db = pd.concat([D[D.kab == k] for k in ss])
                bs.append(Db.x.corr(Db.d))
            print(f"  {nama} | lag {lag} bulan: n={len(D)}, korelasi {r:+.3f} (95% bootstrap {np.percentile(bs, 2.5):+.3f} .. {np.percentile(bs, 97.5):+.3f}); selisih harga kuartil cakupan terendah vs tertinggi {100 * (lo - hi):+.2f} poin persen")


if __name__ == "__main__":
    main()
