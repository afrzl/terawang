"""Konektor (resource) yang dipakai aset. Mengganti sumber data = mengganti atau mengatur konektor di sini.

Pengaturan lewat environment (lihat pipeline/.env.example):
  DATABASE_URL           Postgres `terawang` (format sama dengan api/.env)
  TERAWANG_REPO          akar repo (default: folder induk pipeline/)
  TERAWANG_SUMBER_HARGA  "berkas" (pakai CSV di data/, default) atau "siskaperbapo" (unduh baru)
  TERAWANG_SUMBER_CITRA  "berkas" (pakai src/lib/gee_wilayah.json, default) atau "gee" (jalankan GEE, butuh GEE_PROJECT)
  TERAWANG_TITIK_DIR     mode gee: deret titik sawah 12-harian yang diperpanjang (default ~/.local/share/terawang/titik)
  TERAWANG_K1_DIR        taksiran citra K1 bulan operasional (default ~/.local/share/terawang/k1)
  TERAWANG_SUMBER_BPS    "berkas" (CSV repo, default), "webapi" (WebAPI BPS, butuh BPS_WEBAPI_KEY) atau "manual" (repo + unggahan)
  TERAWANG_SUMBER_BULOG  "berkas" (CSV repo, default), "jda" (PDF Jatim Dalam Angka via WebAPI BPS) atau "manual"
  TERAWANG_DATA_DIR      lapisan data hasil konektor di atas data/ repo (default ~/.local/share/terawang/data)
  TERAWANG_MANUAL_DIR    unggahan manual per sumber: <dir>/{bps,bulog,harga,jarak}/<nama berkas repo> (default ~/.local/share/terawang/manual)

Urutan pakai tiap berkas: hasil otomatis -> unggahan manual (bila otomatis gagal, tidak menulis berkas itu, atau mode manual)
-> CSV repo. Key BPS hanya dibaca dari env BPS_WEBAPI_KEY oleh skrip (tidak masuk konfigurasi resource yang tampil di UI).
"""
from __future__ import annotations

import gzip
import hashlib
import os
import shutil
import time
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


# ---------------------------------------------------------------- lapisan data dan unggahan manual
REPO_DIR = {"bps": "data/bps", "bulog": "data/bulog", "jarak": "data/geografi/jarak_kabkota", "harga": "data/siskaperbapo/harga_beras",
            "bapanas": "data/bapanas/panel_harga"}
EKSTENSI = (".csv", ".csv.gz")


def folder_lapisan() -> Path:
    return Path(os.environ.get("TERAWANG_DATA_DIR") or Path.home() / ".local/share/terawang/data").expanduser()


def folder_manual() -> Path:
    return Path(os.environ.get("TERAWANG_MANUAL_DIR") or Path.home() / ".local/share/terawang/manual").expanduser()


def tujuan_lapisan(sumber: str) -> Path:
    """Folder di lapisan yang mencerminkan data/<...> sumber ini (dibaca ingest lewat TERAWANG_DATA_DIR)."""
    return folder_lapisan() / REPO_DIR[sumber].removeprefix("data/")


def _data(p: Path) -> bool:
    return p.is_file() and p.name.endswith(EKSTENSI)


def _header(p: Path) -> str:
    buka = gzip.open if p.name.endswith(".gz") else open
    with buka(p, "rt", encoding="utf-8-sig") as f:
        return f.readline().strip().replace("\r", "")


def berkas_repo(repo: "Repo", sumber: str) -> dict[str, Path]:
    """{path relatif terhadap folder sumber: path repo} untuk semua CSV sumber ini di repo."""
    akar = repo.path / REPO_DIR[sumber]
    return {str(p.relative_to(akar)): p for p in sorted(akar.rglob("*")) if _data(p)}


def kosongkan_lapisan(sumber: str) -> None:
    """Hapus hasil konektor sumber ini dari lapisan (folder berawalan _ seperti cache PDF dibiarkan)."""
    akar = tujuan_lapisan(sumber)
    if akar.exists():
        for p in akar.rglob("*"):
            if p.is_file() and not any(b.startswith("_") for b in p.relative_to(akar).parts[:-1]):
                p.unlink()


def terapkan_manual(repo: "Repo", sumber: str, tujuan: Path, sejak: float | None, log=None) -> list[str]:
    """Salin unggahan <TERAWANG_MANUAL_DIR>/<sumber>/<nama> ke `tujuan`, di path repo yang namanya sama.

    Berkas yang namanya tidak ada di repo atau header-nya beda dilewati dengan peringatan. Kalau `sejak` diisi (konektor
    otomatis sukses di run ini), berkas yang baru ditulis konektor (mtime >= sejak) tidak ditimpa unggahan."""
    folder = folder_manual() / sumber
    if not folder.is_dir():
        return []
    peta = {p.name: rel for rel, p in berkas_repo(repo, sumber).items()}
    dipakai = []
    for u in sorted(folder.iterdir()):
        if u.name.startswith((".", "_")) or not _data(u):
            continue
        rel = peta.get(u.name)
        if rel is None:
            log and log.warning(f"unggahan {sumber}/{u.name} dilewati: tidak ada berkas repo bernama sama")
            continue
        if _header(u) != _header(repo.path / REPO_DIR[sumber] / rel):
            log and log.warning(f"unggahan {sumber}/{u.name} dilewati: kolom beda dengan berkas repo")
            continue
        t = tujuan / rel
        if sejak is not None and t.exists() and t.stat().st_mtime >= sejak:
            continue
        t.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(u, t)
        dipakai.append(rel)
    if dipakai and log:
        log.info(f"unggahan manual {sumber} dipakai: {dipakai}")
    return dipakai


def berkas_efektif(repo: "Repo", sumber: str, tujuan: Path, manual: list[str], label_otomatis: str) -> list[tuple[Path, str]]:
    """Berkas yang akan dibaca ingest beserta asalnya: (path, 'otomatis'|'manual'|'repo'). Berkas lapisan yang tidak ada
    di repo (mis. tahun baru dari WebAPI) ikut dicantumkan."""
    rp = berkas_repo(repo, sumber)
    hasil = []
    for rel, p in rp.items():
        t = tujuan / rel
        hasil.append((t, "manual" if rel in manual else label_otomatis) if t.exists() else (p, "repo"))
    if tujuan.exists():
        for t in sorted(tujuan.rglob("*")):
            rel = str(t.relative_to(tujuan))
            if _data(t) and rel not in rp and not any(b.startswith("_") for b in t.relative_to(tujuan).parts[:-1]):
                hasil.append((t, f"{label_otomatis} (baru)"))
    return hasil


class SumberStatis(ConfigurableResource):
    """Konektor sumber tahunan/bulanan BPS atau Bulog. Kontrak keluaran: CSV berformat data/<sumber> di lapisan
    TERAWANG_DATA_DIR (ingest membaca lapisan dulu, lalu repo).

    - bps:   mode berkas | webapi (scripts/bps/ambil_webapi.py) | manual
    - bulog: mode berkas | jda (scripts/bulog/ambil_jda.py, PDF Jatim Dalam Angka) | manual
    """

    sumber: str
    mode: str = "berkas"
    SKRIP: ClassVar[dict[str, tuple[str, str]]] = {"bps": ("webapi", "scripts/bps/ambil_webapi.py"), "bulog": ("jda", "scripts/bulog/ambil_jda.py")}

    def perbarui(self, repo: "Repo", log=None) -> dict:
        """Jalankan konektor otomatis (bila mode-nya), lalu unggahan manual. Galat konektor tidak menggagalkan aset:
        data terakhir yang sah + unggahan manual + repo tetap dipakai, dan status dicatat untuk asset check."""
        mode_oto, skrip = self.SKRIP[self.sumber]
        tujuan = tujuan_lapisan(self.sumber)
        status = {"mode": self.mode, "otomatis": None, "galat": None}
        sejak = None
        if self.mode == mode_oto:
            t0 = time.time()
            try:
                if not os.environ.get("BPS_WEBAPI_KEY"):
                    raise RuntimeError("BPS_WEBAPI_KEY belum diisi di pipeline/.env")
                repo.jalankan([sys.executable, skrip, "--keluar", str(folder_lapisan())], log=log)
                status["otomatis"], sejak = "berhasil", t0
            except Exception as e:
                status["otomatis"], status["galat"] = "gagal", str(e)[-1500:]
                log and log.warning(f"konektor {self.sumber} ({self.mode}) gagal, memakai data terakhir + unggahan manual + repo: {str(e)[-500:]}")
        elif self.mode in ("berkas", "manual"):
            kosongkan_lapisan(self.sumber)
        else:
            raise ValueError(f"TERAWANG_SUMBER_{self.sumber.upper()} tidak dikenal: {self.mode}")
        manual = terapkan_manual(repo, self.sumber, tujuan, sejak, log) if self.mode != "berkas" else []
        status["manual"] = manual
        status["berkas"] = berkas_efektif(repo, self.sumber, tujuan, manual, self.mode if self.mode == mode_oto else "lapisan")
        return status


class SumberHarga(ConfigurableResource):
    """Konektor harga konsumen beras. Kontrak keluaran: folder berisi kabkota/provinsi_harian_*.csv dan pasar_harian_*.csv.gz
    (kolom sama dengan data/siskaperbapo/harga_beras/), dibaca ingest silver lewat TERAWANG_HARGA_DIR.

    - berkas: pakai CSV yang ada di repo.
    - siskaperbapo: unduh ke `folder_unduhan` (di luar repo, supaya worktree git tetap bersih).
    Menambah sumber baru (mis. Panel Harga Bapanas): tambah cabang `mode` yang menulis berkas dengan kolom sama.
    """

    mode: str = "berkas"  # "berkas" | "siskaperbapo" | "manual"
    folder_unduhan: str = str(Path.home() / ".local/share/terawang/harga_beras")

    KOMODITAS: ClassVar[dict[str, int]] = {"beras_medium": 4, "beras_premium": 2}

    def folder(self, repo: Repo) -> Path:
        return Path(self.folder_unduhan) if self.mode in ("siskaperbapo", "manual") else repo.path / "data/siskaperbapo/harga_beras"

    def berkas(self, repo: Repo) -> list[Path]:
        d = self.folder(repo)
        return [d / f"{jenis}_harian_{nama}.csv" for nama in self.KOMODITAS for jenis in ("kabkota", "provinsi")] + [
            d / f"pasar_harian_{nama}.csv.gz" for nama in self.KOMODITAS
        ]

    def perbarui(self, repo: Repo, log=None) -> tuple[list[Path], dict]:
        """Mode siskaperbapo: unduh; kalau gagal, pakai unduhan terakhir + unggahan manual (manual/harga). Mode manual:
        CSV repo + unggahan manual, disusun di folder_unduhan."""
        status = {"mode": self.mode, "otomatis": None, "galat": None, "manual": []}
        d = self.folder(repo)
        if self.mode == "siskaperbapo":
            d.mkdir(parents=True, exist_ok=True)
            t0 = time.time()
            try:
                for nama, kode in self.KOMODITAS.items():
                    repo.jalankan([sys.executable, "scripts/siskaperbapo/ambil_harga.py", "--komoditas", str(kode), "--nama", nama,
                                   "--keluar", str(d)], log=log)
                status["otomatis"] = "berhasil"
            except Exception as e:
                status["otomatis"], status["galat"], t0 = "gagal", str(e)[-1500:], None
                log and log.warning(f"unduh SISKAPERBAPO gagal, memakai unduhan terakhir + unggahan manual: {str(e)[-500:]}")
            status["manual"] = terapkan_manual(repo, "harga", d, t0, log)
        elif self.mode == "manual":
            d.mkdir(parents=True, exist_ok=True)
            for rel, p in berkas_repo(repo, "harga").items():
                shutil.copyfile(p, d / rel)
            status["manual"] = terapkan_manual(repo, "harga", d, None, log)
        elif self.mode != "berkas":
            raise ValueError(f"TERAWANG_SUMBER_HARGA tidak dikenal: {self.mode}")
        return self.berkas(repo), status


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
        "sumber_bps": SumberStatis(sumber="bps", mode=os.environ.get("TERAWANG_SUMBER_BPS", "berkas")),
        "sumber_bulog": SumberStatis(sumber="bulog", mode=os.environ.get("TERAWANG_SUMBER_BULOG", "berkas")),
        "sumber_citra": SumberCitra(mode=os.environ.get("TERAWANG_SUMBER_CITRA", "berkas"), gee_project=os.environ.get("GEE_PROJECT", ""),
                                    **({"berkas_keluaran": os.environ["TERAWANG_GEE_JSON"]} if os.environ.get("TERAWANG_GEE_JSON") else {}),
                                    **({"folder_titik_gee": os.environ["TERAWANG_TITIK_DIR"]} if os.environ.get("TERAWANG_TITIK_DIR") else {})),
    }
