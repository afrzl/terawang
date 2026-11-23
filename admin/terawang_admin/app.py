"""Layanan admin TERAWANG (Starlette). Disajikan Traefik di https://terawang.tech/admin.

Jalankan lewat deploy/deploy-admin.sh (uvicorn, bind ke IP bridge Docker port 3071).
"""
from __future__ import annotations

import functools
import tempfile
from pathlib import Path

from starlette.applications import Starlette
from starlette.concurrency import run_in_threadpool
from starlette.middleware import Middleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import FileResponse, JSONResponse, RedirectResponse, Response
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles

from . import akun, dagster, envfile, jejak, pengaturan, sumber, uji

STATIC = Path(__file__).parent / "static"
HEADER_CSRF = "x-terawang-admin"


def ip_klien(req: Request) -> str:
    # Traefik mengisi X-Real-Ip; layanan hanya mendengar di IP bridge Docker sehingga header ini dari Traefik.
    return req.headers.get("x-real-ip") or (req.client.host if req.client else "?")


def galat(pesan: str, kode: int = 400) -> JSONResponse:
    return JSONResponse({"galat": pesan}, status_code=kode)


def perlu_login(fn):
    @functools.wraps(fn)
    async def bungkus(req: Request):
        pengguna = akun.periksa_token(req.cookies.get(akun.NAMA_COOKIE))
        if not pengguna:
            return galat("Sesi habis atau belum login.", 401)
        if req.method not in ("GET", "HEAD") and req.headers.get(HEADER_CSRF) != "1":
            return galat("Permintaan ditolak (header CSRF).", 403)
        req.state.pengguna = pengguna
        try:
            return await fn(req)
        except dagster.GalatDagster as e:
            return galat(str(e), 502)
        except sumber.GagalUnggah as e:
            return galat(str(e), 400)
    return bungkus


# ---------- akun ----------

async def masuk(req: Request):
    ip = ip_klien(req)
    if req.headers.get(HEADER_CSRF) != "1":
        return galat("Permintaan ditolak (header CSRF).", 403)
    if not akun.baca_akun():
        return galat("Akun admin belum dibuat. Jalankan `python -m terawang_admin.sandi` di server.", 503)
    sisa = akun.terkunci(ip)
    if sisa:
        return galat(f"Terlalu banyak percobaan gagal. Coba lagi {sisa // 60 + 1} menit lagi.", 429)
    try:
        data = await req.json()
    except ValueError:
        return galat("Format salah.")
    a = await run_in_threadpool(akun.login, str(data.get("pengguna", ""))[:100], str(data.get("sandi", ""))[:200])
    if not a:
        akun.catat_gagal(ip)
        jejak.catat("login_gagal", str(data.get("pengguna", ""))[:100], ip)
        return galat("Nama pengguna atau sandi salah.", 401)
    akun.bersihkan_gagal(ip)
    jejak.catat("login", a["pengguna"], ip)
    resp = JSONResponse({"pengguna": a["pengguna"]})
    resp.set_cookie(akun.NAMA_COOKIE, akun.buat_token(a), max_age=akun.UMUR_SESI, path="/admin", httponly=True,
                    secure=pengaturan.COOKIE_SECURE, samesite="strict")
    return resp


async def keluar(req: Request):
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(akun.NAMA_COOKIE, path="/admin")
    return resp


@perlu_login
async def saya(req: Request):
    return JSONResponse({"pengguna": req.state.pengguna})


# ---------- pipeline ----------

@perlu_login
async def pipeline(req: Request):
    data = await run_in_threadpool(dagster.ringkasan)
    for a in data["aset"]:
        a["sumberManual"] = sumber.ASET_KE_SUMBER.get(a["nama"])
    return JSONResponse(data)


@perlu_login
async def log_run(req: Request):
    run_id = req.path_params["run_id"]
    if not all(c.isalnum() or c == "-" for c in run_id) or len(run_id) > 64:
        return galat("ID run tidak sah.")
    return JSONResponse(await run_in_threadpool(dagster.log_run, run_id))


@perlu_login
async def luncurkan(req: Request):
    job = (await req.json()).get("job", "")
    pesan = await run_in_threadpool(dagster.luncurkan, job, req.state.pengguna)
    jejak.catat("jalankan_job", req.state.pengguna, ip_klien(req), job=job)
    return JSONResponse({"pesan": pesan})


# ---------- konfigurasi ----------

def _berkas_env(nama: str) -> Path:
    if nama not in pengaturan.BERKAS_ENV:
        raise sumber.GagalUnggah("Berkas konfigurasi tidak dikenal.")
    return pengaturan.BERKAS_ENV[nama]


@perlu_login
async def konfigurasi(req: Request):
    hasil = []
    for nama, path in pengaturan.BERKAS_ENV.items():
        hasil.append({"berkas": nama, "path": str(path).replace(str(Path.home()), "~"), "ada": path.exists(),
                      "variabel": envfile.ringkas(nama, path) if path.exists() else []})
    return JSONResponse({"berkas": hasil})


@perlu_login
async def ubah_konfigurasi(req: Request):
    data = await req.json()
    nama, kunci, hapus = str(data.get("berkas", "")), str(data.get("kunci", "")), bool(data.get("hapus"))
    nilai = None if hapus else str(data.get("nilai", ""))
    path = _berkas_env(nama)
    if not path.exists():
        return galat(f"{path} belum ada di server.")
    if not hapus:
        salah = envfile.periksa(nama, kunci, nilai)
        if salah:
            return galat(salah)
    elif not envfile.KUNCI_SAH.match(kunci):
        return galat("Nama variabel tidak sah.")
    await run_in_threadpool(envfile.tulis, path, kunci, nilai)
    # jejak tanpa nilai secret
    rinci = {"berkas": nama, "kunci": kunci, "hapus": hapus}
    if not hapus and not envfile.secret(nama, kunci):
        rinci["nilai"] = nilai
    jejak.catat("ubah_konfigurasi", req.state.pengguna, ip_klien(req), **rinci)
    perlu = "Muat ulang Dagster" if nama == "pipeline" else "Nyalakan ulang bot"
    return JSONResponse({"pesan": f"{kunci} tersimpan. Klik '{perlu}' supaya nilai baru dipakai.", "perluMuatUlang": nama})


@perlu_login
async def uji_konfigurasi(req: Request):
    data = await req.json()
    nama, kunci = str(data.get("berkas", "")), str(data.get("kunci", ""))
    info = envfile.DIKENAL.get(nama, {}).get(kunci, {})
    penguji = uji.PENGUJI.get(info.get("uji", ""))
    if not penguji:
        return galat("Variabel ini tidak bisa diuji.")
    nilai = str(data.get("nilai") or "") or envfile.baca(_berkas_env(nama)).get(kunci, "")
    if not nilai:
        return galat("Nilai kosong.")
    ok, pesan = await run_in_threadpool(penguji, nilai)
    jejak.catat("uji_konfigurasi", req.state.pengguna, ip_klien(req), berkas=nama, kunci=kunci, hasil=ok)
    return JSONResponse({"ok": ok, "pesan": pesan})


@perlu_login
async def muat_ulang(req: Request):
    target = req.path_params["target"]
    if target == "pipeline":
        pesan = await run_in_threadpool(dagster.mulai_ulang_pipeline)
    elif target == "bot":
        pesan = await run_in_threadpool(dagster.mulai_ulang_bot)
    else:
        return galat("Target tidak dikenal.")
    jejak.catat("muat_ulang", req.state.pengguna, ip_klien(req), target=target)
    return JSONResponse({"pesan": pesan})


# ---------- unggah manual ----------

@perlu_login
async def daftar_sumber(req: Request):
    data = await run_in_threadpool(sumber.daftar)
    env = envfile.baca(pengaturan.BERKAS_ENV["pipeline"]) if "pipeline" in pengaturan.BERKAS_ENV else {}
    for s in data:
        s["mode"] = env.get(s["env"]) if s["env"] else None
    return JSONResponse({"sumber": data, "folder": str(pengaturan.MANUAL_DIR).replace(str(Path.home()), "~")})


@perlu_login
async def unggah(req: Request):
    s, nama = req.path_params["sumber"], req.path_params["nama"]
    sumber.periksa_nama(s, nama)
    tmpdir = pengaturan.MANUAL_DIR / ".sementara"
    tmpdir.mkdir(parents=True, exist_ok=True)
    total = 0
    with tempfile.NamedTemporaryFile(dir=tmpdir, delete=False) as f:
        tmp = Path(f.name)
        try:
            async for potong in req.stream():
                total += len(potong)
                if total > pengaturan.UKURAN_MAKS_UNGGAH:
                    raise sumber.GagalUnggah(f"Berkas lebih dari {pengaturan.UKURAN_MAKS_UNGGAH // 2**20} MB.")
                f.write(potong)
        except BaseException:
            tmp.unlink(missing_ok=True)
            raise
    try:
        catatan = req.query_params.get("catatan", "")
        baris = await run_in_threadpool(sumber.simpan, s, nama, tmp, req.state.pengguna, ip_klien(req), catatan)
    finally:
        tmp.unlink(missing_ok=True)
    jejak.catat("unggah_manual", req.state.pengguna, ip_klien(req), sumber=s, nama=nama, ukuran=baris["ukuran"], baris=baris["baris"])
    return JSONResponse({"pesan": f"{nama} tersimpan ({baris['baris']} baris).", "log": baris})


@perlu_login
async def tarik(req: Request):
    s, nama = req.path_params["sumber"], req.path_params["nama"]
    await run_in_threadpool(sumber.arsipkan, s, nama, req.state.pengguna, ip_klien(req))
    jejak.catat("tarik_unggahan", req.state.pengguna, ip_klien(req), sumber=s, nama=nama)
    return JSONResponse({"pesan": f"{nama} dipindah ke arsip; aset kembali memakai sumber otomatis/berkas repo."})


@perlu_login
async def templat(req: Request):
    s, nama = req.path_params["sumber"], req.path_params["nama"]
    isi = await run_in_threadpool(sumber.contoh, s, nama)
    unduh = nama[:-3] if nama.endswith(".gz") else nama
    return Response(isi, media_type="text/csv; charset=utf-8", headers={"Content-Disposition": f'attachment; filename="contoh_{unduh}"'})


@perlu_login
async def lihat_jejak(req: Request):
    return JSONResponse({"jejak": await run_in_threadpool(jejak.baca, 300)})


# ---------- halaman ----------

async def halaman(req: Request):
    return FileResponse(STATIC / "index.html", headers={"Cache-Control": "no-cache"})


async def ke_garis_miring(req: Request):
    return RedirectResponse("/admin/", status_code=308)


class HeaderKeamanan(BaseHTTPMiddleware):
    async def dispatch(self, req, call_next):
        resp = await call_next(req)
        resp.headers.setdefault("X-Content-Type-Options", "nosniff")
        resp.headers.setdefault("X-Frame-Options", "DENY")
        resp.headers.setdefault("Referrer-Policy", "same-origin")
        resp.headers.setdefault("X-Robots-Tag", "noindex, nofollow")
        resp.headers.setdefault("Content-Security-Policy",
                                "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; "
                                "font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; "
                                "frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        if req.url.path.startswith("/admin/api/"):
            resp.headers["Cache-Control"] = "no-store"
        return resp


API = "/admin/api"
routes = [
    Route("/admin", ke_garis_miring),
    Route("/admin/", halaman),
    Route(f"{API}/masuk", masuk, methods=["POST"]),
    Route(f"{API}/keluar", keluar, methods=["POST"]),
    Route(f"{API}/saya", saya),
    Route(f"{API}/pipeline", pipeline),
    Route(f"{API}/run/{{run_id}}/log", log_run),
    Route(f"{API}/jalankan", luncurkan, methods=["POST"]),
    Route(f"{API}/konfigurasi", konfigurasi),
    Route(f"{API}/konfigurasi", ubah_konfigurasi, methods=["PUT"]),
    Route(f"{API}/konfigurasi/uji", uji_konfigurasi, methods=["POST"]),
    Route(f"{API}/muat-ulang/{{target}}", muat_ulang, methods=["POST"]),
    Route(f"{API}/sumber", daftar_sumber),
    Route(f"{API}/sumber/{{sumber}}/{{nama}}", unggah, methods=["PUT"]),
    Route(f"{API}/sumber/{{sumber}}/{{nama}}", tarik, methods=["DELETE"]),
    Route(f"{API}/sumber/{{sumber}}/{{nama}}/contoh", templat),
    Route(f"{API}/jejak", lihat_jejak),
    Mount("/admin/static", StaticFiles(directory=STATIC), name="static"),
]

app = Starlette(routes=routes, middleware=[Middleware(HeaderKeamanan)])
