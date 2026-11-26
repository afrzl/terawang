"""Lapisan BRONZE: berkas mentah dari tiap sumber, disimpan apa adanya di data/ (dan src/lib/gee_wilayah.json).

Setiap aset mencatat checksum sebagai data version. Kalau isi berkas tidak berubah, Dagster tahu aset turunannya
tidak basi; kalau berubah (data baru), silver dan model di bawahnya ditandai perlu dijalankan ulang.
"""

import hashlib
import json
from pathlib import Path

from dagster import (AssetCheckResult, AssetCheckSeverity, AssetCheckSpec, AssetExecutionContext, DataVersion, MaterializeResult,
                     MetadataValue, asset)

from ..resources import (Repo, SumberCitra, SumberHarga, SumberStatis, berkas_efektif, kosongkan_lapisan, sha256, terapkan_manual,
                         tujuan_lapisan)

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


def _cek(nama: str) -> list[AssetCheckSpec]:
    return [AssetCheckSpec("otomatis_berhasil", asset=nama, description="Konektor otomatis berhasil di run terakhir. "
                           "Kalau gagal, aset tetap jalan dengan data terakhir + unggahan manual + CSV repo (peringatan, bukan galat).")]


def _status(hasil: MaterializeResult, status: dict, nama: str) -> MaterializeResult:
    """Tambahkan status konektor ke metadata dan hasil asset check (WARN kalau otomatis gagal)."""
    hasil.metadata["mode"] = status["mode"]
    hasil.metadata["otomatis"] = status["otomatis"] or "tidak dipakai"
    hasil.metadata["unggahan_manual_dipakai"] = MetadataValue.md("\n".join(f"- `{m}`" for m in status["manual"]) or "tidak ada")
    if status.get("galat"):
        hasil.metadata["galat_otomatis"] = MetadataValue.md(f"```\n{status['galat']}\n```")
    lolos = status["otomatis"] != "gagal"
    return MaterializeResult(data_version=hasil.data_version, metadata=hasil.metadata, check_results=[AssetCheckResult(
        asset_key=nama, check_name="otomatis_berhasil", passed=lolos, severity=AssetCheckSeverity.WARN,
        metadata={"mode": status["mode"], "otomatis": status["otomatis"] or "tidak dipakai"})])


@asset(group_name=GRUP, kinds={"csv"}, check_specs=_cek("bronze_harga"),
       description="Harga konsumen beras harian per pasar, 38 kab/kota (SISKAPERBAPO; cadangan: unggahan manual/harga).")
def bronze_harga(context: AssetExecutionContext, repo: Repo, sumber_harga: SumberHarga) -> MaterializeResult:
    paths, status = sumber_harga.perbarui(repo, log=context.log)
    return _status(_hasil(repo, paths, f"harga ({sumber_harga.mode})"), status, "bronze_harga")


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


@asset(group_name=GRUP, kinds={"csv"},
       description="Iklim untuk tahun analog K1: ONI bulanan (NOAA CPC, unduh) dan hujan bulanan CHIRPS per kab/kota (GEE, mode gee). "
                   "Disimpan di TERAWANG_IKLIM_DIR (bawaan ~/.local/share/terawang/iklim), diisi awal dari data/iklim.")
def bronze_iklim(context: AssetExecutionContext, repo: Repo, sumber_citra: SumberCitra) -> MaterializeResult:
    import os
    import sys

    import pandas as pd

    folder = Path(os.environ.get("TERAWANG_IKLIM_DIR", Path.home() / ".local/share/terawang/iklim"))
    perintah = [sys.executable, "scripts/iklim/perbarui_iklim.py", "--keluar", str(folder)]
    if sumber_citra.mode == "gee" and sumber_citra.gee_project:
        perintah += ["--gee-project", sumber_citra.gee_project]
    repo.jalankan(perintah, log=context.log)
    oni = pd.read_csv(folder / "noaa_oni_bulanan.csv").dropna().iloc[-1]
    huj = pd.read_csv(folder / "chirps_jatim_bulanan.csv")[["tahun", "bulan"]].drop_duplicates().iloc[-1]
    paths = [folder / "noaa_oni_bulanan.csv", folder / "chirps_jatim_bulanan.csv"]
    return MaterializeResult(data_version=DataVersion(checksum_gabungan(paths)[:16]),
                             metadata={"folder": str(folder), "oni_terakhir": f"{int(oni.tahun)}-{int(oni.bulan):02d} ({oni.oni:+.2f})",
                                       "hujan_terakhir": f"{int(huj.tahun)}-{int(huj.bulan):02d}"})


def _statis(context: AssetExecutionContext, repo: Repo, sumber: SumberStatis, laporan: str) -> MaterializeResult:
    status = sumber.perbarui(repo, log=context.log)
    efektif = status["berkas"]
    hasil = _hasil(repo, [p for p, _ in efektif], f"{sumber.sumber} ({sumber.mode})")
    hasil.metadata["berkas"] = MetadataValue.md("\n".join(f"- `{_tampil(repo, p)}` ({asal})" for p, asal in efektif))
    lap = tujuan_lapisan(sumber.sumber) / laporan
    if status["otomatis"] == "berhasil" and lap.exists():
        hasil.metadata["laporan"] = MetadataValue.json(json.loads(lap.read_text()))
    return _status(hasil, status, f"bronze_{sumber.sumber}")


@asset(group_name=GRUP, kinds={"csv"}, check_specs=_cek("bronze_bps"),
       description="BPS: luas panen dan produksi beras bulanan per kab/kota, konsumsi beras (WebAPI BPS); penduduk dan angka "
                   "sementara/potensi dari CSV repo atau unggahan manual (tidak tersedia di WebAPI).")
def bronze_bps(context: AssetExecutionContext, repo: Repo, sumber_bps: SumberStatis) -> MaterializeResult:
    return _statis(context, repo, sumber_bps, "laporan_webapi.json")


@asset(group_name=GRUP, kinds={"csv", "pdf"}, check_specs=_cek("bronze_bulog"),
       description="Bulog Kanwil Jatim: stok bulanan, stok per kanwil, pengadaan, harga penggilingan, HPP. Diekstrak dari PDF "
                   "Provinsi Jawa Timur Dalam Angka edisi terbaru (terbit tiap Februari); cadangan: unggahan manual/bulog.")
def bronze_bulog(context: AssetExecutionContext, repo: Repo, sumber_bulog: SumberStatis) -> MaterializeResult:
    return _statis(context, repo, sumber_bulog, "laporan_jda.json")


@asset(group_name=GRUP, kinds={"csv"}, description="Matriks jarak dan waktu tempuh antar kab/kota (OSRM). Pembaruan: unggahan manual/jarak.")
def bronze_jarak(context: AssetExecutionContext, repo: Repo) -> MaterializeResult:
    tujuan = tujuan_lapisan("jarak")
    kosongkan_lapisan("jarak")
    manual = terapkan_manual(repo, "jarak", tujuan, None, context.log)
    efektif = berkas_efektif(repo, "jarak", tujuan, manual, "manual")
    hasil = _hasil(repo, [p for p, _ in efektif], "jarak")
    hasil.metadata["berkas"] = MetadataValue.md("\n".join(f"- `{_tampil(repo, p)}` ({asal})" for p, asal in efektif))
    return hasil
