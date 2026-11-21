"""TERAWANG K1 · Gambar bukti akurasi untuk ai-notes/metodologi-aturan-banjir-fusi.md.

1. akurasi_galat.png  : galat (WAPE) gabungan vs citra saja vs rata-rata musiman untuk tiap jangka yang diprediksi.
2. akurasi_3bulan.png : (kiri) BPS vs prakiraan 3 bulan ke depan, seluruh Jatim; (kanan) per kabupaten, prakiraan vs BPS.

Prasyarat: python scripts/k1/nowcast_3bulan.py  (menulis data/satelit/hasil_3bulan_ke_depan.csv)
  python scripts/k1/gambar_akurasi.py
"""
import datetime as dt

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

OUT = "ai-notes/img"
C_GAB, C_CIT, C_KLIM = "#d95f02", "#9a9a9a", "#1b6ca8"


def wape(a, p):
    a, p = np.asarray(a, float), np.asarray(p, float)
    return np.abs(p - a).sum() / a.sum() * 100


def main():
    # ---------- 1. galat per jangka (angka dari nowcast_eval.py dan nowcast_3bulan.py)
    jangka = ["3 bulan ke depan\nper kabupaten", "3 bulan ke depan\nseluruh Jatim", "Per bulan\nper kabupaten", "Total Jan-Sep\nper kabupaten", "Produksi Jan-Sep 2026\n(uji akhir)"]
    gab = [14.2, 8.0, 29.3, 7.0, 9.3]
    cit = [21.2, 12.4, 40.6, 11.1, 12.9]
    klm = [15.9, 10.1, 34.9, 6.3, 9.9]
    x = np.arange(len(jangka))
    w = 0.26
    fig, ax = plt.subplots(figsize=(10, 4.2))
    for off, v, c, lab in [(-w, gab, C_GAB, "Gabungan (dipakai)"), (0, cit, C_CIT, "Citra saja"), (w, klm, C_KLIM, "Rata-rata musiman (pembanding)")]:
        b = ax.bar(x + off, v, w, color=c, label=lab)
        for r, val in zip(b, v):
            ax.text(r.get_x() + r.get_width() / 2, val + 0.6, f"{val:.1f}", ha="center", fontsize=8)
    ax.axhline(10, color="#e63946", lw=1, ls="--", label="target proposal 10%")
    ax.set_xticks(x)
    ax.set_xticklabels(jangka, fontsize=8.5)
    ax.set_ylabel("galat (WAPE, %) - makin kecil makin baik")
    ax.set_title("Galat prakiraan terhadap BPS, menurut jangka yang diprediksi", fontsize=11)
    ax.legend(fontsize=8.5, frameon=False)
    ax.spines[["top", "right"]].set_visible(False)
    plt.tight_layout()
    plt.savefig(f"{OUT}/akurasi_galat.png", dpi=130)
    plt.close()

    # ---------- 2. 3 bulan ke depan
    R = pd.read_csv("data/satelit/hasil_3bulan_ke_depan.csv")
    J = R.groupby(["Yi", "M"])[["a", "gabungan", "klim"]].sum().reset_index()
    J["tgl"] = [dt.date(int(y), int(m), 1) for y, m in zip(J.Yi, J.M)]
    J = J.sort_values("tgl")
    fig, ax = plt.subplots(1, 2, figsize=(11, 4.4), gridspec_kw={"width_ratios": [1.5, 1]})
    a0 = ax[0]
    a0.plot(J.tgl, J.a / 1000, color="black", lw=2, marker="o", ms=3.5, label="BPS (sebenarnya)")
    a0.plot(J.tgl, J.gabungan / 1000, color=C_GAB, lw=1.8, marker="o", ms=3, label=f"Gabungan (galat {wape(J.a, J.gabungan):.1f}%)")
    a0.plot(J.tgl, J.klim / 1000, color=C_KLIM, lw=1.2, ls="--", label=f"Rata-rata musiman (galat {wape(J.a, J.klim):.1f}%)")
    a0.set_title("Seluruh Jatim: jumlah luas panen 3 bulan ke depan\n(tiap titik = prakiraan yang terbit pada bulan itu)", fontsize=10)
    a0.set_ylabel("ribu ha")
    a0.legend(fontsize=8.5, frameon=False, loc="upper center", bbox_to_anchor=(0.5, -0.1), ncol=3)
    a0.spines[["top", "right"]].set_visible(False)

    a1 = ax[1]
    kota = R.kabkota.str.startswith("Kota") | (R.kabkota == "Batu")
    a1.scatter(R.a[~kota] / 1000, R.gabungan[~kota] / 1000, s=9, alpha=0.45, color=C_GAB, label=f"Kabupaten (galat {wape(R.a[~kota], R.gabungan[~kota]):.1f}%)")
    a1.scatter(R.a[kota] / 1000, R.gabungan[kota] / 1000, s=16, alpha=0.8, color="#6a4c93", zorder=3, label=f"Kota (galat {wape(R.a[kota], R.gabungan[kota]):.1f}%)")
    mx = max(R.a.max(), R.gabungan.max()) / 1000 * 1.03
    a1.plot([0, mx], [0, mx], color="black", lw=1)
    a1.set_xlim(0, mx)
    a1.set_ylim(0, mx)
    a1.set_xlabel("BPS (ribu ha)")
    a1.set_ylabel("Prakiraan gabungan (ribu ha)")
    a1.set_title("Per kabupaten: prakiraan vs BPS\n(garis hitam = tepat)", fontsize=10)
    a1.legend(fontsize=8.5, frameon=False, loc="upper left")
    a1.spines[["top", "right"]].set_visible(False)
    plt.tight_layout()
    plt.savefig(f"{OUT}/akurasi_3bulan.png", dpi=130)
    plt.close()
    print("gambar tersimpan di", OUT)


if __name__ == "__main__":
    main()
