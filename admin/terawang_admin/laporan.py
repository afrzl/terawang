"""Antrean validasi laporan harga warga (app.laporan_harga_warga, diisi bot WhatsApp lewat perintah LAPOR).

Petugas memeriksa tiap laporan lalu menerima (VALID) atau menolaknya (DITOLAK). Nomor pelapor tidak pernah
dikirim utuh ke peramban: hanya 4 digit terakhir.
"""
from __future__ import annotations

from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from . import envfile, pengaturan

STATUS = ("MENUNGGU", "VALID", "DITOLAK")
AKSI = {"terima": "VALID", "tolak": "DITOLAK", "kembalikan": "MENUNGGU"}


class GagalLaporan(Exception):
    pass


def _url_db() -> str:
    path = pengaturan.BERKAS_ENV.get("pipeline")
    url = envfile.baca(path).get("DATABASE_URL") if path and path.exists() else None
    if not url:
        raise GagalLaporan("DATABASE_URL belum diatur di konfigurasi pipeline.")
    b = urlsplit(url)
    q = [(k, v) for k, v in parse_qsl(b.query) if k != "schema"]  # parameter khusus Prisma
    return urlunsplit(("postgresql", b.netloc, b.path, urlencode(q), ""))


def _sambung():
    try:
        import psycopg2  # ikut terpasang di .venv-pipeline
    except ImportError as e:  # pragma: no cover
        raise GagalLaporan("Modul psycopg2 tidak tersedia di lingkungan admin.") from e
    try:
        return psycopg2.connect(_url_db(), connect_timeout=5, application_name="terawang-admin")
    except psycopg2.Error as e:
        raise GagalLaporan("Tidak bisa terhubung ke database.") from e


def _samarkan(nomor: str | None) -> str:
    angka = "".join(c for c in (nomor or "") if c.isdigit())
    return "…" + angka[-4:] if len(angka) >= 4 else "–"


def daftar(status: str | None, batas: int = 200) -> dict:
    if status and status not in STATUS:
        raise GagalLaporan("Status tidak dikenal.")
    batas = max(1, min(int(batas), 500))
    with _sambung() as kon, kon.cursor() as c:
        c.execute("select status::text, count(*) from app.laporan_harga_warga group by 1")
        jumlah = {s: 0 for s in STATUS} | {s: n for s, n in c.fetchall()}
        c.execute(
            """
            select l.id, extract(epoch from l.dibuat_pada)::float8, l.status::text, l.nama_pasar, l.harga_rp_kg,
                   l.selisih_panel_pct, k.nama as komoditas, w.nama as wilayah, kw.nomor_wa,
                   (select count(*) from app.laporan_harga_warga x where x.kontak_id = l.kontak_id) as n_pelapor
              from app.laporan_harga_warga l
              join ref.komoditas k on k.id = l.komoditas_id
              left join ref.wilayah w on w.id = l.wilayah_id
              join app.kontak_warga kw on kw.id = l.kontak_id
             where (%(st)s::text is null or l.status::text = %(st)s)
             order by l.dibuat_pada desc
             limit %(batas)s
            """,
            {"st": status, "batas": batas},
        )
        baris = [
            {"id": r[0], "waktu": r[1], "status": r[2], "pasar": r[3], "harga": r[4], "selisih": r[5],
             "komoditas": r[6], "wilayah": r[7], "pelapor": _samarkan(r[8]), "laporanPelapor": r[9]}
            for r in c.fetchall()
        ]
    return {"jumlah": jumlah, "laporan": baris}


def ubah(id_laporan: int, aksi: str) -> dict:
    if aksi not in AKSI:
        raise GagalLaporan("Aksi tidak dikenal.")
    baru = AKSI[aksi]
    with _sambung() as kon, kon.cursor() as c:
        c.execute(
            """
            update app.laporan_harga_warga l set status = %s::app."StatusLaporan"
              from ref.komoditas k
             where l.id = %s and k.id = l.komoditas_id
            returning l.id, l.nama_pasar, l.harga_rp_kg, k.nama
            """,
            (baru, id_laporan),
        )
        r = c.fetchone()
    if not r:
        raise GagalLaporan("Laporan tidak ditemukan.")
    return {"id": r[0], "status": baru, "pasar": r[1], "harga": r[2], "komoditas": r[3]}
