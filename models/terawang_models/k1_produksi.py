"""K1 produksi: model gabungan milik Danang (scripts/k1/k1_prakiraan.py, nowcast_est2.py).

Luas panen per kab per bulan = gabungan (citra Sentinel per kab + klimatologi + musiman, bobot NNLS leave-one-year-out),
taksiran citra jarak 0/28/56 hari dari nowcast v2 (aturan banjir optik + fusi S1, genangan belum terverifikasi dibobot peluang).
Beras = luas panen x produktivitas BPS per kab. Lihat ai-notes/progress.md (18-19 Nov 2026).
"""

import datetime as dt
from pathlib import Path

import pandas as pd

from .danang import di_repo, modul

VERSI = "k1-gabungan-nowcast2-2026.11c"  # b: bobot kota/kab terpisah, pita galat empiris, cadangan tanpa citra; c: bobot per musim, musiman = rata-rata 3 tahun
JENIS_DATA = "MODEL"
Z80 = 1.2816  # pita P10-P90
LEAD_HARI = (0, 28, 56)
MULAI_OPERASIONAL = "2026-10"  # sebelum ini taksiran citra retrospektif ada di data/satelit/est_nowcast2_lead*.csv


def perintah_nowcast(python: str, lead: int, akhir: str) -> list[str]:
    """Perintah memperbarui taksiran citra bulan operasional (dijalankan dari akar repo)."""
    return [python, "scripts/k1/nowcast_est2.py", "--lead", str(lead), "--mulai", MULAI_OPERASIONAL, "--akhir", akhir, "--sufiks", "_2026"]


def bulan_akhir(hari_ini: dt.date) -> str:
    p = pd.Period(hari_ini, freq="M") + 2
    return f"{p.year}-{p.month:02d}"


def prediksi_produksi(akar: str | Path, hari_ini: dt.date, env: dict[str, str]) -> pd.DataFrame:
    """Produksi beras per kab per bulan (Jan 2026 .. bulan ini + 2). Kolom: kab, tahun, bulan, produksi_beras_ton,
    luas_panen_ha, sd_relatif, batas_bawah_ton, batas_atas_ton, jarak_bulan."""
    with di_repo(akar, env):
        ms, ko = modul("model_stok"), modul("k2_operasional")
        kab = list(ms.sql("select nama_repo kab from ref.wilayah where level='KABKOTA' order by id").kab)
        prod, sd, luas = ko.produksi(kab, hari_ini)
        _, lead, _ = ko.bulan_horizon(hari_ini)
    baris = []
    for (th, bl), p in prod.items():
        for k in kab:
            v = float(p[k])
            s = ko.sd_ambil(sd, (th, bl), k)
            baris.append((k, th, bl, v, float(luas[(th, bl)][k]), s, max(v * (1 - Z80 * s), 0.0), v * (1 + Z80 * s), lead[(th, bl)]))
    return pd.DataFrame(baris, columns=["kab", "tahun", "bulan", "produksi_beras_ton", "luas_panen_ha", "sd_relatif",
                                        "batas_bawah_ton", "batas_atas_ton", "jarak_bulan"])
