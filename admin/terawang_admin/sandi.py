"""Atur atau ganti akun admin. Jalankan di server:

    .venv-pipeline/bin/python -m terawang_admin.sandi [nama_pengguna]

Sandi diketik tanpa tampil (getpass). Mengganti sandi membuat semua sesi lama keluar otomatis.
"""
import getpass
import sys

from . import pengaturan
from .akun import baca_akun, simpan_akun


def main() -> None:
    lama = baca_akun()
    pengguna = sys.argv[1] if len(sys.argv) > 1 else (lama or {}).get("pengguna") or "admin"
    sandi = getpass.getpass(f"Sandi baru untuk '{pengguna}': ")
    if len(sandi) < 10:
        sys.exit("Sandi minimal 10 karakter.")
    if getpass.getpass("Ulangi sandi: ") != sandi:
        sys.exit("Sandi tidak sama.")
    simpan_akun(pengguna, sandi)
    print(f"Tersimpan di {pengaturan.BERKAS_AKUN}. Semua sesi lama sudah tidak berlaku.")


if __name__ == "__main__":
    main()
