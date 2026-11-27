"""TERAWANG · Jalankan terawang_citra_tanam.py untuk semua wilayah di src/lib/gee_wilayah.json.

Titik pusat kotak = hamparan sawah terpadat tiap wilayah (kolom "pusat" hasil terawang_wilayah.py).
Wilayah yang foldernya sudah berisi meta.json dilewati, kecuali --ulang.

  python scripts/gee/terawang_citra_semua.py --project ID_PROJECT_GEE
"""
import argparse
import concurrent.futures as cf
import json
import pathlib
import subprocess
import sys

HERE = pathlib.Path(__file__).parent


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True)
    ap.add_argument("--data", default="src/lib/gee_wilayah.json")
    ap.add_argument("--out", default="public/citra")
    ap.add_argument("--paralel", type=int, default=4)
    ap.add_argument("--ulang", action="store_true")
    ap.add_argument("--hanya", help="daftar nama dipisah koma (mis. wilayah yang titiknya digeser)")
    ap.add_argument("--tanggal", help="JSON hasil pilih_tanggal_citra.py (tanggal awal/terbaru per folder)")
    ap.add_argument("--jendela", type=int, default=12, help="komposit ± hari di sekitar tiap tanggal")
    a = ap.parse_args()

    wilayah = json.loads(pathlib.Path(a.data).read_text())["wilayah"]
    tanggal = json.loads(pathlib.Path(a.tanggal).read_text()) if a.tanggal else {}
    tugas = []
    for w in wilayah:
        if a.hanya and w["n"] not in a.hanya.split(","):
            continue
        folder = w["n"].lower().replace(" ", "-")
        if not a.ulang and (pathlib.Path(a.out) / folder / "meta.json").exists():
            print(f"- lewati {w['n']} (sudah ada)")
            continue
        if not w.get("pusat"):
            print(f"- lewati {w['n']} (tanpa titik sawah)")
            continue
        tugas.append(w)

    def jalan(w):
        cmd = [sys.executable, "-W", "ignore", str(HERE / "terawang_citra_tanam.py"), "--project", a.project,
               "--lokasi", w["n"], "--pusat", f"{w['pusat'][0]},{w['pusat'][1]}", "--out", a.out, "--tanpa-index",
               "--jendela", str(a.jendela)]
        t = tanggal.get(w["n"].lower().replace(" ", "-"))
        if t:
            cmd += ["--sebelum", t["sebelum"], "--sesudah", t["sesudah"]]
        for coba in range(3):
            r = subprocess.run(cmd, capture_output=True, text=True)
            if r.returncode == 0:
                return w["n"], True, ""
        return w["n"], False, r.stderr.strip().splitlines()[-1] if r.stderr.strip() else "?"

    with cf.ThreadPoolExecutor(a.paralel) as ex:
        for n, ok, err in ex.map(jalan, tugas):
            print(("  ✓ " if ok else "  ✗ ") + n + ("" if ok else f": {err[:200]}"), flush=True)

    # susun ulang index.json dari semua meta.json (urut sesuai daftar wilayah)
    out = pathlib.Path(a.out)
    idx = []
    for w in wilayah:
        m = out / w["n"].lower().replace(" ", "-") / "meta.json"
        if m.exists():
            idx.append(json.loads(m.read_text()))
    (out / "index.json").write_text(json.dumps(idx, indent=2, ensure_ascii=False))
    print(f"Selesai. index.json berisi {len(idx)} lokasi.")


if __name__ == "__main__":
    main()
