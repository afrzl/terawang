"""Jembatan ke skrip model asli Danang di scripts/k1 dan scripts/k2.

Skrip Danang memakai path relatif terhadap akar repo ("data/...", "scripts/k1") dan membaca database lewat
DATABASE_URL (atau psql lokal). Fungsi di sini menyiapkan keduanya lalu mengimpor modulnya, tanpa menyalin logika model.
"""

import contextlib
import importlib
import os
import sys
from pathlib import Path


@contextlib.contextmanager
def di_repo(akar: str | Path, env: dict[str, str] | None = None):
    """Jalankan blok dengan cwd = akar repo, scripts/k1 dan scripts/k2 di sys.path, dan env tambahan."""
    akar = Path(akar).resolve()
    lama_cwd, lama_path, lama_env = os.getcwd(), list(sys.path), {k: os.environ.get(k) for k in (env or {})}
    os.chdir(akar)
    sys.path[:0] = [str(akar / "scripts/k1"), str(akar / "scripts/k2")]
    os.environ.update({k: str(v) for k, v in (env or {}).items()})
    try:
        yield
    finally:
        os.chdir(lama_cwd)
        sys.path[:] = lama_path
        for k, v in lama_env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


def modul(nama: str):
    """Impor (ulang) modul skrip Danang, mis. modul("k2_operasional"). Dipanggil di dalam di_repo()."""
    if nama in sys.modules:
        return importlib.reload(sys.modules[nama])
    return importlib.import_module(nama)
