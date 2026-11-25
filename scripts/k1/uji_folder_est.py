"""TERAWANG K1 · Uji taksiran citra dari folder lain (mis. hasil nowcast_est2.py dengan titik tambahan) vs operasional.

  TERAWANG_TITIK_TAMBAHAN=<folder titik> TERAWANG_K1_DIR=<keluar> python scripts/k1/nowcast_est2.py --lead 28 --akhir 2026-12
  python scripts/k1/uji_folder_est.py <keluar>          # membaca <keluar>/est_nowcast2_lead{0,28,56}.csv

Jarak yang berkasnya belum ada di folder memakai berkas operasional. Keluaran: diagnosa citra saja 2022-2025 dan
uji model gabungan (uji_k1_ringkas.py) untuk operasional dan untuk folder.
"""
import os
import sys

import pandas as pd

sys.path.insert(0, "scripts/k1")
import k1_prakiraan as kp  # noqa: E402
import uji_k1_ringkas as ur  # noqa: E402
from uji_jeda_per_kab import pasang  # noqa: E402
from uji_w2w import diagnosa, titik  # noqa: E402


def main():
    folder = sys.argv[1]
    leads = list(kp.LEAD.values())
    ada = [L for L in leads if os.path.exists(os.path.join(folder, f"est_nowcast2_lead{L}.csv"))]
    print("jarak dari folder:", ada, flush=True)
    varian = {
        "operasional (400 titik)": {L: titik(L) for L in leads},
        f"folder {folder}": {L: (pd.read_csv(os.path.join(folder, f"est_nowcast2_lead{L}.csv"))[["kabkota", "t", "est"]] if L in ada else titik(L))
                             for L in leads},
    }
    print("diagnosa citra saja, 2022-2025 (skala per kab dari 2019-2021): WAPE kab-bulan | korelasi | WAPE total Jatim per bulan")
    for nama, est in varian.items():
        print(f"  {nama}:", " | ".join("L{}: {:5.1f}% r={:.3f} {:5.1f}%".format(L, *diagnosa(est[L])) for L in ada), flush=True)
    asli = kp.muat_citra
    for nama, est in varian.items():
        print(f"\n=== {nama}", flush=True)
        pasang(est)
        ur.main()
    kp.muat_citra = asli


if __name__ == "__main__":
    main()
