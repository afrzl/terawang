"""Uji key sebelum/ sesudah disimpan. Pesan hasil tidak pernah memuat key."""
from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request


def _ambil(url: str, header: dict | None = None) -> tuple[int, bytes]:
    req = urllib.request.Request(url, headers={"User-Agent": "terawang-admin", **(header or {})})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, r.read(200_000)
    except urllib.error.HTTPError as e:
        return e.code, e.read(20_000)


def uji_bps(key: str) -> tuple[bool, str]:
    try:
        kode, isi = _ambil(f"https://webapi.bps.go.id/v1/api/domain/type/prov/key/{urllib.parse.quote(key, safe='')}/")
    except OSError as e:
        return False, f"WebAPI BPS tidak bisa dihubungi ({e.__class__.__name__})."
    try:
        data = json.loads(isi)
    except ValueError:
        return False, f"Jawaban WebAPI BPS tidak terbaca (HTTP {kode})."
    if kode == 200 and data.get("status") == "OK":
        return True, "Key WebAPI BPS sah."
    return False, f"Key ditolak BPS (HTTP {kode}: {str(data.get('message') or data.get('status'))[:120]})."


def uji_openai(key: str) -> tuple[bool, str]:
    try:
        kode, _ = _ambil("https://api.openai.com/v1/models", {"Authorization": f"Bearer {key}"})
    except OSError as e:
        return False, f"API OpenAI tidak bisa dihubungi ({e.__class__.__name__})."
    if kode == 200:
        return True, "API key OpenAI sah."
    if kode == 401:
        return False, "API key OpenAI ditolak (401: salah atau sudah dicabut)."
    if kode == 429:
        return False, "Key dikenali tapi kena batas/kuota (429). Cek saldo di platform.openai.com."
    return False, f"OpenAI menjawab HTTP {kode}."


PENGUJI = {"bps": uji_bps, "openai": uji_openai}
