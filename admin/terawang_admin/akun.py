"""Akun admin tunggal: sandi di-hash scrypt, sesi = cookie bertanda tangan HMAC.

Berkas akun (pengaturan.BERKAS_AKUN, mode 600):
  {"pengguna": "admin", "hash": "scrypt$16384$8$1$<garam hex>$<hash hex>", "rahasia": "<hex>", "versi": 1}
`versi` naik setiap sandi diganti, sehingga semua sesi lama otomatis tidak berlaku.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import threading
import time
from collections import defaultdict, deque

from . import pengaturan

NAMA_COOKIE = "tw_admin"
UMUR_SESI = 12 * 3600
BATAS_GAGAL = 5
JENDELA_GAGAL = 15 * 60

_kunci = threading.Lock()
_gagal: dict[str, deque] = defaultdict(deque)


def hash_sandi(sandi: str) -> str:
    garam = secrets.token_bytes(16)
    n, r, p = 2**14, 8, 1
    h = hashlib.scrypt(sandi.encode(), salt=garam, n=n, r=r, p=p, dklen=32)
    return f"scrypt${n}${r}${p}${garam.hex()}${h.hex()}"


def cocok_sandi(sandi: str, tersimpan: str) -> bool:
    try:
        algo, n, r, p, garam, h = tersimpan.split("$")
        if algo != "scrypt":
            return False
        hitung = hashlib.scrypt(sandi.encode(), salt=bytes.fromhex(garam), n=int(n), r=int(r), p=int(p), dklen=len(h) // 2)
        return hmac.compare_digest(hitung.hex(), h)
    except (ValueError, TypeError):
        return False


def baca_akun() -> dict | None:
    try:
        return json.loads(pengaturan.BERKAS_AKUN.read_text())
    except (OSError, ValueError):
        return None


def simpan_akun(pengguna: str, sandi: str) -> None:
    lama = baca_akun() or {}
    akun = {"pengguna": pengguna, "hash": hash_sandi(sandi), "rahasia": lama.get("rahasia") or secrets.token_hex(32),
            "versi": int(lama.get("versi", 0)) + 1}
    pengaturan.BERKAS_AKUN.parent.mkdir(parents=True, exist_ok=True)
    tmp = pengaturan.BERKAS_AKUN.with_suffix(".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(akun, f)
    os.replace(tmp, pengaturan.BERKAS_AKUN)


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def buat_token(akun: dict) -> str:
    isi = _b64(json.dumps({"u": akun["pengguna"], "v": akun["versi"], "exp": int(time.time()) + UMUR_SESI}).encode())
    tanda = _b64(hmac.new(bytes.fromhex(akun["rahasia"]), isi.encode(), hashlib.sha256).digest())
    return f"{isi}.{tanda}"


def periksa_token(token: str | None) -> str | None:
    """Kembalikan nama pengguna kalau token sah dan belum kedaluwarsa."""
    akun = baca_akun()
    if not token or not akun or "." not in token:
        return None
    isi, tanda = token.rsplit(".", 1)
    benar = _b64(hmac.new(bytes.fromhex(akun["rahasia"]), isi.encode(), hashlib.sha256).digest())
    if not hmac.compare_digest(benar, tanda):
        return None
    try:
        data = json.loads(_unb64(isi))
    except ValueError:
        return None
    if data.get("v") != akun["versi"] or data.get("u") != akun["pengguna"] or data.get("exp", 0) < time.time():
        return None
    return data["u"]


def terkunci(ip: str) -> int:
    """Detik sisa penguncian untuk IP ini (0 = boleh mencoba)."""
    with _kunci:
        q = _gagal[ip]
        kini = time.time()
        while q and q[0] < kini - JENDELA_GAGAL:
            q.popleft()
        return int(q[0] + JENDELA_GAGAL - kini) + 1 if len(q) >= BATAS_GAGAL else 0


def catat_gagal(ip: str) -> None:
    with _kunci:
        _gagal[ip].append(time.time())


def bersihkan_gagal(ip: str) -> None:
    with _kunci:
        _gagal.pop(ip, None)


def login(pengguna: str, sandi: str) -> dict | None:
    akun = baca_akun()
    if not akun:
        return None
    ok_pengguna = hmac.compare_digest(pengguna.encode(), akun["pengguna"].encode())
    ok_sandi = cocok_sandi(sandi, akun["hash"])  # selalu dihitung supaya waktu respons sama
    return akun if ok_pengguna and ok_sandi else None
