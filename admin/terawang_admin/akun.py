"""Akun dan peran (role). Sandi di-hash scrypt, sesi = cookie bertanda tangan HMAC.

Berkas akun (pengaturan.BERKAS_AKUN, mode 600):
  {"rahasia": "<hex>", "pengguna": {"<nama>": {"hash": "scrypt$...", "peran": "superadmin", "versi": 1, "aktif": true, "dibuat": <epoch>}}}
`versi` per pengguna naik setiap sandi/peran diganti atau akun dinonaktifkan, sehingga sesi lama pengguna itu tidak berlaku lagi.
Format lama (satu akun: {"pengguna": "admin", "hash", "rahasia", "versi"}) dibaca sebagai superadmin.

Peran (hak tiap peran bisa dicentang di halaman Akun & peran, disimpan di pengaturan.BERKAS_PERAN):
  tamu        dasbor tanpa estimasi/prakiraan: peta ringkasan, produksi, stok, arus beras, laporan pekanan
  perusahaan  dasbor lengkap termasuk harga, SPHP, dan estimasi
  dinas       dasbor lengkap + admin: pantau pipeline, unggah manual, jalankan job, validasi laporan (dinas/Bulog)
  superadmin  semua hak, selalu (tidak bisa dikurangi supaya tidak terkunci)
Isi awal matriks dan akun demo: `python -m terawang_admin.seeder`.
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

PERAN = ("tamu", "perusahaan", "dinas", "superadmin")
LABEL_PERAN = {"tamu": "Tamu", "perusahaan": "Perusahaan", "dinas": "Dinas / Bulog", "superadmin": "Admin"}
PERAN_PENUH = "superadmin"  # selalu punya semua hak

# Fitur yang bisa dicentang per peran: (id hak, label, grup)
FITUR: list[tuple[str, str, str]] = [
    ("dasbor_ringkasan", "Peta ringkasan", "Dasbor"),
    ("dasbor_produksi", "Produksi", "Dasbor"),
    ("dasbor_stok", "Stok", "Dasbor"),
    ("dasbor_arus", "Arus beras", "Dasbor"),
    ("dasbor_cerita", "Laporan pekanan", "Dasbor"),
    ("dasbor_harga", "Harga", "Dasbor"),
    ("dasbor_sphp", "Rekomendasi SPHP", "Dasbor"),
    ("dasbor_estimasi", "Estimasi & prakiraan", "Dasbor"),
    ("dasbor_whatsapp", "Simulasi bot WhatsApp", "Dasbor"),
    ("pipeline", "Pantau pipeline & sumber data", "Admin"),
    ("unggah", "Unggah data manual", "Admin"),
    ("jalankan", "Jalankan job", "Admin"),
    ("laporan", "Validasi laporan warga", "Admin"),
    ("whatsapp", "Bot WhatsApp", "Admin"),
    ("konfigurasi", "Konfigurasi & secret", "Admin"),
    ("akun", "Kelola akun & peran", "Admin"),
    ("jejak", "Jejak admin", "Admin"),
]
SEMUA_HAK = [f[0] for f in FITUR]
_DASBOR_UMUM = ["dasbor_ringkasan", "dasbor_produksi", "dasbor_stok", "dasbor_arus", "dasbor_cerita"]
_DASBOR_LENGKAP = _DASBOR_UMUM + ["dasbor_harga", "dasbor_sphp", "dasbor_estimasi", "dasbor_whatsapp"]
# Isi awal matriks (seeder). Tamu: hanya data yang sudah terjadi, tanpa estimasi/prakiraan.
HAK_BAWAAN: dict[str, list[str]] = {
    "tamu": list(_DASBOR_UMUM),
    "perusahaan": list(_DASBOR_LENGKAP),
    "dinas": _DASBOR_LENGKAP + ["pipeline", "unggah", "jalankan", "laporan"],
    "superadmin": list(SEMUA_HAK),
}
# Akun demo (tombol "Masuk sebagai" di halaman masuk). Akun demo tidak bisa mengubah hal yang menyangkut akun,
# secret, atau nomor WhatsApp, supaya demo untuk juri tidak bisa mengunci atau merusak sistem.
AKUN_DEMO: dict[str, str] = {"tamu": "tamu.demo", "perusahaan": "perusahaan.demo", "dinas": "dinas.demo", "superadmin": "admin.demo"}
HAK_TULIS_TERLARANG_DEMO = {"akun", "konfigurasi", "whatsapp"}

_kunci = threading.Lock()
_kunci_berkas = threading.Lock()
_gagal: dict[str, deque] = defaultdict(deque)


def _baca_matriks() -> dict[str, list[str]]:
    try:
        data = json.loads(pengaturan.BERKAS_PERAN.read_text())
        if isinstance(data, dict):
            return {p: [h for h in data.get(p, []) if h in SEMUA_HAK] for p in PERAN}
    except (OSError, ValueError):
        pass
    return {p: list(h) for p, h in HAK_BAWAAN.items()}


def matriks() -> dict[str, list[str]]:
    m = _baca_matriks()
    m[PERAN_PENUH] = list(SEMUA_HAK)
    return m


def tulis_matriks(m: dict[str, list[str]]) -> None:
    pengaturan.BERKAS_PERAN.parent.mkdir(parents=True, exist_ok=True)
    tmp = pengaturan.BERKAS_PERAN.with_suffix(".tmp")
    tmp.write_text(json.dumps({p: [h for h in SEMUA_HAK if h in m.get(p, [])] for p in PERAN}, indent=1))
    os.replace(tmp, pengaturan.BERKAS_PERAN)


def atur_hak(peran: str, hak: str, aktif: bool) -> list[str]:
    if peran not in PERAN:
        raise GalatAkun("Peran tidak dikenal.")
    if hak not in SEMUA_HAK:
        raise GalatAkun("Hak tidak dikenal.")
    if peran == PERAN_PENUH:
        raise GalatAkun("Peran Admin selalu punya semua hak.")
    with _kunci_berkas:
        m = _baca_matriks()
        hs = set(m.get(peran, []))
        (hs.add if aktif else hs.discard)(hak)
        m[peran] = [h for h in SEMUA_HAK if h in hs]
        tulis_matriks(m)
        return m[peran]


def hak_peran(peran: str) -> list[str]:
    return list(matriks().get(peran, []))


def boleh(peran: str | None, hak: str) -> bool:
    return bool(peran) and hak in matriks().get(peran, [])


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
             "terakhirMasuk": a.get("terakhir_masuk"), "demo": bool(a.get("demo"))} for n, a in sorted(_baca()["pengguna"].items())]


def adalah_demo(nama: str | None) -> bool:
    return bool(nama) and bool(_baca()["pengguna"].get(nama, {}).get("demo"))


def akun_demo() -> list[dict]:
    """Kredensial akun demo untuk tombol "Masuk sebagai" (urut sesuai PERAN). Hanya akun demo yang aktif dan sandinya
    masih sandi demo (kalau superadmin mengatur ulang sandinya, akun itu hilang dari daftar)."""
    semua = _baca()["pengguna"]
    hasil = []
    for peran in PERAN:
        for n, a in sorted(semua.items()):
            if a.get("demo") and a.get("demo_sandi") and a.get("aktif", True) and a["peran"] == peran:
                hasil.append({"peran": peran, "label": LABEL_PERAN[peran], "pengguna": n, "sandi": a["demo_sandi"]})
                break
    return hasil


class GalatAkun(ValueError):
    pass


def simpan(nama: str, *, sandi: str | None = None, peran: str | None = None, aktif: bool | None = None, baru: bool = False,
           demo: bool = False) -> None:
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
            if demo:
                a["demo"], a["demo_sandi"] = True, sandi
            else:
                a.pop("demo_sandi", None)
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
    if a and a.get("demo"):
        raise GalatAkun("Sandi akun demo tidak bisa diganti.")
    if not a or not cocok_sandi(lama, a["hash"]):
        raise GalatAkun("Sandi lama salah.")
    simpan(nama, sandi=baru)
