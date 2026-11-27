"""TERAWANG · Perbarui data iklim untuk K1 "tahun analog": ONI (NOAA CPC) dan hujan bulanan CHIRPS per kab/kota (GEE).

Folder keluaran (bawaan ~/.local/share/terawang/iklim, di luar repo) diisi dulu dari data/iklim di repo, lalu:
  - ONI: unduh https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt -> noaa_oni.txt + noaa_oni_bulanan.csv
    (bulan = bulan tengah musim 3 bulanan: DJF=1 ... NDJ=12). Gagal unduh -> berkas lama dipakai, keluar kode 0 + peringatan.
  - CHIRPS (hanya bila --gee-project diisi): tarik ulang 3 bulan terakhir yang ada + bulan sesudahnya lewat
    scripts/gee/chirps_bulanan.py, gabungkan; bulan yang belum lengkap (hari_data < jumlah hari kalender) dibuang.

  python scripts/iklim/perbarui_iklim.py [--keluar DIR] [--gee-project terawang-515805]
"""
import argparse
import calendar
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

import pandas as pd

URL_ONI = "https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt"
MUSIM = {s: i + 1 for i, s in enumerate(["DJF", "JFM", "FMA", "MAM", "AMJ", "MJJ", "JJA", "JAS", "ASO", "SON", "OND", "NDJ"])}
BERKAS = ["noaa_oni.txt", "noaa_oni_bulanan.csv", "chirps_jatim_bulanan.csv"]


def oni_ke_csv(teks: str) -> pd.DataFrame:
    baris = []
    for ln in teks.splitlines()[1:]:
        p = ln.split()
        if len(p) == 4 and p[0] in MUSIM:
            baris.append((int(p[1]), MUSIM[p[0]], float(p[3])))
    return pd.DataFrame(baris, columns=["tahun", "bulan", "oni"])


def perbarui_oni(out: Path) -> None:
    try:
        with urllib.request.urlopen(URL_ONI, timeout=60) as r:
            teks = r.read().decode()
        df = oni_ke_csv(teks)
        if len(df) < 800:
            raise ValueError(f"isi ONI tidak wajar ({len(df)} baris)")
    except Exception as e:  # noqa: BLE001
        print(f"PERINGATAN: ONI gagal diunduh ({e}); memakai berkas lama", file=sys.stderr)
        return
    (out / "noaa_oni.txt").write_text(teks)
    df.to_csv(out / "noaa_oni_bulanan.csv", index=False)
    print("ONI s.d.", f"{df.tahun.iloc[-1]}-{df.bulan.iloc[-1]:02d}", f"= {df.oni.iloc[-1]:+.2f}")


def perbarui_chirps(out: Path, project: str) -> None:
    f = out / "chirps_jatim_bulanan.csv"
    lama = pd.read_csv(f)
    t = lama[["tahun", "bulan"]].drop_duplicates().sort_values(["tahun", "bulan"]).iloc[-3]
    with tempfile.TemporaryDirectory() as tmp:
        baru_f = Path(tmp) / "chirps.csv"
        subprocess.run([sys.executable, "scripts/gee/chirps_bulanan.py", "--project", project,
                        "--mulai", f"{t.tahun}-{t.bulan:02d}", "--keluar", str(baru_f)], check=True)
        baru = pd.read_csv(baru_f)
    lengkap = baru.hari_data >= [calendar.monthrange(y, m)[1] for y, m in zip(baru.tahun, baru.bulan)]
    baru = baru[lengkap]
    kunci = ["wilayah", "tahun", "bulan"]
    gab = pd.concat([lama, baru]).drop_duplicates(kunci, keep="last").sort_values(["tingkat"] + kunci)
    gab.to_csv(f, index=False)
    akhir = gab[["tahun", "bulan"]].drop_duplicates().iloc[-1]
    print("CHIRPS s.d.", f"{akhir.tahun}-{akhir.bulan:02d}", f"({len(baru)} baris baru/diperbarui)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--keluar", default=os.environ.get("TERAWANG_IKLIM_DIR", str(Path.home() / ".local/share/terawang/iklim")))
    ap.add_argument("--gee-project", default="")
    a = ap.parse_args()
    out = Path(a.keluar)
    out.mkdir(parents=True, exist_ok=True)
    for b in BERKAS:
        if not (out / b).exists():
            shutil.copy(Path("data/iklim") / b, out / b)
    perbarui_oni(out)
    if a.gee_project:
        perbarui_chirps(out, a.gee_project)


if __name__ == "__main__":
    main()
