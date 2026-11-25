"""Buat akun atau atur ulang sandi dari server (mis. akun superadmin pertama, atau lupa sandi):

    .venv-pipeline/bin/python -m terawang_admin.sandi NAMA [PERAN]

PERAN: superadmin | dinas | perusahaan (bawaan: superadmin untuk akun baru, tetap untuk akun lama).
Sandi diketik tanpa tampil. Akun lain dikelola dari tab Akun di halaman admin (superadmin).
"""
import getpass
import sys

from . import pengaturan
from .akun import PERAN, GalatAkun, _baca, simpan


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    nama = sys.argv[1].strip().lower()
    peran = sys.argv[2] if len(sys.argv) > 2 else None
    if peran and peran not in PERAN:
        sys.exit(f"PERAN harus salah satu: {', '.join(PERAN)}")
    baru = nama not in _baca()["pengguna"]
    sandi = getpass.getpass(f"Sandi {'baru ' if not baru else ''}untuk '{nama}': ")
    if getpass.getpass("Ulangi sandi: ") != sandi:
        sys.exit("Sandi tidak sama.")
    try:
        simpan(nama, sandi=sandi, peran=peran or ("superadmin" if baru else None), baru=baru)
    except GalatAkun as e:
        sys.exit(str(e))
    print(f"Tersimpan di {pengaturan.BERKAS_AKUN}. Sesi lama '{nama}' sudah tidak berlaku.")


if __name__ == "__main__":
    main()
