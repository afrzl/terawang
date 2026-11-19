"""TERAWANG · Pengambil harga konsumen harian per pasar dari SISKAPERBAPO Jawa Timur.

Sumber: https://siskaperbapo.jatimprov.go.id/harga-komoditas  (halaman publik, tanpa login dan tanpa kunci API).
Formulirnya menerima `tanggal_akhir` dan `komoditas`, lalu menampilkan 7 hari berakhir pada tanggal itu untuk semua pasar.

Keluaran di <keluar>/ (default data/siskaperbapo/harga_beras/), untuk nama komoditas <nama>:
  pasar_harian_<nama>.csv.gz       mentah per pasar per hari, apa adanya dari sumber
  kabkota_harian_<nama>.csv        rata-rata pasar bernilai per kab/kota per hari (nilai < Rp5.000/kg dikecualikan, dihitung di kolom pasar_dikecualikan)
  provinsi_harian_<nama>.csv       angka provinsi yang dipublikasikan sumber (pembanding)

Hasil unduhan disimpan per tanggal di cache (default ~/.cache/terawang-siskaperbapo/<nama>.jsonl), jadi menjalankan ulang hanya
mengambil tanggal yang belum ada. Tanggal terbaru (--segarkan hari terakhir) selalu diunduh ulang karena sumber bisa merevisi.

Pakai (dari root repo):
  python3 scripts/siskaperbapo/ambil_harga.py --komoditas 4 --nama beras_medium
  python3 scripts/siskaperbapo/ambil_harga.py --komoditas 2 --nama beras_premium

Kode komoditas: 4 = Beras Medium, 2 = Beras Premium (daftar lengkap di <select name="komoditas"> pada halaman sumber).
Sopan terhadap server: jeda antarpermintaan 1,2 detik, satu sesi, tanpa paralel.
"""
import argparse
import collections
import csv
import datetime as dt
import gzip
import html
import http.cookiejar
import json
import pathlib
import re
import statistics as st
import sys
import time
import urllib.parse
import urllib.request

URL = "https://siskaperbapo.jatimprov.go.id/harga-komoditas"
UA = "Mozilla/5.0 (compatible; terawang-research/1.0)"
BATAS_MIN = 5000  # harga pasar di bawah ini (Rp/kg) dianggap salah ketik di sumber


def sesi():
    cj = http.cookiejar.CookieJar()
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    op.addheaders = [("User-Agent", UA)]
    h = op.open(URL, timeout=40).read().decode("utf-8", "ignore")
    return op, re.search(r'name="csrf_token" value="([^"]+)"', h).group(1)


def ambil_html(op, tok, komoditas, akhir):
    data = urllib.parse.urlencode({"csrf_token": tok, "tanggal_akhir": akhir, "komoditas": komoditas}).encode()
    return op.open(urllib.request.Request(URL, data=data), timeout=60).read().decode("utf-8", "ignore")


def parse(h):
    jud = re.search(r"<h4[^>]*>(.*?)</h4>", h, re.S)
    jud = html.unescape(re.sub(r"<[^>]+>", "", jud.group(1))).strip() if jud else None
    tb = re.findall(r"<table[^>]*>.*?</table>", h, re.S)[0]
    rows = []
    for r in re.findall(r"<tr[^>]*>(.*?)</tr>", tb, re.S):
        rows.append([html.unescape(re.sub(r"<[^>]+>", "", x)).strip() for x in re.findall(r"<t[hd][^>]*>(.*?)</t[hd]>", r, re.S)])
    return jud, rows


def angka(x):
    return None if x in ("-", "", None) else int(x.replace(".", ""))


def jendela_ke_rekaman(rows):
    """Satu respons (7 hari) -> {tanggal: {"prov": int|None, "pasar": [[kab, pasar, harga|None], ...]}}."""
    tgl = rows[0][2:]
    assert len(tgl) == 7 and all(re.match(r"^\d{4}-\d\d-\d\d$", d) for d in tgl), tgl
    rek = {d: {"prov": angka(rows[1][2 + j]), "pasar": []} for j, d in enumerate(tgl)}
    kab = None
    for r in rows[2:]:
        if re.match(r"^\d+$", r[0]):
            kab = r[1]
        elif re.match(r"^\d+\.\d+$", r[0]):
            for j, d in enumerate(tgl):
                rek[d]["pasar"].append([kab, r[1], angka(r[2 + j])])
    return rek


def muat_cache(path):
    c = {}
    if path.exists():
        for ln in path.read_text(encoding="utf-8").splitlines():
            try:
                d = json.loads(ln)
                c[d["tanggal"]] = d
            except Exception:
                pass
    return c


def tulis_cache(path, cache):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for t in sorted(cache):
            f.write(json.dumps(cache[t], ensure_ascii=False) + "\n")


def tanggal_terakhir_tersedia(komoditas, akhir):
    """Sumber membalas jendela yang berakhir di data terakhir kalau tanggal yang diminta belum terbit (tanpa galat)."""
    op, tok = sesi()
    jud, _ = parse(ambil_html(op, tok, komoditas, akhir))
    m = re.search(r"sampai (\d{4}-\d{2}-\d{2})", jud or "")
    return min(akhir, m.group(1)) if m else akhir


def unduh(args, cache, cpath):
    tersedia = tanggal_terakhir_tersedia(args.komoditas, args.akhir)
    if tersedia != args.akhir:
        print(f"data {args.akhir} belum terbit di sumber; memakai sampai {tersedia}", flush=True)
        args.akhir = tersedia
    mulai, akhir = dt.date.fromisoformat(args.mulai), dt.date.fromisoformat(args.akhir)
    batas = (akhir - dt.timedelta(days=args.segarkan)).isoformat()
    for t in [t for t in cache if t >= batas]:
        del cache[t]
    perlu = {(mulai + dt.timedelta(days=i)).isoformat() for i in range((akhir - mulai).days + 1)}
    sisa = sorted(perlu - set(cache))
    print(f"tanggal dibutuhkan {len(perlu)}, sudah di cache {len(perlu) - len(sisa)}, perlu diunduh {len(sisa)}", flush=True)
    if not sisa:
        return
    op, tok = sesi()
    n = 0
    while sisa:
        end = sisa[-1]
        for coba in range(3):
            try:
                jud, rows = parse(ambil_html(op, tok, args.komoditas, end))
                assert jud and f"sampai {end}" in jud and len(rows) > 100, "respons tidak sesuai"
                rek = jendela_ke_rekaman(rows)
                break
            except Exception as ex:
                print(f"{end} percobaan {coba + 1} gagal: {type(ex).__name__} {str(ex)[:80]}", file=sys.stderr, flush=True)
                time.sleep(5 * (coba + 1))
                try:
                    op, tok = sesi()
                except Exception:
                    pass
        else:
            sys.exit(f"gagal mengunduh jendela berakhir {end} setelah 3 percobaan; jalankan ulang untuk melanjutkan")
        for d, v in rek.items():
            cache[d] = {"tanggal": d, **v}
        sisa = [d for d in sisa if d not in cache]
        n += 1
        if n % 20 == 0:
            tulis_cache(cpath, cache)
            print(f"{n} jendela selesai, sisa {len(sisa)} tanggal", flush=True)
        time.sleep(args.jeda)
    tulis_cache(cpath, cache)


def susun(args, cache):
    out = pathlib.Path(args.keluar)
    out.mkdir(parents=True, exist_ok=True)
    tgl = sorted(t for t in cache if t <= args.akhir)
    pasar = {}
    for t in tgl:
        for kab, ps, v in cache[t]["pasar"]:
            pasar[(t, kab, ps)] = v
    with gzip.GzipFile(out / f"pasar_harian_{args.nama}.csv.gz", "wb", mtime=0) as gz:
        import io
        buf = io.TextIOWrapper(gz, encoding="utf-8", newline="")
        w = csv.writer(buf)
        w.writerow(["tanggal", "kabkota", "pasar", "harga_rp_kg"])
        for k in sorted(pasar):
            w.writerow([*k, "" if pasar[k] is None else pasar[k]])
        buf.flush()
        buf.detach()
    per = collections.defaultdict(list)
    for (t, kab, ps), v in pasar.items():
        per[(t, kab)].append(v)
    kab_h = {}
    for (t, kab), vs in per.items():
        ok = [x for x in vs if x is not None and x >= BATAS_MIN]
        kab_h[(t, kab)] = (st.mean(ok) if ok else None, len(ok), len(vs), sum(1 for x in vs if x is not None and x < BATAS_MIN))
    kabs = sorted({k for (_, k) in kab_h})
    jenis = lambda n: "kota" if n.startswith("Kota ") else "kabupaten"
    with open(out / f"kabkota_harian_{args.nama}.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["tanggal", "kabkota", "jenis", "harga_rata2_rp_kg", "pasar_bernilai", "pasar_total", "pasar_dikecualikan"])
        for t in tgl:
            for k in kabs:
                m, n, tot, dk = kab_h.get((t, k), (None, 0, 0, 0))
                w.writerow([t, k, jenis(k), "" if m is None else f"{m:.1f}", n, tot, dk])
    with open(out / f"provinsi_harian_{args.nama}.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["tanggal", "harga_provinsi_publikasi_rp_kg"])
        for t in tgl:
            w.writerow([t, "" if cache[t]["prov"] is None else cache[t]["prov"]])
    # validasi: rata-rata antar-kab/kota (dipotong) vs angka provinsi yang dipublikasikan sumber
    per_t = collections.defaultdict(list)
    for (t, k), (m, n, tot, dk) in kab_h.items():
        if m is not None:
            per_t[t].append(m)
    sel = collections.Counter(int(st.mean(per_t[t])) - cache[t]["prov"] for t in tgl if t in per_t and cache[t]["prov"] is not None)
    kosong = sum(1 for v in pasar.values() if v is None)
    print(f"{args.nama}: {tgl[0]} sampai {tgl[-1]}, {len(tgl)} hari, {len(pasar)} sel pasar-hari ({100 * kosong / len(pasar):.1f}% kosong)")
    print(f"selisih (rata-rata antar-kab dipotong) - (provinsi publikasi), jumlah hari: {dict(sorted(sel.items()))}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--komoditas", required=True, help="kode komoditas SISKAPERBAPO (4 = Beras Medium, 2 = Beras Premium)")
    ap.add_argument("--nama", required=True, help="nama untuk berkas keluaran, contoh beras_medium")
    ap.add_argument("--mulai", default="2022-01-01")
    ap.add_argument("--akhir", default=dt.date.today().isoformat())
    ap.add_argument("--keluar", default="data/siskaperbapo/harga_beras")
    ap.add_argument("--cache", default=str(pathlib.Path.home() / ".cache" / "terawang-siskaperbapo"))
    ap.add_argument("--segarkan", type=int, default=14, help="unduh ulang N hari terakhir (sumber bisa merevisi)")
    ap.add_argument("--jeda", type=float, default=1.2, help="detik antarpermintaan")
    args = ap.parse_args()
    cpath = pathlib.Path(args.cache) / f"{args.nama}.jsonl"
    cache = muat_cache(cpath)
    unduh(args, cache, cpath)
    susun(args, cache)


if __name__ == "__main__":
    main()
