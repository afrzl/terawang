"""TERAWANG · Ambil harga harian beras per kab/kota Jawa Timur dari PIHPS Bank Indonesia (www.bi.go.id/hargapangan).

Endpoint publik di balik halaman TabelHarga/PedagangBesarDaerah & ProdusenDaerah (tanpa login/captcha):
  GET /hargapangan/WebSite/TabelHarga/GetGridDataDaerah?price_type_id=..&comcat_id=com_1,..&province_id=16
      &regency_id=<satu id>&market_id=&tipe_laporan=1&start_date=yyyy-mm-dd&end_date=yyyy-mm-dd
Bila beberapa kab/kota dipilih sekaligus, server mengembalikan rata-ratanya, jadi satu permintaan = satu jenis pasar x satu
kab/kota x satu tahun, berisi keenam komoditas beras sekaligus. Daftar kab/kota diambil dari GetRefRegency. Data hanya
hari kerja (PIHPS tidak melapor akhir pekan/libur). Cache mentah per permintaan, jadi menjalankan ulang hanya mengambil
yang belum ada. Hanya pustaka standar Python.

  python3 scripts/pihps/ambil_pihps.py --mulai 2024-01-01 --akhir 2026-11-25
  python3 scripts/pihps/ambil_pihps.py --gabung            # hanya menyusun CSV dari cache
"""
import argparse
import csv
import datetime as dt
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

BASE = "https://www.bi.go.id/hargapangan/WebSite/TabelHarga"
PROV_JATIM = 16
JENIS_PASAR = {3: "pedagang_besar", 4: "produsen"}
KOMODITAS = {  # comcat_id -> slug (nama di PIHPS)
    "com_1": "beras_kualitas_bawah_i",
    "com_2": "beras_kualitas_bawah_ii",
    "com_3": "beras_kualitas_medium_i",
    "com_4": "beras_kualitas_medium_ii",
    "com_5": "beras_kualitas_super_i",
    "com_6": "beras_kualitas_super_ii",
}
NAMA_KOM = {"Beras Kualitas Bawah I": "com_1", "Beras Kualitas Bawah II": "com_2", "Beras Kualitas Medium I": "com_3",
            "Beras Kualitas Medium II": "com_4", "Beras Kualitas Super I": "com_5", "Beras Kualitas Super II": "com_6"}
HDR = {"Accept": "application/json", "Referer": "https://www.bi.go.id/hargapangan/TabelHarga/PedagangBesarDaerah",
       "User-Agent": "Mozilla/5.0 (riset harga pangan)"}


def get(path, params, timeout=300):
    u = f"{BASE}/{path}?{urllib.parse.urlencode(params)}"
    with urllib.request.urlopen(urllib.request.Request(u, headers=HDR), timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def daftar_kabkota(pt, cache):
    f = os.path.join(cache, f"regency_{pt}.json")
    if not os.path.exists(f):
        os.makedirs(cache, exist_ok=True)
        json.dump(get("GetRefRegency", {"price_type_id": pt, "ref_prov_id": PROV_JATIM})["data"], open(f, "w"))
    return json.load(open(f))


def ambil(pt, reg, t0, t1, cache, jeda):
    f = os.path.join(cache, JENIS_PASAR[pt], str(reg), f"{t0:%Y%m%d}_{t1:%Y%m%d}.json")
    if os.path.exists(f):
        return "ada"
    os.makedirs(os.path.dirname(f), exist_ok=True)
    q = {"price_type_id": pt, "comcat_id": ",".join(KOMODITAS), "province_id": PROV_JATIM, "regency_id": reg,
         "market_id": "", "tipe_laporan": 1, "start_date": t0.isoformat(), "end_date": t1.isoformat()}
    err = None
    for coba in range(5):
        try:
            j = get("GetGridDataDaerah", q)
            with open(f + ".tmp", "w") as w:
                json.dump(j.get("data") or [], w)
            os.replace(f + ".tmp", f)
            time.sleep(jeda)
            return "ok"
        except urllib.error.HTTPError as e:
            err = e
            time.sleep((30 if e.code == 429 else 10) * (coba + 1))
        except Exception as e:  # noqa: BLE001
            err = e
            time.sleep(10 * (coba + 1))
    return f"gagal {pt}/{reg}/{t0.year}: {err}"


def gabung(cache, keluar):
    os.makedirs(keluar, exist_ok=True)
    for pt, pasar in JENIS_PASAR.items():
        f = os.path.join(cache, f"regency_{pt}.json")
        if not os.path.exists(f):
            continue
        nama = {r["id"]: r["name"].strip() for r in json.load(open(f))}
        rows = {c: [] for c in KOMODITAS}
        for reg in sorted(nama):
            d = os.path.join(cache, pasar, str(reg))
            for fn in sorted(os.listdir(d)) if os.path.isdir(d) else []:
                for r in json.load(open(os.path.join(d, fn))):
                    c = NAMA_KOM.get(str(r.get("name", "")).strip())
                    if not c:
                        continue
                    for k, v in r.items():
                        if k.count("/") != 2 or v in (None, "", "-"):
                            continue
                        try:
                            harga = float(str(v).replace(",", ""))
                        except ValueError:
                            continue
                        if harga > 0:
                            tgl = dt.datetime.strptime(k, "%d/%m/%Y").date().isoformat()
                            rows[c].append((tgl, reg, nama[reg], harga))
        for c, rr in rows.items():
            if not rr:
                continue
            rr.sort()
            out = os.path.join(keluar, f"kabkota_harian_{pasar}_{KOMODITAS[c]}.csv")
            with open(out, "w", newline="") as w:
                cw = csv.writer(w)
                cw.writerow(["tanggal", "city_id", "kabkota_sumber", "harga_rp_kg"])
                cw.writerows(rr)
            print(f"{out}: {len(rr)} baris, {len(set(r[0] for r in rr))} tanggal, {len(set(r[1] for r in rr))} kab/kota")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mulai", default="2024-01-01")
    ap.add_argument("--akhir", default=(dt.date.today() - dt.timedelta(days=1)).isoformat())
    ap.add_argument("--cache", default=os.path.expanduser("~/.cache/terawang-pihps"))
    ap.add_argument("--keluar", default="data/pihps")
    ap.add_argument("--paralel", type=int, default=2)
    ap.add_argument("--jeda", type=float, default=1.5)
    ap.add_argument("--gabung", action="store_true", help="hanya susun CSV dari cache")
    a = ap.parse_args()
    if not a.gabung:
        t0, t1 = dt.date.fromisoformat(a.mulai), dt.date.fromisoformat(a.akhir)
        potong = [(max(t0, dt.date(y, 1, 1)), min(t1, dt.date(y, 12, 31))) for y in range(t0.year, t1.year + 1)]
        tugas = [(pt, r["id"], p0, p1) for pt in JENIS_PASAR for r in daftar_kabkota(pt, a.cache) for p0, p1 in potong]
        n = {"ok": 0, "ada": 0, "gagal": 0}
        with ThreadPoolExecutor(a.paralel) as ex:
            for i, s in enumerate(ex.map(lambda t: ambil(*t, a.cache, a.jeda), tugas)):
                n[s.split()[0]] += 1
                if s.startswith("gagal"):
                    print(f"  {s}", file=sys.stderr, flush=True)
                if (i + 1) % 10 == 0:
                    print(f"{i + 1}/{len(tugas)} {n}", flush=True)
        print(f"selesai {n}", flush=True)
    gabung(a.cache, a.keluar)


if __name__ == "__main__":
    main()
