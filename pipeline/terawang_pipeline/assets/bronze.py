"""Lapisan BRONZE: berkas mentah dari tiap sumber, disimpan apa adanya di data/ (dan src/lib/gee_wilayah.json).

Setiap aset mencatat checksum sebagai data version. Kalau isi berkas tidak berubah, Dagster tahu aset turunannya
tidak basi; kalau berubah (data baru), silver dan model di bawahnya ditandai perlu dijalankan ulang.
"""

import hashlib
from pathlib import Path

from dagster import AssetExecutionContext, DataVersion, MaterializeResult, MetadataValue, asset

from ..resources import Repo, SumberCitra, SumberHarga, sha256

GRUP = "bronze"

# Berkas data statis per sumber (terbit tahunan, diketik dari publikasi). Dipantau sensor `sensor_berkas_data`.
BERKAS_STATIS = {
    "bps": "data/bps",
    "bulog": "data/bulog",
    "jarak": "data/geografi/jarak_kabkota",
}

# Bahan K1 Danang yang tetap di repo: riwayat titik 2018-2024, taksiran citra retrospektif, luas sawah per kab.
SATELIT_STATIS = [f"data/satelit/{k}_titik_riwayat_2018_2024.csv.gz" for k in ("vh", "vv", "lswi", "evi")] + \
                 [f"data/satelit/est_nowcast2_lead{L}.csv" for L in (0, 28, 56)] + ["data/satelit/vh_panen_bulanan_kabkota.csv"]


def berkas_di(repo: Repo, rel: str) -> list[Path]:
    akar = repo.path / rel
    return sorted(p for p in akar.rglob("*") if p.is_file() and p.suffix in {".csv", ".gz", ".json"})


def checksum_gabungan(paths: list[Path]) -> str:
    h = hashlib.sha256()
    for p in paths:
        h.update(p.name.encode())
        h.update(sha256(p).encode())
    return h.hexdigest()


def _tampil(repo: Repo, p: Path) -> Path:
    """Path relatif terhadap repo kalau berkasnya di dalam repo; selain itu path absolut (mis. unduhan SISKAPERBAPO)."""
    return p.relative_to(repo.path) if p.is_relative_to(repo.path) else p


def _hasil(repo: Repo, paths: list[Path], sumber: str) -> MaterializeResult:
    hilang = [str(p) for p in paths if not p.exists()]
    if hilang:
        raise FileNotFoundError(f"berkas {sumber} tidak ada: {hilang}")
    cs = checksum_gabungan(paths)
    return MaterializeResult(
        data_version=DataVersion(cs[:16]),
        metadata={
            "sumber": sumber,
            "jumlah_berkas": len(paths),
            "ukuran_mb": round(sum(p.stat().st_size for p in paths) / 1e6, 2),
            "checksum": cs[:16],
            "berkas": MetadataValue.md("\n".join(f"- `{_tampil(repo, p)}`" for p in paths)),
        },
    )


@asset(group_name=GRUP, kinds={"csv"}, description="Harga konsumen beras harian per pasar, 38 kab/kota (SISKAPERBAPO, atau konektor lain).")
def bronze_harga(context: AssetExecutionContext, repo: Repo, sumber_harga: SumberHarga) -> MaterializeResult:
    paths = sumber_harga.perbarui(repo, log=context.log)
    return _hasil(repo, paths, f"harga ({sumber_harga.mode})")


@asset(group_name=GRUP, kinds={"json"}, description="Olahan citra Sentinel-1/2 per wilayah dari Google Earth Engine (gee_wilayah.json).")
def bronze_citra(context: AssetExecutionContext, repo: Repo, sumber_citra: SumberCitra) -> MaterializeResult:
    path = sumber_citra.perbarui(repo, log=context.log)
    return _hasil(repo, [path], f"citra ({sumber_citra.mode})")


@asset(group_name=GRUP, kinds={"csv"}, description="Deret 12-harian VH, VV (Sentinel-1) dan LSWI, EVI (Sentinel-2) di 15.200 titik sawah, bahan K1. Mode gee: diperpanjang dari GEE sampai hari ini.")
def bronze_titik_satelit(context: AssetExecutionContext, repo: Repo, sumber_citra: SumberCitra) -> MaterializeResult:
    paths = sumber_citra.perbarui_titik(repo, log=context.log) + [repo.path / p for p in SATELIT_STATIS]
    hasil = _hasil(repo, paths, f"titik ({sumber_citra.mode})")
    import pandas as pd

    kol = pd.read_csv(paths[0], nrows=0).columns
    hasil.metadata["jendela_terakhir"] = kol[-1]
    hasil.metadata["jumlah_jendela_12harian"] = len(kol) - 3
    return hasil


@asset(group_name=GRUP, kinds={"csv"}, description="BPS: produksi padi, penduduk, konsumsi beras (diketik dari BRS dan Jatim Dalam Angka).")
def bronze_bps(repo: Repo) -> MaterializeResult:
    return _hasil(repo, berkas_di(repo, BERKAS_STATIS["bps"]), "bps")


@asset(group_name=GRUP, kinds={"csv"}, description="Bulog Kanwil Jatim: stok, pengadaan, harga (via Jatim Dalam Angka 2026).")
def bronze_bulog(repo: Repo) -> MaterializeResult:
    return _hasil(repo, berkas_di(repo, BERKAS_STATIS["bulog"]), "bulog")


@asset(group_name=GRUP, kinds={"csv"}, description="Matriks jarak dan waktu tempuh antar kab/kota (OSRM).")
def bronze_jarak(repo: Repo) -> MaterializeResult:
    return _hasil(repo, berkas_di(repo, BERKAS_STATIS["jarak"]), "jarak")
