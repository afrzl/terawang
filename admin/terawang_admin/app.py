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
from starlette.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse, Response
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles

from . import akun, dagster, data, envfile, jejak, laporan, pengaturan, sumber, uji, whatsapp

STATIC = Path(__file__).parent / "static"
HEADER_CSRF = "x-terawang-admin"


def ip_klien(req: Request) -> str:
    # Traefik mengisi X-Real-Ip; layanan hanya mendengar di IP bridge Docker sehingga header ini dari Traefik.
    return req.headers.get("x-real-ip") or (req.client.host if req.client else "?")


def galat(pesan: str, kode: int = 400) -> JSONResponse:
    return JSONResponse({"galat": pesan}, status_code=kode)


def perlu_login(hak: str | None = None, demo_boleh_tulis: bool | None = None):
    """Wajib login; kalau `hak` diisi, peran pengguna harus punya hak itu (matriks akun.matriks()).
    Akun demo tidak boleh menulis di bagian akun.HAK_TULIS_TERLARANG_DEMO kecuali `demo_boleh_tulis`."""
    if demo_boleh_tulis is None:
        demo_boleh_tulis = hak not in akun.HAK_TULIS_TERLARANG_DEMO
    def hias(fn):
        @functools.wraps(fn)
        async def bungkus(req: Request):
            sesi = akun.periksa_token(req.cookies.get(akun.NAMA_COOKIE))
            if not sesi:
                return galat("Sesi habis atau belum login.", 401)
            if req.method not in ("GET", "HEAD") and req.headers.get(HEADER_CSRF) != "1":
                return galat("Permintaan ditolak (header CSRF).", 403)
            req.state.pengguna, req.state.peran = sesi
            if hak and not akun.boleh(req.state.peran, hak):
                return galat("Peran akun ini tidak punya akses ke bagian ini.", 403)
            if not demo_boleh_tulis and req.method not in ("GET", "HEAD") and akun.adalah_demo(req.state.pengguna):
                return galat("Akun demo hanya bisa melihat bagian ini.", 403)
            try:
                return await fn(req)
            except dagster.GalatDagster as e:
                return galat(str(e), 502)
            except whatsapp.GalatWa as e:
                return galat(str(e), 502)
            except (sumber.GagalUnggah, akun.GalatAkun, data.GagalData, laporan.GagalLaporan) as e:
                return galat(str(e), 400)
        return bungkus
    return hias


def _info_sesi(nama: str, peran: str) -> dict:
    return {"pengguna": nama, "peran": peran, "labelPeran": akun.LABEL_PERAN.get(peran, peran), "hak": akun.hak_peran(peran),
            "demo": akun.adalah_demo(nama)}


# ---------- akun ----------

async def masuk(req: Request):
    ip = ip_klien(req)
    if req.headers.get(HEADER_CSRF) != "1":
        return galat("Permintaan ditolak (header CSRF).", 403)
    if not akun.ada_akun():
        return galat("Belum ada akun. Jalankan `python -m terawang_admin.seeder` di server.", 503)
    sisa = akun.terkunci(ip)
    if sisa:
        return galat(f"Terlalu banyak percobaan gagal. Coba lagi {sisa // 60 + 1} menit lagi.", 429)
    try:
        data = await req.json()
    except ValueError:
        return galat("Format salah.")
    hasil = await run_in_threadpool(akun.login, str(data.get("pengguna", ""))[:100], str(data.get("sandi", ""))[:200])
    if not hasil:
        akun.catat_gagal(ip)
        jejak.catat("login_gagal", str(data.get("pengguna", ""))[:100], ip)
        return galat("Nama pengguna atau sandi salah.", 401)
    nama, peran = hasil
    akun.bersihkan_gagal(ip)
    jejak.catat("login", nama, ip, peran=peran)
    resp = JSONResponse(_info_sesi(nama, peran))
    # Path=/ supaya dasbor (terawang.tech/...) juga tahu peran pengguna lewat /admin/api/saya
    resp.set_cookie(akun.NAMA_COOKIE, akun.buat_token(nama), max_age=akun.UMUR_SESI, path="/", httponly=True,
                    secure=pengaturan.COOKIE_SECURE, samesite="strict")
    return resp


async def keluar(req: Request):
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(akun.NAMA_COOKIE, path="/")
    resp.delete_cookie("tw_admin", path="/admin")  # cookie versi pertama
    return resp


async def saya(req: Request):
    """Dipakai dasbor dan halaman admin. Tanpa login: pengguna null tanpa hak (200, bukan 401; dasbor lalu membuka halaman masuk)."""
    sesi = akun.periksa_token(req.cookies.get(akun.NAMA_COOKIE))
    if not sesi:
        return JSONResponse({"pengguna": None, "peran": None, "labelPeran": "Belum masuk", "hak": []})
    return JSONResponse(_info_sesi(*sesi))


async def demo(req: Request):
    """Akun demo untuk tombol "Masuk sebagai" (mengisi otomatis nama & sandi). Kosong bila TERAWANG_DEMO_LOGIN=0."""
    if not pengaturan.DEMO_LOGIN:
        return JSONResponse({"akun": []})
    return JSONResponse({"akun": await run_in_threadpool(akun.akun_demo)})


@perlu_login()
async def ganti_sandi(req: Request):
    data = await req.json()
    await run_in_threadpool(akun.ganti_sandi_sendiri, req.state.pengguna, str(data.get("lama", "")), str(data.get("baru", "")))
    jejak.catat("ganti_sandi", req.state.pengguna, ip_klien(req))
    resp = JSONResponse({"pesan": "Sandi diganti. Silakan masuk lagi."})
    resp.delete_cookie(akun.NAMA_COOKIE, path="/")
    return resp


# ---------- akun (superadmin) ----------

@perlu_login("akun")
async def daftar_akun(req: Request):
    m = await run_in_threadpool(akun.matriks)
    return JSONResponse({"akun": await run_in_threadpool(akun.daftar),
                         "peran": [{"id": p, "label": akun.LABEL_PERAN[p], "hak": m[p], "penuh": p == akun.PERAN_PENUH} for p in akun.PERAN],
                         "fitur": [{"id": i, "label": l, "grup": g} for i, l, g in akun.FITUR]})


@perlu_login("akun", demo_boleh_tulis=True)
async def ubah_hak(req: Request):
    """Centang/hapus centang satu hak untuk satu peran. Berlaku langsung untuk semua sesi peran itu."""
    d = await req.json()
    peran, hak, aktif = str(d.get("peran", "")), str(d.get("hak", "")), bool(d.get("aktif"))
    hasil = await run_in_threadpool(akun.atur_hak, peran, hak, aktif)
    jejak.catat("ubah_hak", req.state.pengguna, ip_klien(req), peran=peran, hak=hak, aktif=aktif)
    label = dict((i, l) for i, l, _ in akun.FITUR)[hak]
    return JSONResponse({"pesan": f"{label} {'diberikan ke' if aktif else 'dicabut dari'} {akun.LABEL_PERAN[peran]}.", "hak": hasil})


@perlu_login("akun")
async def buat_akun(req: Request):
    d = await req.json()
    nama = str(d.get("nama", "")).strip().lower()
    await run_in_threadpool(lambda: akun.simpan(nama, sandi=str(d.get("sandi", "")), peran=str(d.get("peran", "")), baru=True))
    jejak.catat("buat_akun", req.state.pengguna, ip_klien(req), akun=nama, peran=d.get("peran"))
    return JSONResponse({"pesan": f"Akun {nama} dibuat."})


@perlu_login("akun")
async def ubah_akun(req: Request):
    nama = req.path_params["nama"]
    d = await req.json()
    ubah = {k: d[k] for k in ("peran", "aktif") if k in d}
    if d.get("sandi"):
        ubah["sandi"] = str(d["sandi"])
    if not ubah:
        return galat("Tidak ada yang diubah.")
    await run_in_threadpool(lambda: akun.simpan(nama, **ubah))
    jejak.catat("ubah_akun", req.state.pengguna, ip_klien(req), akun=nama, **{k: v for k, v in ubah.items() if k != "sandi"},
                **({"sandi_diatur_ulang": True} if "sandi" in ubah else {}))
    return JSONResponse({"pesan": f"Akun {nama} diperbarui; sesi lamanya sudah keluar."})


@perlu_login("akun")
async def hapus_akun(req: Request):
    nama = req.path_params["nama"]
    if nama == req.state.pengguna:
        return galat("Tidak bisa menghapus akun sendiri.")
    await run_in_threadpool(akun.hapus, nama)
    jejak.catat("hapus_akun", req.state.pengguna, ip_klien(req), akun=nama)
    return JSONResponse({"pesan": f"Akun {nama} dihapus."})


# ---------- pipeline ----------

@perlu_login("pipeline")
async def pipeline(req: Request):
    data = await run_in_threadpool(dagster.ringkasan)
    for a in data["aset"]:
        a["sumberManual"] = sumber.ASET_KE_SUMBER.get(a["nama"])
    return JSONResponse(data)


@perlu_login("pipeline")
async def log_run(req: Request):
    run_id = req.path_params["run_id"]
    if not all(c.isalnum() or c == "-" for c in run_id) or len(run_id) > 64:
        return galat("ID run tidak sah.")
    return JSONResponse(await run_in_threadpool(dagster.log_run, run_id))


@perlu_login("jalankan")
async def luncurkan(req: Request):
    job = (await req.json()).get("job", "")
    pesan = await run_in_threadpool(dagster.luncurkan, job, req.state.pengguna)
    jejak.catat("jalankan_job", req.state.pengguna, ip_klien(req), job=job)
    return JSONResponse({"pesan": pesan})


@perlu_login("pipeline")
async def riwayat(req: Request):
    """Riwayat pembaruan data: materialisasi Dagster (data baru/tidak berubah, sumber yang dipakai, hasil cek konektor),
    kegagalan, unggahan/penarikan manual, dan perubahan konfigurasi sumber. Terbaru dulu."""
    aset_q = req.query_params.get("aset", "")
    grup_q = req.query_params.get("grup", "bronze")
    sumber_q = req.query_params.get("sumber", "")

    def kumpulkan():
        semua = dagster.daftar_aset()
        if sumber_q:
            aset_sumber = next((h["aset"] for h in sumber.halaman() if h["id"] == sumber_q), [])
            pilih = [a["nama"] for a in semua if a["nama"] in aset_sumber]
        elif aset_q:
            pilih = [a["nama"] for a in semua if a["nama"] == aset_q]
        else:
            pilih = [a["nama"] for a in semua if grup_q in ("", "semua") or a["grup"] == grup_q]
        runs = dagster.run_untuk_riwayat()
        kejadian = []
        for nama in pilih[:40]:
            kejadian += dagster.riwayat_aset(nama, 40, runs)
        # unggahan manual
        for sid, info in sumber.SUMBER.items():
            for aset in info["aset"]:
                if aset in pilih:
                    for r in sumber.riwayat(sid, 100):
                        kejadian.append({"waktu": r["waktu"], "aset": aset, "jenis": "tarik" if r.get("tindakan") == "tarik" else "unggah",
                                         "pemicu": r.get("pengguna"), "nama": r.get("nama"), "baris": r.get("baris"), "ukuran": r.get("ukuran"),
                                         "catatan": r.get("catatan")})
        # perubahan konfigurasi sumber (tanpa nilai secret; jejak memang tidak menyimpannya)
        env_ke_aset = {info["env"]: a for info in sumber.SUMBER.values() if info["env"] for a in info["aset"]}
        env_ke_aset.update({"BPS_WEBAPI_KEY": "bronze_bps", "TERAWANG_SUMBER_CITRA": "bronze_citra", "GEE_PROJECT": "bronze_citra"})
        if "bronze_citra" not in pilih and "bronze_titik_satelit" in pilih:
            env_ke_aset.update({"TERAWANG_SUMBER_CITRA": "bronze_titik_satelit", "GEE_PROJECT": "bronze_titik_satelit"})
        for j in jejak.baca(2000):
            if j.get("tindakan") == "ubah_konfigurasi" and j.get("berkas") == "pipeline" and env_ke_aset.get(j.get("kunci")) in pilih:
                kejadian.append({"waktu": j["waktu"], "aset": env_ke_aset[j["kunci"]], "jenis": "konfigurasi", "pemicu": j.get("pengguna"),
                                 "kunci": j.get("kunci"), "nilai": j.get("nilai"), "hapus": j.get("hapus")})
        kejadian.sort(key=lambda k: k["waktu"] or 0, reverse=True)
        return {"kejadian": kejadian[:500], "aset": semua, "dipilih": pilih}

    return JSONResponse(await run_in_threadpool(kumpulkan))


# ---------- konfigurasi ----------

def _berkas_env(nama: str) -> Path:
    if nama not in pengaturan.BERKAS_ENV:
        raise sumber.GagalUnggah("Berkas konfigurasi tidak dikenal.")
    return pengaturan.BERKAS_ENV[nama]


@perlu_login("konfigurasi")
async def konfigurasi(req: Request):
    hasil = []
    for nama, path in pengaturan.BERKAS_ENV.items():
        hasil.append({"berkas": nama, "path": str(path).replace(str(Path.home()), "~"), "ada": path.exists(),
                      "variabel": envfile.ringkas(nama, path) if path.exists() else []})
    return JSONResponse({"berkas": hasil})


@perlu_login("konfigurasi")
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


@perlu_login("konfigurasi")
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


@perlu_login("konfigurasi")
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

@perlu_login("unggah")
async def daftar_sumber(req: Request):
    data = await run_in_threadpool(sumber.daftar)
    env = envfile.baca(pengaturan.BERKAS_ENV["pipeline"]) if "pipeline" in pengaturan.BERKAS_ENV else {}
    for s in data:
        s["mode"] = env.get(s["env"]) if s["env"] else None
    return JSONResponse({"sumber": data, "folder": str(pengaturan.MANUAL_DIR).replace(str(Path.home()), "~")})


@perlu_login("pipeline")
async def halaman_sumber(req: Request):
    """Daftar sumber data untuk menu samping (satu halaman per sumber) beserta mode sumber saat ini."""
    env = envfile.baca(pengaturan.BERKAS_ENV["pipeline"]) if "pipeline" in pengaturan.BERKAS_ENV else {}
    data = sumber.halaman()
    for h in data:
        h["mode"] = env.get(h["env"]) if h["env"] else None
    return JSONResponse({"sumber": data})


@perlu_login("unggah")
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


@perlu_login("unggah")
async def tarik(req: Request):
    s, nama = req.path_params["sumber"], req.path_params["nama"]
    await run_in_threadpool(sumber.arsipkan, s, nama, req.state.pengguna, ip_klien(req))
    jejak.catat("tarik_unggahan", req.state.pengguna, ip_klien(req), sumber=s, nama=nama)
    return JSONResponse({"pesan": f"{nama} dipindah ke arsip; aset kembali memakai sumber otomatis/berkas repo."})


@perlu_login("unggah")
async def templat(req: Request):
    s, nama = req.path_params["sumber"], req.path_params["nama"]
    isi = await run_in_threadpool(sumber.contoh, s, nama)
    unduh = nama[:-3] if nama.endswith(".gz") else nama
    return Response(isi, media_type="text/csv; charset=utf-8", headers={"Content-Disposition": f'attachment; filename="contoh_{unduh}"'})


def _indeks(req: Request) -> int:
    try:
        return int(req.query_params.get("i", ""))
    except ValueError:
        raise data.GagalData("Indeks berkas tidak sah.")


@perlu_login("pipeline")
async def data_terkini(req: Request):
    """Berkas yang dipakai materialisasi terakhir aset sumber ini (hasil konektor otomatis, unggahan manual, atau CSV repo)."""
    d = await run_in_threadpool(data.daftar, req.query_params.get("sumber", ""))
    return JSONResponse(data.publik(d))


@perlu_login("pipeline")
async def data_pratinjau(req: Request):
    try:
        n = int(req.query_params.get("n", "50"))
    except ValueError:
        n = 50
    urut = "awal" if req.query_params.get("urut") == "awal" else "terbaru"
    return JSONResponse(await run_in_threadpool(data.pratinjau, req.query_params.get("sumber", ""), _indeks(req), n, urut))


@perlu_login("pipeline")
async def data_unduh(req: Request):
    p = await run_in_threadpool(data.path_unduh, req.query_params.get("sumber", ""), _indeks(req))
    jenis = "application/gzip" if p.name.endswith(".gz") else "application/json" if p.name.endswith(".json") else "text/csv; charset=utf-8"
    return FileResponse(p, media_type=jenis, filename=p.name, headers={"Cache-Control": "no-store"})


@perlu_login("jejak")
async def lihat_jejak(req: Request):
    return JSONResponse({"jejak": await run_in_threadpool(jejak.baca, 300)})


# ---------- WhatsApp (GoWA + bot) ----------

@perlu_login("whatsapp")
async def wa_status(req: Request):
    return JSONResponse(await run_in_threadpool(whatsapp.status))


@perlu_login("whatsapp", demo_boleh_tulis=True)
async def wa_aksi(req: Request):
    aksi = req.path_params["aksi"]
    if aksi != "uji" and akun.adalah_demo(req.state.pengguna):
        return galat("Akun demo hanya bisa melihat status dan menguji bot.", 403)
    try:
        data = await req.json()
    except ValueError:
        data = {}
    device = str(data.get("device") or "")[:80]
    ip = ip_klien(req)
    if aksi == "buat":
        d = await run_in_threadpool(whatsapp.buat_device)
        jejak.catat("wa_buat_device", req.state.pengguna, ip, device=d)
        return JSONResponse({"pesan": f"Device {d} dibuat. Lanjutkan dengan QR atau kode pairing.", "device": d})
    if aksi == "qr":
        r = await run_in_threadpool(whatsapp.login_qr, device)
        jejak.catat("wa_login", req.state.pengguna, ip, device=device, cara="qr")
        return JSONResponse(r)
    if aksi == "kode":
        r = await run_in_threadpool(whatsapp.login_kode, device, str(data.get("nomor") or ""))
        jejak.catat("wa_login", req.state.pengguna, ip, device=device, cara="kode")
        return JSONResponse(r)
    if aksi in ("reconnect", "logout", "lepas"):
        pesan = await run_in_threadpool(whatsapp.aksi_device, device, aksi)
        jejak.catat("wa_" + aksi, req.state.pengguna, ip, device=device)
        return JSONResponse({"pesan": pesan})
    if aksi == "uji":
        r = await run_in_threadpool(whatsapp.uji_alur, str(data.get("teks") or ""))
        jejak.catat("wa_uji_alur", req.state.pengguna, ip, intent=r.get("intent"))
        return JSONResponse(r)
    return galat("Aksi tidak dikenal.")


# ---------- laporan harga warga ----------

@perlu_login("laporan")
async def daftar_laporan(req: Request):
    status = req.query_params.get("status") or None
    peran = req.query_params.get("peran") or None
    return JSONResponse(await run_in_threadpool(laporan.daftar, status, 200, peran))


@perlu_login("laporan")
async def saran_laporan(req: Request):
    return JSONResponse(await run_in_threadpool(laporan.saran_ai))


@perlu_login("laporan")
async def ubah_laporan(req: Request):
    try:
        id_laporan = int(req.path_params["id"])
    except ValueError:
        return galat("ID laporan tidak sah.")
    aksi = req.path_params["aksi"]
    r = await run_in_threadpool(laporan.ubah, id_laporan, aksi)
    jejak.catat("validasi_laporan", req.state.pengguna, ip_klien(req), laporan=r["id"], status=r["status"],
                pasar=r["pasar"], harga=r["harga"])
    pesan = {"VALID": "diterima", "DITOLAK": "ditolak", "MENUNGGU": "dikembalikan ke antrean"}[r["status"]]
    return JSONResponse({"pesan": f"Laporan {r['pasar']} {pesan}.", **r})


# ---------- halaman ----------

def _versi_aset() -> str:
    return str(int(max((STATIC / n).stat().st_mtime for n in ("admin.css", "admin.js", "tema.js"))))


async def halaman(req: Request):
    # ?v= ikut berubah tiap admin.css/admin.js berubah, supaya browser tidak memakai salinan lama.
    v = _versi_aset()
    html = (STATIC / "index.html").read_text(encoding="utf-8")
    html = html.replace("/admin/static/admin.css\"", f"/admin/static/admin.css?v={v}\"")
    html = html.replace("/admin/static/admin.js\"", f"/admin/static/admin.js?v={v}\"")
    html = html.replace("/admin/static/tema.js\"", f"/admin/static/tema.js?v={v}\"")
    return HTMLResponse(html, headers={"Cache-Control": "no-cache"})


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
        elif req.url.path.startswith("/admin/static/"):
            resp.headers["Cache-Control"] = "no-cache"
        return resp


API = "/admin/api"
routes = [
    Route("/admin", ke_garis_miring),
    Route("/admin/", halaman),
    Route(f"{API}/masuk", masuk, methods=["POST"]),
    Route(f"{API}/keluar", keluar, methods=["POST"]),
    Route(f"{API}/saya", saya),
    Route(f"{API}/demo", demo),
    Route(f"{API}/peran", ubah_hak, methods=["PUT"]),
    Route(f"{API}/sandi", ganti_sandi, methods=["POST"]),
    Route(f"{API}/akun", daftar_akun),
    Route(f"{API}/akun", buat_akun, methods=["POST"]),
    Route(f"{API}/akun/{{nama}}", ubah_akun, methods=["PUT"]),
    Route(f"{API}/akun/{{nama}}", hapus_akun, methods=["DELETE"]),
    Route(f"{API}/pipeline", pipeline),
    Route(f"{API}/run/{{run_id}}/log", log_run),
    Route(f"{API}/riwayat", riwayat),
    Route(f"{API}/jalankan", luncurkan, methods=["POST"]),
    Route(f"{API}/konfigurasi", konfigurasi),
    Route(f"{API}/konfigurasi", ubah_konfigurasi, methods=["PUT"]),
    Route(f"{API}/konfigurasi/uji", uji_konfigurasi, methods=["POST"]),
    Route(f"{API}/muat-ulang/{{target}}", muat_ulang, methods=["POST"]),
    Route(f"{API}/sumber", daftar_sumber),
    Route(f"{API}/sumber-data", halaman_sumber),
    Route(f"{API}/data", data_terkini),
    Route(f"{API}/data/pratinjau", data_pratinjau),
    Route(f"{API}/data/unduh", data_unduh),
    Route(f"{API}/sumber/{{sumber}}/{{nama}}", unggah, methods=["PUT"]),
    Route(f"{API}/sumber/{{sumber}}/{{nama}}", tarik, methods=["DELETE"]),
    Route(f"{API}/sumber/{{sumber}}/{{nama}}/contoh", templat),
    Route(f"{API}/jejak", lihat_jejak),
    Route(f"{API}/laporan", daftar_laporan),
    Route(f"{API}/laporan/saran", saran_laporan),
    Route(f"{API}/laporan/{{id}}/{{aksi}}", ubah_laporan, methods=["POST"]),
    Route(f"{API}/wa", wa_status),
    Route(f"{API}/wa/{{aksi}}", wa_aksi, methods=["POST"]),
    Mount("/admin/static", StaticFiles(directory=STATIC), name="static"),
]

app = Starlette(routes=routes, middleware=[Middleware(HeaderKeamanan)])
