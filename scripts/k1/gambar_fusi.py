"""TERAWANG K1 · Gambar penjelas fusi S1+S2 v2 (untuk ai-notes/metodologi-aturan-banjir-fusi.md).

1. fusi_contoh.png : satu titik sawah nyata: VH, EVI (asli, tebakan fusi, interpolasi), dan aturan banjir pada deret terisi.
2. fusi_kualitas.png : mutu pengisian celah (uji adil 2026) interpolasi vs v1 vs v2 vs v3.

Prasyarat: python scripts/k1/fusi_v2_s1_s2.py <berkas.npz>
  python scripts/k1/gambar_fusi.py <berkas.npz>
"""
import datetime as dt
import sys

import matplotlib

matplotlib.use("Agg")
import matplotlib.dates as mdates  # noqa: E402
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

sys.path.insert(0, "scripts/k1")
import siklus_tanam as st  # noqa: E402
from tuning_banjir_s2 import peristiwa  # noqa: E402

OUT = "ai-notes/img"
HARI = 12
PAKAI = dict(evi_max=0.35, evi_ver=0.50, delta=0.05)
LAG = 8


def pilih_titik(E, L, Ef, Lf, W, tgl):
    """Titik yang banjirnya terdeteksi HANYA setelah fusi, jendela banjirnya berawan, di musim tanam 2024/25."""
    lo = next(i for i, t in enumerate(tgl) if t >= dt.date(2024, 9, 1))
    hi = next(i for i, t in enumerate(tgl) if t >= dt.date(2025, 4, 1))
    kandidat = []
    for i in range(len(E)):
        nan_n = int(np.isnan(E[i, lo:hi]).sum())
        if nan_n < 3 or nan_n > 8:
            continue
        a = [e for e in peristiwa(L[i], E[i], PAKAI["evi_max"], PAKAI["evi_ver"], PAKAI["delta"]) if lo <= e < hi]
        b = [e for e in peristiwa(Lf[i], Ef[i], PAKAI["evi_max"], PAKAI["evi_ver"], PAKAI["delta"]) if lo <= e < hi]
        if len(b) == 1 and len(a) == 0 and np.isnan(E[i, b[0]]):
            kandidat.append((i, b[0]))
    return kandidat, lo, hi


def main():
    npz = sys.argv[1]
    v = pd.read_csv(st.TITIK)
    s = pd.read_csv("data/satelit/s2_titik_12harian_kabkota.csv.gz")
    tgl = [dt.date.fromisoformat(c) for c in v.columns[3:]]
    W = len(tgl)
    E = s[[c for c in s.columns if c.startswith("evi_")]].to_numpy(float)
    L = s[[c for c in s.columns if c.startswith("lswi_")]].to_numpy(float)
    both = np.isnan(E) | np.isnan(L)
    E[both] = np.nan
    L[both] = np.nan
    z = np.load(npz)
    Ef, Lf = z["evi"], z["lswi"]
    vh = np.vstack([x if (x := st.bersihkan(r)) is not None else np.full(W, np.nan) for r in v.iloc[:, 3:].to_numpy()])

    kand, lo, hi = pilih_titik(E, L, Ef, Lf, W, tgl)
    print(f"titik kandidat (banjir hanya terdeteksi setelah fusi): {len(kand)}")
    i, e = kand[len(kand) // 3]
    print(f"dipakai titik {i} ({s.kabkota[i]}), jendela banjir {tgl[e]}")

    a, b = max(0, lo - 2), min(W, hi + 14)
    x = [dt.datetime.combine(t, dt.time()) for t in tgl[a:b]]
    ok = ~np.isnan(E[i, a:b])
    interp = np.interp(np.arange(a, b), np.arange(W)[~np.isnan(E[i])], E[i][~np.isnan(E[i])])

    fig, ax = plt.subplots(3, 1, figsize=(9, 8), sharex=True)
    ax[0].plot(x, vh[i, a:b], color="#555", lw=1.4)
    ax[0].set_ylabel("VH (dB)")
    ax[0].set_title(f"Satu titik sawah nyata ({s.kabkota[i]}), musim tanam 2024/25", fontsize=11)
    ax[0].text(0.01, 0.06, "Radar: selalu ada, tembus awan", transform=ax[0].transAxes, fontsize=9, color="#555")

    ax[1].plot(x, interp, "--", color="#999", lw=1.2, label="interpolasi linear")
    ax[1].plot(x, Ef[i, a:b], "-", color="#d95f02", lw=1.6, label="deret terisi fusi v2")
    ax[1].scatter(np.array(x)[ok], E[i, a:b][ok], s=22, color="#1b6ca8", zorder=3, label="EVI asli (jernih)")
    for k in np.where(~ok)[0]:
        ax[1].axvspan(x[k] - dt.timedelta(days=6), x[k] + dt.timedelta(days=6), color="#bbb", alpha=0.35, lw=0)
    ax[1].scatter(np.array(x)[~ok], Ef[i, a:b][~ok], s=34, facecolors="none", edgecolors="#d95f02", zorder=4, label="tebakan fusi (berawan)")
    ax[1].set_ylabel("EVI")
    ax[1].legend(fontsize=8, ncol=2, loc="upper left")
    ax[1].text(0.99, 0.05, "area abu-abu = jendela berawan", transform=ax[1].transAxes, fontsize=8, ha="right", color="#666")

    ax[2].plot(x, Lf[i, a:b] + PAKAI["delta"], color="#2a9d8f", lw=1.6, label="LSWI + 0,05 (air)")
    ax[2].plot(x, Ef[i, a:b], color="#d95f02", lw=1.6, label="EVI (hijau)")
    fl = (Lf[i, a:b] + PAKAI["delta"] >= Ef[i, a:b]) & (Ef[i, a:b] <= PAKAI["evi_max"])
    for k in np.where(fl)[0]:
        ax[2].axvspan(x[k] - dt.timedelta(days=6), x[k] + dt.timedelta(days=6), color="#e63946", alpha=0.18, lw=0)
    xe = dt.datetime.combine(tgl[e], dt.time())
    xh = dt.datetime.combine(tgl[min(e + LAG, W - 1)], dt.time())
    ax[2].axvline(xe, color="#e63946", lw=1.5)
    ax[2].axvline(xh, color="#6a4c93", lw=1.5, ls="--")
    ax[2].text(xe, ax[2].get_ylim()[1] * 0.97, " tanam (banjir)", color="#e63946", fontsize=9, va="top")
    ax[2].text(xh, ax[2].get_ylim()[1] * 0.97, " panen (+96 hari)", color="#6a4c93", fontsize=9, va="top")
    ax[2].set_ylabel("indeks")
    ax[2].legend(fontsize=8, loc="center left")
    ax[2].text(0.99, 0.05, "merah muda = LSWI + 0,05 >= EVI dan EVI <= 0,35", transform=ax[2].transAxes, fontsize=8, ha="right", color="#666")
    ax[2].xaxis.set_major_formatter(mdates.DateFormatter("%b %y"))
    plt.tight_layout()
    plt.savefig(f"{OUT}/fusi_contoh.png", dpi=130)
    plt.close()

    # mutu pengisian celah (hasil fusi_v2_s1_s2.py dan fusi_v3_vv.py, uji 2026, 30% pengamatan jernih disembunyikan)
    nama = ["interpolasi\nsaja", "v1\nVH saja", "v2\nVH + optik\ntetangga", "v3\n+ VV"]
    r2 = [0.64, 0.29, 0.71, 0.72]
    rc = [52, 33, 58, 59]
    fig, ax = plt.subplots(1, 2, figsize=(9, 3.4))
    w = ["#999", "#bbb", "#d95f02", "#e9b27a"]
    ax[0].bar(nama, r2, color=w)
    ax[0].set_title("LSWI: seberapa baik ditebak (R2)", fontsize=10)
    ax[0].set_ylim(0, 0.9)
    for k, val in enumerate(r2):
        ax[0].text(k, val + 0.02, f"{val:.2f}", ha="center", fontsize=9)
    ax[1].bar(nama, rc, color=w)
    ax[1].set_title("Sawah tergenang yang berhasil terdeteksi (recall, %)", fontsize=10)
    ax[1].set_ylim(0, 75)
    for k, val in enumerate(rc):
        ax[1].text(k, val + 1.5, f"{val}%", ha="center", fontsize=9)
    plt.tight_layout()
    plt.savefig(f"{OUT}/fusi_kualitas.png", dpi=130)
    plt.close()
    print("gambar tersimpan di", OUT)


if __name__ == "__main__":
    main()
