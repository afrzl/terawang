"""Seeder peran, hak, dan akun demo.

    .venv-pipeline/bin/python -m terawang_admin.seeder            # isi matriks hak bila belum ada + buat akun demo yang belum ada
    .venv-pipeline/bin/python -m terawang_admin.seeder --ulang    # kembalikan matriks ke bawaan + atur ulang sandi akun demo

Matriks bawaan (akun.HAK_BAWAAN):
  tamu        peta ringkasan, produksi, stok, arus beras, laporan pekanan; hanya data yang sudah terjadi
  perusahaan  semua halaman dasbor + harga + SPHP, dengan estimasi dan prakiraan
  dinas       seperti perusahaan + admin: pantau pipeline, unggah berkas manual, jalankan job, validasi laporan
  superadmin  semua fitur termasuk konfigurasi/secret, bot WhatsApp, akun, jejak

Sandi akun demo bisa diganti lewat env TERAWANG_DEMO_SANDI_<PERAN> (mis. TERAWANG_DEMO_SANDI_TAMU).
"""
from __future__ import annotations

import os
import sys

from . import akun, pengaturan

SANDI_DEMO = {"tamu": "tamu-terawang", "perusahaan": "perusahaan-terawang", "dinas": "dinas-terawang", "superadmin": "admin-terawang"}


def jalankan(ulang: bool = False) -> list[str]:
    catatan = []
    if ulang or not pengaturan.BERKAS_PERAN.exists():
        akun.tulis_matriks(akun.HAK_BAWAAN)
        catatan.append(f"Matriks hak bawaan ditulis ke {pengaturan.BERKAS_PERAN}")
    ada = akun._baca()["pengguna"]
    # superadmin demo dibuat dulu (aturan: minimal satu superadmin aktif)
    for peran, nama in sorted(akun.AKUN_DEMO.items(), key=lambda x: x[0] != "superadmin"):
        sandi = os.environ.get(f"TERAWANG_DEMO_SANDI_{peran.upper()}", SANDI_DEMO[peran])
        if nama not in ada:
            akun.simpan(nama, sandi=sandi, peran=peran, baru=True, demo=True)
            catatan.append(f"Akun demo {nama} ({akun.LABEL_PERAN[peran]}) dibuat")
        elif ulang:
            akun.simpan(nama, sandi=sandi, peran=peran, aktif=True, demo=True)
            catatan.append(f"Akun demo {nama} diatur ulang")
    return catatan


def main() -> None:
    if any(a in ("-h", "--help") for a in sys.argv[1:]):
        sys.exit(__doc__)
    for c in jalankan(ulang="--ulang" in sys.argv[1:]) or ["Tidak ada yang berubah."]:
        print(c)


if __name__ == "__main__":
    main()
