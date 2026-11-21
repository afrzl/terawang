"""Konektor (resource) yang dipakai aset. Mengganti sumber data = mengganti atau mengatur konektor di sini.

Pengaturan lewat environment (lihat pipeline/.env.example):
  DATABASE_URL           Postgres `terawang` (format sama dengan api/.env)
  TERAWANG_REPO          akar repo (default: folder induk pipeline/)
  TERAWANG_SUMBER_HARGA  "berkas" (pakai CSV di data/, default) atau "siskaperbapo" (unduh baru)
  TERAWANG_SUMBER_CITRA  "berkas" (pakai src/lib/gee_wilayah.json, default) atau "gee" (jalankan GEE, butuh GEE_PROJECT)
  TERAWANG_TITIK_DIR     mode gee: deret titik sawah 12-harian yang diperpanjang (default ~/.local/share/terawang/titik)
  TERAWANG_K1_DIR        taksiran citra K1 bulan operasional (default ~/.local/share/terawang/k1)
"""
from __future__ import annotations

import hashlib
import os
import subprocess
import sys
from pathlib import Path
from typing import ClassVar
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import pandas as pd
import sqlalchemy as sa
from dagster import ConfigurableResource, EnvVar


def _repo_default() -> str:
    return str(Path(__file__).resolve().parents[2])


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for blok in iter(lambda: f.read(1 << 20), b""):
            h.update(blok)
    return h.hexdigest()


class Repo(ConfigurableResource):
    """Akar repo terawang: tempat data/, scripts/, api/."""

    akar: str = _repo_default()

    @property
    def path(self) -> Path:
        return Path(self.akar)

    def jalankan(self, args: list[str], cwd: str | None = None, env: dict | None = None, log=None) -> str:
        """Jalankan perintah di repo; gagal = exception (aset jadi merah di Dagster)."""
        hasil = subprocess.run(args, cwd=self.path / (cwd or ""), env={**os.environ, **(env or {})}, capture_output=True, text=True)
        keluaran = (hasil.stdout + hasil.stderr)[-6000:]
        if log:
            log.info(keluaran)
        if hasil.returncode != 0:
            raise RuntimeError(f"{' '.join(args)} gagal (kode {hasil.returncode}):\n{keluaran}")
        return keluaran


class Database(ConfigurableResource):
    """Postgres `terawang` (schema ref, silver, app). URL sama dengan yang dipakai Prisma di api/.env."""

    url: str

    def _url_sqlalchemy(self) -> str:
        bagian = urlsplit(self.url)
        q = [(k, v) for k, v in parse_qsl(bagian.query) if k != "schema"]  # parameter khusus Prisma
        return urlunsplit(("postgresql+psycopg2", bagian.netloc, bagian.path, urlencode(q), ""))

    def engine(self) -> sa.Engine:
        return sa.create_engine(self._url_sqlalchemy(), future=True)

    def baca(self, sql: str, **params) -> pd.DataFrame:
        with self.engine().connect() as c:
            return pd.read_sql(sa.text(sql), c, params=params)


class SumberHarga(ConfigurableResource):
    """Konektor harga konsumen beras. Kontrak keluaran: folder berisi kabkota/provinsi_harian_*.csv dan pasar_harian_*.csv.gz
    (kolom sama dengan data/siskaperbapo/harga_beras/), dibaca ingest silver lewat TERAWANG_HARGA_DIR.

    - berkas: pakai CSV yang ada di repo.
    - siskaperbapo: unduh ke `folder_unduhan` (di luar repo, supaya worktree git tetap bersih).
    Menambah sumber baru (mis. Panel Harga Bapanas): tambah cabang `mode` yang menulis berkas dengan kolom sama.
    """

    mode: str = "berkas"  # "berkas" | "siskaperbapo"
    folder_unduhan: str = str(Path.home() / ".local/share/terawang/harga_beras")

    KOMODITAS: ClassVar[dict[str, int]] = {"beras_medium": 4, "beras_premium": 2}

    def folder(self, repo: Repo) -> Path:
        return Path(self.folder_unduhan) if self.mode == "siskaperbapo" else repo.path / "data/siskaperbapo/harga_beras"

    def berkas(self, repo: Repo) -> list[Path]:
        d = self.folder(repo)
        return [d / f"{jenis}_harian_{nama}.csv" for nama in self.KOMODITAS for jenis in ("kabkota", "provinsi")] + [
            d / f"pasar_harian_{nama}.csv.gz" for nama in self.KOMODITAS
        ]

    def perbarui(self, repo: Repo, log=None) -> list[Path]:
        if self.mode == "siskaperbapo":
            self.folder(repo).mkdir(parents=True, exist_ok=True)
            for nama, kode in self.KOMODITAS.items():
                repo.jalankan([sys.executable, "scripts/siskaperbapo/ambil_harga.py", "--komoditas", str(kode), "--nama", nama,
                               "--keluar", str(self.folder(repo))], log=log)
        elif self.mode != "berkas":
            raise ValueError(f"TERAWANG_SUMBER_HARGA tidak dikenal: {self.mode}")
        return self.berkas(repo)


class SumberCitra(ConfigurableResource):
    """Konektor citra satelit. Kontrak keluaran: JSON berformat src/lib/gee_wilayah.json (dibaca ingest silver satelit
    lewat TERAWANG_GEE_JSON).

    - berkas: pakai src/lib/gee_wilayah.json di repo.
    - gee: hitung ulang di Earth Engine ke `berkas_keluaran` (di luar repo, supaya worktree git tetap bersih).

    Mode `gee` butuh paket earthengine-api dan kredensial: `earthengine authenticate` sekali di server, atau
    GOOGLE_APPLICATION_CREDENTIALS = kunci JSON service account yang terdaftar di Earth Engine.
    """

    mode: str = "berkas"  # "berkas" | "gee"
    gee_project: str = ""
    berkas_keluaran: str = str(Path.home() / ".local/share/terawang/gee_wilayah.json")
    folder_titik_gee: str = str(Path.home() / ".local/share/terawang/titik")
    TITIK: ClassVar[tuple[str, ...]] = ("vh_titik_12harian_kabkota.csv.gz", "vv_titik_12harian_kabkota.csv.gz", "s2_titik_12harian_kabkota.csv.gz")

    def folder_titik(self, repo: Repo) -> Path:
        """Deret 12-harian VH, VV, LSWI/EVI di 15.200 titik sawah (masukan K1 Danang)."""
        return Path(self.folder_titik_gee) if self.mode == "gee" else repo.path / "data/satelit"

    def perbarui_titik(self, repo: Repo, log=None) -> list[Path]:
        """Mode gee: perpanjang deret titik sampai hari ini (scripts/gee/perpanjang_titik.py). Mode berkas: pakai data/satelit."""
        folder = self.folder_titik(repo)
        if self.mode == "gee":
            if not self.gee_project:
                raise ValueError("TERAWANG_SUMBER_CITRA=gee butuh GEE_PROJECT")
            repo.jalankan([sys.executable, "scripts/gee/perpanjang_titik.py", "--project", self.gee_project,
                           "--dasar", "data/satelit", "--keluar", str(folder)], log=log)
        return [folder / b for b in self.TITIK]

    def berkas(self, repo: Repo) -> Path:
        return Path(self.berkas_keluaran) if self.mode == "gee" else repo.path / "src/lib/gee_wilayah.json"

    def _ee(self):
        import ee  # hanya dibutuhkan di mode gee

        ee.Initialize(project=self.gee_project)
        return ee

    def citra_terbaru(self) -> str:
        """Tanggal akuisisi Sentinel-1 terbaru yang menutupi Jawa Timur (YYYY-MM-DD). Dipakai sensor dan sebagai --acuan."""
        ee = self._ee()
        jatim = ee.FeatureCollection("FAO/GAUL/2015/level1").filter(ee.Filter.eq("ADM1_NAME", "Jawa Timur")).geometry()
        kini = ee.Date(pd.Timestamp.now(tz="UTC").isoformat())
        kol = ee.ImageCollection("COPERNICUS/S1_GRD").filterBounds(jatim).filterDate(kini.advance(-30, "day"), kini)
        ms = kol.aggregate_max("system:time_start").getInfo()
        if not ms:
            raise RuntimeError("tidak ada citra Sentinel-1 Jawa Timur 30 hari terakhir")
        return pd.Timestamp(ms, unit="ms", tz="UTC").tz_convert("Asia/Jakarta").strftime("%Y-%m-%d")

    def perbarui(self, repo: Repo, log=None) -> Path:
        out = self.berkas(repo)
        if self.mode == "gee":
            out.parent.mkdir(parents=True, exist_ok=True)
            if not self.gee_project:
                raise ValueError("TERAWANG_SUMBER_CITRA=gee butuh GEE_PROJECT")
            acuan = self.citra_terbaru()
            if log:
                log.info(f"citra Sentinel-1 terbaru: {acuan}")
            repo.jalankan([sys.executable, "scripts/gee/terawang_wilayah.py", "--project", self.gee_project,
                           "--acuan", acuan, "--out", str(out)], log=log)
        elif self.mode != "berkas":
            raise ValueError(f"TERAWANG_SUMBER_CITRA tidak dikenal: {self.mode}")
        return out


def semua_resource() -> dict:
    return {
        "repo": Repo(akar=os.environ.get("TERAWANG_REPO", _repo_default())),
        "db": Database(url=EnvVar("DATABASE_URL")),
        "sumber_harga": SumberHarga(mode=os.environ.get("TERAWANG_SUMBER_HARGA", "berkas"),
                                    **({"folder_unduhan": os.environ["TERAWANG_HARGA_DIR"]} if os.environ.get("TERAWANG_HARGA_DIR") else {})),
        "sumber_citra": SumberCitra(mode=os.environ.get("TERAWANG_SUMBER_CITRA", "berkas"), gee_project=os.environ.get("GEE_PROJECT", ""),
                                    **({"berkas_keluaran": os.environ["TERAWANG_GEE_JSON"]} if os.environ.get("TERAWANG_GEE_JSON") else {}),
                                    **({"folder_titik_gee": os.environ["TERAWANG_TITIK_DIR"]} if os.environ.get("TERAWANG_TITIK_DIR") else {})),
    }
