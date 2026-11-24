"""K3 · Rekomendasi penyaluran SPHP: memasangkan wilayah surplus dengan wilayah defisit.

BASELINE: rakus. Defisit terbesar dilayani dulu dari surplus terdekat (jarak jalan).
Ganti dengan linear programming (PuLP / scipy.optimize.linprog) tanpa mengubah kolom keluaran.
"""
from __future__ import annotations

import pandas as pd

VERSI = "sphp-rakus-0.1"
JENIS_DATA = "MODEL"
VOLUME_MINIMUM_TON = 1.0


def rekomendasi_sphp(saldo: pd.DataFrame, jarak: pd.DataFrame) -> pd.DataFrame:
    """saldo: wilayah_id, saldo_ton (positif = surplus yang bisa dilepas, negatif = defisit).
    jarak: dari_id, ke_id, jarak_jalan_km.

    Keluaran: dari_id, ke_id, volume_ton, jarak_jalan_km.
    """
    sisa = {int(r.wilayah_id): float(r.saldo_ton) for r in saldo.itertuples() if r.saldo_ton > 0}
    butuh = saldo[saldo["saldo_ton"] < 0].sort_values("saldo_ton")
    km = {(int(r.dari_id), int(r.ke_id)): float(r.jarak_jalan_km) for r in jarak.itertuples()}
    baris = []
    for r in butuh.itertuples():
        ke, kurang = int(r.wilayah_id), -float(r.saldo_ton)
        for dari in sorted(sisa, key=lambda d: km.get((d, ke), float("inf"))):
            if kurang < VOLUME_MINIMUM_TON:
                break
            ambil = min(sisa[dari], kurang)
            if ambil < VOLUME_MINIMUM_TON or (dari, ke) not in km:
                continue
            baris.append((dari, ke, ambil, km[(dari, ke)]))
            sisa[dari] -= ambil
            kurang -= ambil
    return pd.DataFrame(baris, columns=["dari_id", "ke_id", "volume_ton", "jarak_jalan_km"])
