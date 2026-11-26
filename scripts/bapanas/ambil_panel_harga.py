"""TERAWANG · Ambil harga harian per kab/kota Jawa Timur dari Panel Harga Bapanas (API publik di balik panelharga.badanpangan.go.id).

Satu permintaan = satu komoditas x satu tanggal (field `city`, rata-rata geometrik per kab/kota). Hasil mentah disimpan per
(komoditas, tanggal) di folder cache, jadi menjalankan ulang hanya mengambil yang belum ada. Hanya pustaka standar Python.

Komoditas bawaan (level 1 = produsen, 3 = konsumen):
  1:5   beras medium penggilingan      1:4   GKG penggilingan      1:2   GKP petani      1:6   beras premium penggilingan
  3:109 beras SPHP (konsumen)          3:165 beras medium non-SPHP   3:28  beras medium (konsumen)

  python3 scripts/bapanas/ambil_panel_harga.py --mulai 2024-01-01 --akhir 2026-11-25 --keluar data/bapanas/panel_harga
  python3 scripts/bapanas/ambil_panel_harga.py --gabung --keluar data/bapanas/panel_harga     # hanya menyusun CSV dari cache
"""
import argparse
import csv
import datetime as dt
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

API = "https://api-panelhargav2.badanpangan.go.id/api/front/harga-peta-provinsi"
PROV_JATIM = 15
KOMODITAS = [  # (level_harga_id, komoditas_id, nama), urut prioritas
    (1, 5, "beras_medium_penggilingan"),
    (3, 109, "beras_sphp_konsumen"),
    (3, 165, "beras_medium_non_sphp_konsumen"),
    (1, 4, "gkg_penggilingan"),
    (1, 2, "gkp_petani"),
    (3, 28, "beras_medium_konsumen"),
    (1, 6, "beras_premium_penggilingan"),
]
HDR = {"Accept": "application/json", "Referer": "https://panelharga.badanpangan.go.id/", "Origin": "https://panelharga.badanpangan.go.id",
       "User-Agent": "Mozilla/5.0 (riset harga pangan)"}


def url(level, kom, tgl):
    d = tgl.strftime("%d/%m/%Y")
    q = urllib.parse.urlencode({"level_harga_id": level, "komoditas_id": kom, "period_date": f"{d} - {d}"})
    return f"{API}?{q}&multi_status_map[0]=&multi_province_id[0]={PROV_JATIM}"


def ambil(level, kom, tgl, cache, jeda):
    f = os.path.join(cache, f"{level}_{kom}", f"{tgl:%Y-%m-%d}.json")
    if os.path.exists(f):
        return "ada"
    os.makedirs(os.path.dirname(f), exist_ok=True)
    for coba in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url(level, kom, tgl), headers=HDR), timeout=60) as r:
                j = json.loads(r.read().decode("utf-8"))
            kota = j.get("city") or []
            kota = kota if isinstance(kota, list) else list(kota.values())
            with open(f + ".tmp", "w") as w:
                json.dump([{k: c.get(k) for k in ("city_id", "city_name", "date", "rata_rata_geometrik")} for c in kota], w)
            os.replace(f + ".tmp", f)
            time.sleep(jeda)
            return "ok"
        except Exception as e:  # noqa: BLE001
            time.sleep(5 * (coba + 1))
            err = e
    return f"gagal {err}"


def gabung(cache, keluar):
    os.makedirs(keluar, exist_ok=True)
    for level, kom, nama in KOMODITAS:
        d = os.path.join(cache, f"{level}_{kom}")
        if not os.path.isdir(d):
            continue
        rows = []
        for fn in sorted(os.listdir(d)):
            if not fn.endswith(".json"):
                continue
            tgl = fn[:-5]
            for c in json.load(open(os.path.join(d, fn))):
                v = c.get("rata_rata_geometrik")
                if v and float(v) > 0:
                    rows.append((tgl, c.get("city_id"), c.get("city_name"), float(v)))
        out = os.path.join(keluar, f"kabkota_harian_{nama}.csv")
        with open(out, "w", newline="") as w:
            cw = csv.writer(w)
            cw.writerow(["tanggal", "city_id", "kabkota_sumber", "harga_rp_kg"])
            cw.writerows(rows)
        print(f"{out}: {len(rows)} baris, {len(set(r[0] for r in rows))} tanggal, {len(set(r[1] for r in rows))} kab/kota")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mulai", default="2024-01-01")
    ap.add_argument("--akhir", default=(dt.date.today() - dt.timedelta(days=1)).isoformat())
    ap.add_argument("--cache", default=os.path.expanduser("~/.cache/terawang-bapanas"))
    ap.add_argument("--keluar", default="data/bapanas/panel_harga")
    ap.add_argument("--paralel", type=int, default=3)
    ap.add_argument("--jeda", type=float, default=0.5)
    ap.add_argument("--komoditas", default="", help="daftar level:id, mis. 1:5,3:109 (kosong = semua)")
    ap.add_argument("--gabung", action="store_true", help="hanya susun CSV dari cache")
    a = ap.parse_args()
    if not a.gabung:
        pilih = {tuple(map(int, s.split(":"))) for s in a.komoditas.split(",") if s}
        t0, t1 = dt.date.fromisoformat(a.mulai), dt.date.fromisoformat(a.akhir)
        tgl = [t1 - dt.timedelta(days=i) for i in range((t1 - t0).days + 1)]  # terbaru dulu
        for level, kom, nama in KOMODITAS:
            if pilih and (level, kom) not in pilih:
                continue
            n = {"ok": 0, "ada": 0, "gagal": 0}
            with ThreadPoolExecutor(a.paralel) as ex:
                for i, s in enumerate(ex.map(lambda t: ambil(level, kom, t, a.cache, a.jeda), tgl)):
                    n[s.split()[0]] += 1
                    if s.startswith("gagal"):
                        print(f"  {nama}: {s}", file=sys.stderr, flush=True)
                    if (i + 1) % 100 == 0:
                        print(f"{nama}: {i + 1}/{len(tgl)} {n}", flush=True)
            print(f"{nama} selesai {n}", flush=True)
    gabung(a.cache, a.keluar)


if __name__ == "__main__":
    main()
