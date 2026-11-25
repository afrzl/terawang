"""Jejak audit: setiap tindakan admin (login, ubah config, unggah, jalankan job) dicatat satu baris JSON. Tanpa nilai secret."""
from __future__ import annotations

import json
import time

from . import pengaturan


def catat(tindakan: str, pengguna: str | None, ip: str | None, **rinci) -> None:
    pengaturan.JEJAK.parent.mkdir(parents=True, exist_ok=True)
    baris = {"waktu": time.time(), "tindakan": tindakan, "pengguna": pengguna, "ip": ip, **rinci}
    with open(pengaturan.JEJAK, "a", encoding="utf-8") as f:
        f.write(json.dumps(baris, ensure_ascii=False) + "\n")


def baca(batas: int = 200) -> list[dict]:
    if not pengaturan.JEJAK.exists():
        return []
    baris = pengaturan.JEJAK.read_text(encoding="utf-8").splitlines()[-batas:]
    hasil = []
    for b in reversed(baris):
        try:
            hasil.append(json.loads(b))
        except ValueError:
            continue
    return hasil
