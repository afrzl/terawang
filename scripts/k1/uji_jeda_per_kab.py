"""TERAWANG K1 · Uji jeda genangan->panen per kab (menggantikan 96 hari tetap untuk semua wilayah).

Langkah:
  1. Taksiran citra untuk beberapa jeda (jendela 12 hari): 7, 8, 9, 10 = 84, 96, 108, 120 hari
       python scripts/k1/nowcast_est2.py --lead 28 --akhir 2026-12 --lags 7,8,9,10      (TERAWANG_K1_DIR = folder keluaran)
  2. Skrip ini memilih jeda per kab HANYA dari tahun 2019-2021 (BPS luas panen bulanan; sebelum semua tahun uji), dengan kriteria
     WAPE bulanan setelah taksiran citra diskalakan per kab. Varian "musim": jeda dipilih terpisah untuk bulan panen Jan-Jun dan Jul-Des.
  3. Taksiran terpilih dimasukkan ke model gabungan dan dinilai dengan uji yang sama seperti uji_k1_ringkas.py:
     uji bergulir 2022-2025 (luas panen bulanan per kab) dan uji akhir produksi beras Jan-Sep 2026.

  python scripts/k1/uji_jeda_per_kab.py <folder keluaran langkah 1>
"""
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, "scripts/k1")
import k1_prakiraan as kp  # noqa: E402
import uji_k1_ringkas as ur  # noqa: E402
from nowcast_eval import muat_bps  # noqa: E402

JEDA = (7, 8, 9, 10)
TAHUN_PILIH = (2019, 2020, 2021)


def muat(folder, L, g):
    e = pd.read_csv(os.path.join(folder, f"est_nowcast2_lead{L}_jeda{g}.csv"))[["kabkota", "t", "est"]]
    e["tahun"], e["bulan"] = (e.t - 1) // 12, (e.t - 1) % 12 + 1
    return e


def pilih_jeda(folder, L, musim=False):
    y = muat_bps().rename(columns={"y": "bps"})
    skor = []
    for g in JEDA:
        d = muat(folder, L, g).merge(y, on=["kabkota", "tahun", "bulan"])
        d = d[d.tahun.isin(TAHUN_PILIH)].dropna(subset=["est", "bps"])
        d["grup"] = np.where(d.bulan <= 6, "H1", "H2") if musim else "semua"
        for (k, gr), s in d.groupby(["kabkota", "grup"]):
            b = s.bps.sum() / max(s.est.sum(), 1e-9)
            skor.append((k, gr, g, np.abs(s.est * b - s.bps).sum() / max(s.bps.sum(), 1e-9)))
    S = pd.DataFrame(skor, columns=["kabkota", "grup", "jeda", "wape"])
    return S.loc[S.groupby(["kabkota", "grup"]).wape.idxmin()].set_index(["kabkota", "grup"]).jeda, S


def gabung(folder, L, pilihan, musim=False):
    semua = {g: muat(folder, L, g) for g in JEDA}
    out = []
    for g, e in semua.items():
        grup = np.where(e.bulan <= 6, "H1", "H2") if musim else np.array(["semua"] * len(e))
        jp = pilihan.reindex(list(zip(e.kabkota, grup))).to_numpy()
        out.append(e[jp == g])
    return pd.concat(out)[["kabkota", "t", "est"]]


def pasang(est_per_lead):
    """Ganti muat_citra agar memakai taksiran yang diberikan (tanpa menyentuh berkas operasional)."""
    def muat_citra(Yw):
        ES = {}
        for h, L in kp.LEAD.items():
            e = est_per_lead[L].copy()
            e["tahun"], e["bulan"] = (e.t - 1) // 12, (e.t - 1) % 12 + 1
            e.loc[(e.tahun == 2019) & (e.bulan <= 3), "est"] = np.nan
            ES[h] = e.pivot(index=["kabkota", "bulan"], columns="tahun", values="est").reindex(Yw.index)
        return ES
    kp.muat_citra = muat_citra


def main():
    folder = sys.argv[1]
    leads = [L for L in kp.LEAD.values() if all(os.path.exists(os.path.join(folder, f"est_nowcast2_lead{L}_jeda{g}.csv")) for g in JEDA)]
    asli = kp.muat_citra
    varian = {"jeda 8 tetap (sekarang, dihitung ulang)": {L: (lambda L=L: muat(folder, L, 8)[["kabkota", "t", "est"]]) for L in leads}}
    for g in (7, 9, 10):
        varian[f"jeda {g} tetap"] = {L: (lambda L=L, g=g: muat(folder, L, g)[["kabkota", "t", "est"]]) for L in leads}
    for musim in (False, True):
        nama = "jeda per kab per musim" if musim else "jeda per kab"
        varian[nama] = {L: (lambda L=L, musim=musim: gabung(folder, L, pilih_jeda(folder, L, musim)[0], musim)) for L in leads}
    for L in leads:
        pj, _ = pilih_jeda(folder, L)
        print(f"lead {L}: sebaran jeda terpilih per kab (hari):", (pj * 12).value_counts().sort_index().to_dict())
    for nama, fs in varian.items():
        print(f"\n=== {nama}")
        est = {L: f() for L, f in fs.items()}
        for L in kp.LEAD.values():  # lead yang belum dihitung ulang memakai berkas operasional
            if L not in est:
                est[L] = pd.read_csv(f"data/satelit/est_nowcast2_lead{L}.csv")[["kabkota", "t", "est"]]
        pasang(est)
        ur.main()
    kp.muat_citra = asli


if __name__ == "__main__":
    main()
