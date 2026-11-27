"""Antrean validasi laporan harga warga (app.laporan_harga_warga, diisi bot WhatsApp lewat perintah LAPOR).

Petugas memeriksa tiap laporan lalu menerima (VALID) atau menolaknya (DITOLAK). Nomor pelapor tidak pernah
dikirim utuh ke peramban: hanya 4 digit terakhir.
"""
from __future__ import annotations

from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from . import envfile, pengaturan

STATUS = ("MENUNGGU", "VALID", "DITOLAK")
PERAN = ("PENJUAL", "PEMBELI")
AKSI = {"terima": "VALID", "tolak": "DITOLAK", "kembalikan": "MENUNGGU"}


class GagalLaporan(Exception):
    pass


# Ambang saran (persen selisih terhadap pembanding). Hanya saran: keputusan tetap di petugas.
WAJAR_PCT = 10.0
SALAH_PCT = 25.0
SARAN = ("WAJAR", "CEK", "SALAH")


def _pct(a: float, b: float) -> float:
    return round((a / b - 1) * 100, 1)


def _fmt_pct(v: float) -> str:
    return f"{'+' if v > 0 else ''}{v:.1f}".replace(".", ",") + "%"


def _rp(v: float) -> str:
    return "Rp" + f"{round(v):,}".replace(",", ".")


def saran(harga: int, selisih: float | None, peran: str | None, banding_n: int, banding_median: float | None,
          het: int | None, pelapor_valid: int, pelapor_tolak: int) -> dict:
    """Saran Wajar / Perlu dicek / Kemungkinan salah beserta alasannya, dari aturan sederhana yang bisa ditelusuri."""
    alasan: list[str] = []
    tingkat = 1  # 0 wajar, 1 perlu dicek, 2 kemungkinan salah
    if selisih is not None:
        a = abs(selisih)
        tingkat = 0 if a < WAJAR_PCT else 1 if a < SALAH_PCT else 2
        alasan.append(f"{_fmt_pct(selisih)} vs panel")
    else:
        alasan.append("belum ada panel pembanding")
    if banding_n and banding_median:
        d = _pct(harga, banding_median)
        if abs(d) <= 5:
            alasan.append(f"sejalan dgn {banding_n} laporan lain ({_rp(banding_median)})")
            # dikuatkan laporan warga lain: turunkan satu tingkat (mis. harga memang sedang naik)
            tingkat = max(0, tingkat - 1)
        elif abs(d) >= SALAH_PCT:
            alasan.append(f"{_fmt_pct(d)} vs {banding_n} laporan lain ({_rp(banding_median)})")
            tingkat = max(tingkat, 1 if selisih is not None and abs(selisih) < WAJAR_PCT else 2)
        else:
            alasan.append(f"{_fmt_pct(d)} vs {banding_n} laporan lain ({_rp(banding_median)})")
    if het and harga > het * 1.25:
        alasan.append(f"di atas HET {_rp(het)}")
        tingkat = max(tingkat, 1)
    if peran == "PEMBELI" and selisih is not None and WAJAR_PCT <= selisih < SALAH_PCT:
        alasan.append("pembeli eceran wajar sedikit di atas panel")
    if pelapor_tolak >= 2 and pelapor_tolak > pelapor_valid:
        alasan.append(f"pelapor {pelapor_tolak}x ditolak")
        tingkat = min(2, tingkat + 1)
    elif pelapor_valid >= 3 and pelapor_tolak == 0:
        alasan.append(f"pelapor tepercaya ({pelapor_valid}x diterima)")
    return {"saran": SARAN[tingkat], "alasan": alasan}


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


def daftar(status: str | None, batas: int = 200, peran: str | None = None) -> dict:
    if status and status not in STATUS:
        raise GagalLaporan("Status tidak dikenal.")
    if peran and peran not in PERAN:
        raise GagalLaporan("Peran pelapor tidak dikenal.")
    batas = max(1, min(int(batas), 500))
    with _sambung() as kon, kon.cursor() as c:
        c.execute(
            "select status::text, count(*) from app.laporan_harga_warga"
            " where (%(pr)s::text is null or peran_pelapor::text = %(pr)s) group by 1",
            {"pr": peran},
        )
        jumlah = {s: 0 for s in STATUS} | {s: n for s, n in c.fetchall()}
        c.execute(
            """
            select l.id, extract(epoch from l.dibuat_pada)::float8, l.status::text, l.nama_pasar, l.harga_rp_kg,
                   l.selisih_panel_pct, k.nama as komoditas, w.nama as wilayah, kw.nomor_wa,
                   (select count(*) from app.laporan_harga_warga x where x.kontak_id = l.kontak_id) as n_pelapor,
                   l.peran_pelapor::text,
                   b.n, b.median,
                   (select a.het_rp_kg from app.ambang_harga a
                     where a.komoditas_id = l.komoditas_id
                       and a.berlaku_dari <= current_date and (a.berlaku_sampai is null or a.berlaku_sampai >= current_date)
                       and (a.wilayah_id is null or a.wilayah_id = l.wilayah_id)
                     order by (a.wilayah_id is null), a.berlaku_dari desc limit 1) as het,
                   (select count(*) from app.laporan_harga_warga x where x.kontak_id = l.kontak_id and x.id <> l.id and x.status = 'VALID') as p_valid,
                   (select count(*) from app.laporan_harga_warga x where x.kontak_id = l.kontak_id and x.id <> l.id and x.status = 'DITOLAK') as p_tolak
              from app.laporan_harga_warga l
              join ref.komoditas k on k.id = l.komoditas_id
              left join ref.wilayah w on w.id = l.wilayah_id
              join app.kontak_warga kw on kw.id = l.kontak_id
              -- laporan warga lain (bukan pelapor yang sama) untuk wilayah & jenis yang sama, 30 hari, tidak ditolak
              left join lateral (
                select count(*)::int as n, percentile_cont(0.5) within group (order by x.harga_rp_kg)::float8 as median
                  from app.laporan_harga_warga x
                 where x.wilayah_id = l.wilayah_id and x.komoditas_id = l.komoditas_id and x.kontak_id <> l.kontak_id
                   and x.status <> 'DITOLAK' and x.dibuat_pada between l.dibuat_pada - interval '30 days' and l.dibuat_pada + interval '30 days'
              ) b on true
             where (%(st)s::text is null or l.status::text = %(st)s)
               and (%(pr)s::text is null or l.peran_pelapor::text = %(pr)s)
             order by l.dibuat_pada desc
             limit %(batas)s
            """,
            {"st": status, "batas": batas, "pr": peran},
        )
        baris = [
            {"id": r[0], "waktu": r[1], "status": r[2], "pasar": r[3], "harga": r[4], "selisih": r[5],
             "komoditas": r[6], "wilayah": r[7], "pelapor": _samarkan(r[8]), "laporanPelapor": r[9], "peran": r[10],
             **saran(r[4], r[5], r[10], r[11] or 0, r[12], r[13], r[14] or 0, r[15] or 0)}
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
