"""Pemantauan dan pengendalian GoWA (go-whatsapp-web-multidevice v9) serta bot WhatsApp dari halaman admin.

Satu device saja yang dipakai bot TERAWANG. Device lain ditandai "lebih" supaya bisa dilepas.
Kredensial (basic auth GoWA, token API bot) dibaca dari .env bot, tidak pernah dikirim ke peramban.
"""
from __future__ import annotations

import base64
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request

from . import envfile, pengaturan


class GalatWa(RuntimeError):
    pass


def _env_bot() -> dict[str, str]:
    path = pengaturan.BERKAS_ENV.get("bot")
    return envfile.baca(path) if path and path.exists() else {}


def _minta(url: str, metode: str = "GET", header: dict | None = None, body: dict | None = None, batas: int = 2_000_000,
           waktu: float = 10) -> tuple[int, bytes, str]:
    data = json.dumps(body).encode() if body is not None else None
    h = {"User-Agent": "terawang-admin", **(header or {})}
    if data is not None:
        h["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=metode, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=waktu) as r:
            return r.status, r.read(batas), r.headers.get("Content-Type", "")
    except urllib.error.HTTPError as e:
        return e.code, e.read(50_000), e.headers.get("Content-Type", "") if e.headers else ""


def _gowa(path: str, metode: str = "GET", body: dict | None = None, device: str | None = None) -> dict:
    env = _env_bot()
    h = {}
    if env.get("GOWA_BASIC_AUTH"):
        h["Authorization"] = "Basic " + base64.b64encode(env["GOWA_BASIC_AUTH"].encode()).decode()
    if device:
        h["X-Device-Id"] = device
    try:
        kode, isi, _ = _minta(pengaturan.GOWA_URL + path, metode, h, body)
    except OSError as e:
        raise GalatWa(f"GoWA tidak bisa dihubungi di {pengaturan.GOWA_URL} ({e.__class__.__name__}).") from e
    try:
        d = json.loads(isi or b"{}")
    except ValueError:
        d = {}
    if kode == 401:
        raise GalatWa("GoWA menolak login (basic auth). Cek GOWA_BASIC_AUTH di .env bot.")
    if kode >= 400:
        raise GalatWa(f"GoWA {kode}: {str(d.get('message') or isi[:200])}")
    return d


def _bot(path: str, metode: str = "GET", body: dict | None = None, waktu: float = 10) -> dict | None:
    token = _env_bot().get("BOT_API_TOKEN", "")
    if not token:
        return {"_galat": "BOT_API_TOKEN belum diisi di .env bot, jadi status bot tidak bisa dibaca."}
    try:
        kode, isi, _ = _minta(pengaturan.BOT_URL + path, metode, {"Authorization": f"Bearer {token}"}, body, waktu=waktu)
    except OSError as e:
        return {"_galat": f"Bot tidak bisa dihubungi di {pengaturan.BOT_URL} ({e.__class__.__name__}). Container terawang-bot mati?"}
    try:
        d = json.loads(isi or b"{}")
    except ValueError:
        d = {}
    if kode >= 400:
        return {"_galat": f"Bot menjawab HTTP {kode}." + (" Token API tidak cocok." if kode == 401 else "")}
    return d


def id_device_bot() -> str:
    return _env_bot().get("GOWA_DEVICE_ID") or pengaturan.BOT_DEVICE_BAWAAN


def samarkan_nomor(n: str | None) -> str:
    d = re.sub(r"\D", "", n or "")
    return f"{d[:5]}…{d[-3:]}" if len(d) > 8 else (d or "")


def status() -> dict:
    hasil: dict = {"gowaUrl": pengaturan.GOWA_URL, "waktu": time.time()}
    # GoWA
    try:
        info = _gowa("/app/info").get("results") or {}
        daftar = _gowa("/devices").get("results") or []
        hasil["gowa"] = {"ok": True, "versi": info.get("version"), "os": info.get("os")}
    except GalatWa as e:
        hasil["gowa"] = {"ok": False, "galat": str(e)}
        daftar = []
    id_bot = id_device_bot()
    # Bila id bawaan belum ada tetapi hanya ada satu device, itulah device bot (pasangan lama dari dasbor GoWA).
    ids = [d.get("id") for d in daftar]
    if id_bot not in ids and len(daftar) == 1 and not _env_bot().get("GOWA_DEVICE_ID"):
        id_bot = daftar[0].get("id")
    perangkat = []
    for d in daftar:
        p = {"id": d.get("id"), "nama": d.get("display_name") or "", "nomor": samarkan_nomor(d.get("phone_number") or (d.get("jid") or "").split("@")[0]),
             "state": d.get("state") or "disconnected", "dibuat": d.get("created_at"), "bot": d.get("id") == id_bot}
        if p["bot"]:
            try:
                st = _gowa(f"/devices/{urllib.parse.quote(p['id'], safe='')}/status").get("results") or {}
                p["terhubung"], p["login"] = bool(st.get("is_connected")), bool(st.get("is_logged_in"))
            except GalatWa as e:
                p["galatStatus"] = str(e)
        perangkat.append(p)
    hasil["perangkat"] = perangkat
    hasil["idBot"] = id_bot
    hasil["adaBot"] = any(p["bot"] for p in perangkat)
    # Bot
    b = _bot("/api/status")
    hasil["bot"] = b if b and "_galat" not in b else {"ok": False, "galat": (b or {}).get("_galat", "Bot tidak menjawab.")}
    env = _env_bot()
    hasil["config"] = {"webhookSecret": bool(env.get("WHATSAPP_WEBHOOK_SECRET")), "openaiKey": bool(env.get("OPENAI_API_KEY")),
                       "model": env.get("OPENAI_MODEL") or "gpt-5-mini", "deviceIdEnv": env.get("GOWA_DEVICE_ID") or ""}
    return hasil


def _wajib_bot(device: str) -> None:
    if device != status_ringan_id():
        raise GalatWa("Aksi ini hanya untuk device bot TERAWANG.")


def status_ringan_id() -> str:
    id_bot = id_device_bot()
    if _env_bot().get("GOWA_DEVICE_ID"):
        return id_bot
    daftar = _gowa("/devices").get("results") or []
    ids = [d.get("id") for d in daftar]
    return daftar[0].get("id") if id_bot not in ids and len(daftar) == 1 else id_bot


def buat_device() -> str:
    daftar = _gowa("/devices").get("results") or []
    if daftar:
        raise GalatWa("Sudah ada device. Bot TERAWANG hanya memakai satu device; lepas device lain dulu.")
    id_bot = id_device_bot()
    _gowa("/devices", "POST", {"device_id": id_bot})
    return id_bot


def _ambil_qr(link: str) -> str:
    """qr_link dari GoWA memakai host internalnya; ambil gambarnya lewat GOWA_URL dan kirim sebagai data URL."""
    path = urllib.parse.urlparse(link).path
    env = _env_bot()
    h = {"Authorization": "Basic " + base64.b64encode(env.get("GOWA_BASIC_AUTH", "").encode()).decode()} if env.get("GOWA_BASIC_AUTH") else {}
    kode, isi, jenis = _minta(pengaturan.GOWA_URL + path, header=h, batas=2_000_000)
    if kode != 200 or not isi:
        raise GalatWa(f"Gambar QR tidak bisa diambil dari GoWA (HTTP {kode}).")
    return f"data:{jenis or 'image/png'};base64," + base64.b64encode(isi).decode()


def login_qr(device: str) -> dict:
    _wajib_bot(device)
    r = _gowa(f"/devices/{urllib.parse.quote(device, safe='')}/login").get("results") or {}
    if not r.get("qr_link"):
        raise GalatWa("GoWA tidak memberi QR. Mungkin device sudah login.")
    return {"qr": _ambil_qr(r["qr_link"]), "durasi": int(r.get("qr_duration") or 30)}


def login_kode(device: str, nomor: str) -> dict:
    _wajib_bot(device)
    nomor = re.sub(r"\D", "", nomor)
    if nomor.startswith("0"):
        nomor = "62" + nomor[1:]
    if not re.fullmatch(r"62\d{8,13}", nomor):
        raise GalatWa("Nomor harus format 628xxxxxxxxx.")
    r = _gowa(f"/devices/{urllib.parse.quote(device, safe='')}/login/code?phone={nomor}", "POST").get("results") or {}
    if not r.get("pair_code"):
        raise GalatWa("GoWA tidak memberi kode pairing.")
    return {"kode": r["pair_code"]}


def aksi_device(device: str, aksi: str) -> str:
    q = urllib.parse.quote(device, safe="")
    if aksi == "reconnect":
        _wajib_bot(device)
        _gowa(f"/devices/{q}/reconnect", "POST")
        return "Device bot disambungkan ulang."
    if aksi == "logout":
        _wajib_bot(device)
        _gowa(f"/devices/{q}/logout", "POST")
        return "Device bot keluar dari WhatsApp. Hubungkan lagi dengan QR atau kode pairing."
    if aksi == "lepas":
        if device == status_ringan_id():
            raise GalatWa("Device bot tidak bisa dilepas dari sini. Pakai Keluar kalau ingin mengganti nomor.")
        _gowa(f"/devices/{q}", "DELETE")
        return f"Device {device} dilepas dari GoWA."
    raise GalatWa("Aksi tidak dikenal.")


def uji_alur(teks: str) -> dict:
    teks = (teks or "").strip()[:300]
    if not teks:
        raise GalatWa("Isi pertanyaan uji dulu.")
    t0 = time.time()
    r = _bot("/api/tanya", "POST", {"teks": teks, "sesi": "admin"}, waktu=60)
    if not r or "_galat" in r:
        raise GalatWa((r or {}).get("_galat", "Bot tidak menjawab."))
    return {"teks": r.get("teks"), "intent": r.get("intent"), "detik": round(time.time() - t0, 1)}
