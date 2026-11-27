"""TERAWANG K2 · Uji kepekaan model stok (evaluasi 24 Nov 2026). Hanya membaca database, tidak menulis.

Yang diuji, semuanya dibandingkan dengan hasil dasar k2_operasional.hitung(hari_ini):
  1. jangkar      : JANGKAR_MIN 0,7 / 1,3 (asumsi cakupan terendah Jatim) -> berapa status kab berubah;
  2. tanggal      : hitung ulang dengan hari_ini mundur (15 Sep, 15 Okt) -> apakah jangkar dan cakupan bulan lalu ikut bergeser;
  3. konsumsi     : konsumsi x 1,2 (rumah tangga Susenas belum memuat horeka, industri, susut);
  5. status vs sd : apakah pita ketidakpastian ikut menentukan status (aturan peluang >= 50%).

  python scripts/k2/uji_k2_kepekaan.py [--hari-ini 2026-11-24]
"""
import argparse
import datetime as dt
import sys

import numpy as np
import pandas as pd

sys.path[:0] = ["scripts/k1", "scripts/k2"]
import k2_operasional as ko  # noqa: E402
import model_stok as ms  # noqa: E402


def status_dari(cak):
    return np.where(cak < ko.AMBANG_DEFISIT, "DEFISIT", np.where(cak < ko.AMBANG_CUKUP, "TIPIS", np.where(cak >= ko.AMBANG_SURPLUS, "SURPLUS", "CUKUP")))


def ringkas(R, bulan):
    s = R[(R.tahun == bulan[0]) & (R.bulan == bulan[1])].set_index("kab")
    return s


def beda(a, b, kol="status"):
    j = a[[kol]].join(b[[kol]].add_suffix("_b"))
    return int((j[kol] != j[kol + "_b"]).sum())


def hitung_jangkar(jmin, hari_ini, prod, sd):
    lama = ko.JANGKAR_MIN
    ko.JANGKAR_MIN = jmin
    try:
        return ko.hitung(hari_ini, prod=prod, sd_prod=sd)
    finally:
        ko.JANGKAR_MIN = lama


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--hari-ini", default=dt.date.today().isoformat())
    a = ap.parse_args()
    hari = dt.date.fromisoformat(a.hari_ini)
    h = ko.hitung(hari)
    R, prod, sd, BULAN, ini = h["R"], h["prod"], h["sd_prod"], h["bulan"], h["ini"]
    akhir = BULAN[-1]
    b_ini, b_akh = ringkas(R, ini), ringkas(R, akhir)
    print(f"Dasar ({hari}): jangkar a = {h['a_jangkar']:.2f}; status {ini}: {b_ini.status.value_counts().to_dict()}; {akhir}: {b_akh.status.value_counts().to_dict()}")

    # 5. status hanya bergantung pada nilai tengah?
    s_mean = status_dari(R.cak)
    print(f"\n[5] Status dari peluang >= 50% vs status dari nilai tengah saja: berbeda pada {int((s_mean != R.status).sum())} dari {len(R)} kab-bulan")

    # 1. jangkar
    print("\n[1] Kepekaan jangkar (cakupan terendah Jatim):")
    for jm in (0.7, 1.3):
        hj = hitung_jangkar(jm, hari, prod, sd)
        Ri, Ra = ringkas(hj["R"], ini), ringkas(hj["R"], akhir)
        print(f"   JANGKAR_MIN {jm}: status berubah {beda(b_ini, Ri)}/38 ({ini}), {beda(b_akh, Ra)}/38 ({akhir}); "
              f"{akhir}: {Ra.status.value_counts().to_dict()}")

    # 2. tanggal
    print("\n[2] Kestabilan jangkar terhadap tanggal hitung (cakupan Jan 2026 rata-rata dan status Sep 2026):")
    for d in (dt.date(hari.year, 9, 15), dt.date(hari.year, 10, 15), hari):
        hd = ko.hitung(d)
        g = hd["R"]
        jan = g[(g.tahun == 2026) & (g.bulan == 1)].cak.mean()
        sep = ringkas(g, (2026, 9))
        print(f"   hari_ini {d}: jangkar {hd['a_jangkar']:.2f}, cakupan Jan 2026 rata-rata {jan:.2f}, status Sep 2026 berbeda dari dasar: {beda(ringkas(R, (2026, 9)), sep)}/38")

    # 3. konsumsi x 1,2
    asli = ms.muat

    def muat_besar():
        w, P25, C25, D, bl = asli()
        return w, P25, C25 * 1.2, D, bl

    ms.muat = muat_besar
    try:
        hc = ko.hitung(hari, prod=prod, sd_prod=sd)
    finally:
        ms.muat = asli
    Ri, Ra = ringkas(hc["R"], ini), ringkas(hc["R"], akhir)
    print(f"\n[3] Konsumsi x 1,2: jangkar {hc['a_jangkar']:.2f}; status berubah {beda(b_ini, Ri)}/38 ({ini}), {beda(b_akh, Ra)}/38 ({akhir}); {akhir}: {Ra.status.value_counts().to_dict()}")


if __name__ == "__main__":
    main()
