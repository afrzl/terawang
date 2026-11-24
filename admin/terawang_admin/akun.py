"""Akun dan peran (role). Sandi di-hash scrypt, sesi = cookie bertanda tangan HMAC.

Berkas akun (pengaturan.BERKAS_AKUN, mode 600):
  {"rahasia": "<hex>", "pengguna": {"<nama>": {"hash": "scrypt$...", "peran": "superadmin", "versi": 1, "aktif": true, "dibuat": <epoch>}}}
`versi` per pengguna naik setiap sandi/peran diganti atau akun dinonaktifkan, sehingga sesi lama pengguna itu tidak berlaku lagi.
Format lama (satu akun: {"pengguna": "admin", "hash", "rahasia", "versi"}) dibaca sebagai superadmin.

Peran:
  guest       tanpa login: dasbor umum
  perusahaan  dasbor lengkap termasuk SPHP, tanpa admin (hilirisasi)
  dinas       dasbor lengkap termasuk SPHP + admin: pantau pipeline, unggah manual, jalankan job
  superadmin  semua + konfigurasi/secret, kelola akun, jejak admin
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import threading
import time
from collections import defaultdict, deque

from . import pengaturan

NAMA_COOKIE = "tw_sesi"
UMUR_SESI = 12 * 3600
BATAS_GAGAL = 5
JENDELA_GAGAL = 15 * 60
NAMA_SAH = re.compile(r"^[a-z0-9][a-z0-9._-]{2,39}$")

PERAN = ("perusahaan", "dinas", "superadmin")
LABEL_PERAN = {"perusahaan": "Perusahaan (hilirisasi)", "dinas": "Dinas", "superadmin": "Superadmin"}
HAK: dict[str, set[str]] = {
    # dasbor
    "dasbor_sphp": {"perusahaan", "dinas", "superadmin"},
    # admin
    "pipeline": {"dinas", "superadmin"},
    "jalankan": {"dinas", "superadmin"},
    "unggah": {"dinas", "superadmin"},
    "konfigurasi": {"superadmin"},
    "akun": {"superadmin"},
    "jejak": {"superadmin"},
}

_kunci = threading.Lock()
_kunci_berkas = threading.Lock()
_gagal: dict[str, deque] = defaultdict(deque)


def hak_peran(peran: str) -> list[str]:
    return sorted(h for h, p in HAK.items() if peran in p)


def boleh(peran: str | None, hak: str) -> bool:
    return bool(peran) and peran in HAK.get(hak, set())


# ---------- sandi ----------

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


_HASH_PALSU = hash_sandi(secrets.token_hex(8))  # dipakai saat nama tidak ada, supaya waktu respons sama


def periksa_sandi_baru(sandi: str) -> str | None:
    if len(sandi) < 10:
        return "Sandi minimal 10 karakter."
    if len(sandi) > 200:
        return "Sandi terlalu panjang."
    return None


# ---------- berkas akun ----------

def _baca() -> dict:
    try:
        data = json.loads(pengaturan.BERKAS_AKUN.read_text())
    except (OSError, ValueError):
        return {"rahasia": None, "pengguna": {}}
    if isinstance(data.get("pengguna"), str):  # format lama: satu akun
        data = {"rahasia": data["rahasia"], "pengguna": {data["pengguna"]: {
            "hash": data["hash"], "peran": "superadmin", "versi": int(data.get("versi", 1)), "aktif": True, "dibuat": None}}}
    return data


def _tulis(data: dict) -> None:
    pengaturan.BERKAS_AKUN.parent.mkdir(parents=True, exist_ok=True)
    tmp = pengaturan.BERKAS_AKUN.with_suffix(".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(data, f, indent=1)
    os.replace(tmp, pengaturan.BERKAS_AKUN)


def ada_akun() -> bool:
    return bool(_baca()["pengguna"])


def daftar() -> list[dict]:
    return [{"nama": n, "peran": a["peran"], "aktif": a.get("aktif", True), "dibuat": a.get("dibuat"),
             "terakhirMasuk": a.get("terakhir_masuk")} for n, a in sorted(_baca()["pengguna"].items())]


class GalatAkun(ValueError):
    pass


def simpan(nama: str, *, sandi: str | None = None, peran: str | None = None, aktif: bool | None = None, baru: bool = False) -> None:
    """Buat atau ubah akun. Mengubah sandi/peran/aktif menaikkan versi (sesi lama pengguna itu keluar)."""
    nama = nama.strip().lower()
    with _kunci_berkas:
        data = _baca()
        data["rahasia"] = data.get("rahasia") or secrets.token_hex(32)
        semua = data["pengguna"]
        if baru:
            if not NAMA_SAH.match(nama):
                raise GalatAkun("Nama pengguna 3-40 karakter: huruf kecil, angka, titik, minus, garis bawah.")
            if nama in semua:
                raise GalatAkun("Nama pengguna sudah dipakai.")
            if not sandi or not peran:
                raise GalatAkun("Akun baru butuh sandi dan peran.")
            semua[nama] = {"hash": "", "peran": peran, "versi": 0, "aktif": True, "dibuat": time.time()}
        elif nama not in semua:
            raise GalatAkun("Akun tidak ada.")
        a = semua[nama]
        if peran is not None:
            if peran not in PERAN:
                raise GalatAkun("Peran tidak dikenal.")
            a["peran"] = peran
        if sandi is not None:
            salah = periksa_sandi_baru(sandi)
            if salah:
                raise GalatAkun(salah)
            a["hash"] = hash_sandi(sandi)
        if aktif is not None:
            a["aktif"] = bool(aktif)
        # jangan sampai tidak ada superadmin aktif
        if not any(x["peran"] == "superadmin" and x.get("aktif", True) for x in semua.values()):
            raise GalatAkun("Harus tetap ada minimal satu superadmin aktif.")
        a["versi"] = int(a.get("versi", 0)) + 1
        _tulis(data)


def hapus(nama: str) -> None:
    with _kunci_berkas:
        data = _baca()
        if nama not in data["pengguna"]:
            raise GalatAkun("Akun tidak ada.")
        del data["pengguna"][nama]
        if not any(x["peran"] == "superadmin" and x.get("aktif", True) for x in data["pengguna"].values()):
            raise GalatAkun("Harus tetap ada minimal satu superadmin aktif.")
        _tulis(data)


def _catat_masuk(nama: str) -> None:
    with _kunci_berkas:
        data = _baca()
        if nama in data["pengguna"]:
            data["pengguna"][nama]["terakhir_masuk"] = time.time()
            _tulis(data)


# ---------- sesi ----------

def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _tanda(rahasia: str, isi: str) -> str:
    return _b64(hmac.new(bytes.fromhex(rahasia), isi.encode(), hashlib.sha256).digest())


def buat_token(nama: str) -> str:
    data = _baca()
    a = data["pengguna"][nama]
    isi = _b64(json.dumps({"u": nama, "v": a["versi"], "exp": int(time.time()) + UMUR_SESI}).encode())
    return f"{isi}.{_tanda(data['rahasia'], isi)}"


def periksa_token(token: str | None) -> tuple[str, str] | None:
    """(nama, peran) kalau token sah, akun aktif, dan belum kedaluwarsa."""
    data = _baca()
    if not token or not data.get("rahasia") or "." not in token:
        return None
    isi, tanda = token.rsplit(".", 1)
    if not hmac.compare_digest(_tanda(data["rahasia"], isi), tanda):
        return None
    try:
        t = json.loads(_unb64(isi))
    except ValueError:
        return None
    a = data["pengguna"].get(t.get("u"))
    if not a or not a.get("aktif", True) or t.get("v") != a["versi"] or t.get("exp", 0) < time.time():
        return None
    return t["u"], a["peran"]


# ---------- login & penguncian ----------

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


def login(nama: str, sandi: str) -> tuple[str, str] | None:
    nama = nama.strip().lower()
    a = _baca()["pengguna"].get(nama)
    ok = cocok_sandi(sandi, a["hash"] if a else _HASH_PALSU)
    if not a or not ok or not a.get("aktif", True):
        return None
    _catat_masuk(nama)
    return nama, a["peran"]


def ganti_sandi_sendiri(nama: str, lama: str, baru: str) -> None:
    a = _baca()["pengguna"].get(nama)
    if not a or not cocok_sandi(lama, a["hash"]):
        raise GalatAkun("Sandi lama salah.")
    simpan(nama, sandi=baru)
