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


# ---------------------------------------------------------------------------------------------------------------------
# K3b operasional (Danang): scripts/k3/k3b_sphp.py, LP stokastik Bulog cabang -> kab, bulan berjalan sampai +2.
VERSI_K3B = "k3b-lp-stokastik-2026.11"
JENIS_DATA_K3B = "DUMMY"  # stok Bulog 2026 dan lokasi cabang masih asumsi


def rekomendasi_k3b(akar, hari_ini, k2_rinci: pd.DataFrame, k3_harga: pd.DataFrame, env: dict[str, str]) -> tuple[pd.DataFrame, dict]:
    """k2_rinci: kab, tahun, bulan, stok_ton, cak, sd (skenario tengah K2). k3_harga: keluaran prediksi_harga_k3a.
    Keluaran (R, parameter): R = tahun, bulan, dari, ke (nama kab), volume_ton, jarak_km."""
    from .danang import di_repo, modul

    with di_repo(akar, env):
        kb = modul("k3b_sphp")
        R, M, p, met = kb.hitung(hari_ini, k2_rinci, k3_harga)
        return R, kb.parameter_run(M, p, met)
