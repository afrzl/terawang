"""K3 · Gambar rumus prediksi harga + ilustrasi dari data asli (medium, h=4 minggu)."""
import sys
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
sys.path.insert(0, "scripts/k3")
from prediksi_harga import muat

W = muat(1); L = np.log(W)
h, HET = 4, 13500
e = (L.shift(-h) - L).stack().dropna().to_numpy()
q10, q50, q90 = np.quantile(e, [.1, .5, .9])
last = W.ffill().iloc[-1]
cand = last[last < HET]
pws = {k: float((e > np.log(HET / v)).mean()) for k, v in cand.items()}
kab = max(pws, key=lambda k: pws[k] if pws[k] < 0.9 else -1)  # contoh: sekarang di bawah HET, peluang melewati tertinggi
p0 = float(last[kab]); pw = pws[kab]

plt.rcParams["font.family"] = "DejaVu Sans"
fig = plt.figure(figsize=(14, 6.6), dpi=150, facecolor="white")
ax = fig.add_axes([0.03, 0.04, 0.46, 0.88]); ax.axis("off")
ax.text(0, 1.0, "Rumus prediksi harga (K3a)", fontsize=17, fontweight="bold", va="top")
ax.text(0, 0.945, "tiap kab/kota, h = 1-4 minggu ke depan", fontsize=10.5, color="#555", va="top")
blok = [
    ("1  Seberapa besar harga biasa bergeser?", r"$\mathrm{galat}_h \;=\; \log\!\left(\dfrac{p_{t+h}}{p_t}\right)$", "dikumpulkan dari seluruh riwayat 2022-sekarang", "#1f6f8b"),
    ("2  Harga prediksi", r"$\hat{p} \;=\; p_0 \cdot e^{\,\mathrm{median}(\mathrm{galat}_h)}$", "p0 = harga minggu terakhir", "#2a9d8f"),
    ("3  Pita ketidakpastian", r"$\mathrm{P10},\,\mathrm{P90} \;=\; p_0 \cdot e^{\,\mathrm{kuantil}\;10\%,\;90\%\;(\mathrm{galat}_h)}$", "80% kemungkinan harga ada di antara keduanya", "#e9a23b"),
    ("4  Peluang melewati HET", r"$P(\mathrm{harga}>\mathrm{HET}) \;=\; \mathrm{proporsi}\;\{\mathrm{galat}_h > \log(\mathrm{HET}/p_0)\}$", "HET medium Rp13.500, premium Rp14.900", "#c44536"),
]
y = 0.85
for jdl, rms, ket, wr in blok:
    ax.add_patch(plt.Rectangle((0, y - 0.175), 0.012, 0.19, color=wr, transform=ax.transAxes))
    ax.text(0.03, y + 0.01, jdl, fontsize=12, fontweight="bold", va="top", color=wr)
    ax.text(0.03, y - 0.065, rms, fontsize=14.5, va="top")
    ax.text(0.03, y - 0.14, ket, fontsize=10, va="top", color="#555")
    y -= 0.205
ax.text(0, -0.02, "Status: SIAGA bila P(harga > 1,05 x HET) >= 50%  |  WASPADA bila P(harga > HET) >= 30%  |  AMAN selainnya",
        fontsize=9.5, color="#333", va="bottom")

a2 = fig.add_axes([0.56, 0.17, 0.41, 0.66])
harga = p0 * np.exp(e)
a2.hist(harga, bins=60, color="#9fc5d3", edgecolor="white", linewidth=0.4)
a2.axvline(p0, color="#1f3b4d", lw=2); a2.axvline(p0 * np.exp(q50), color="#2a9d8f", lw=2, ls="--")
a2.axvspan(p0 * np.exp(q10), p0 * np.exp(q90), color="#e9a23b", alpha=0.18)
a2.axvline(HET, color="#c44536", lw=2.4)
yt = a2.get_ylim()[1]
a2.text(p0 - 40, yt * 0.80, f"p0 = Rp{p0:,.0f}\n(harga sekarang)", ha="right", color="#1f3b4d", fontsize=10, fontweight="bold")
a2.text(HET, yt * 0.93, f"HET Rp{HET:,}", ha="left", color="#c44536", fontsize=10, fontweight="bold")
a2.set_xlim(np.quantile(harga, 0.002) - 150, np.quantile(harga, 0.995) + 150)
a2.text(p0 * np.exp(q10), yt * 0.02, "P10", fontsize=9, color="#b07a1a", ha="right"); a2.text(p0 * np.exp(q90), yt * 0.02, "P90", fontsize=9, color="#b07a1a", ha="left")
sel = harga > HET
a2.hist(harga[sel], bins=np.linspace(HET, harga.max(), 20), color="#c44536", alpha=0.55)
a2.set_xlabel("kemungkinan harga 4 minggu lagi (Rp/kg)"); a2.set_yticks([])
for s in ("top", "right", "left"): a2.spines[s].set_visible(False)
a2.set_title(f"Contoh nyata: beras medium, {kab}, harga 17 Nov 2026\nPita P10-P90 oranye | peluang melewati HET = {pw*100:.0f}% (area merah)", fontsize=11, loc="left", pad=12)
a2.xaxis.set_major_formatter(matplotlib.ticker.FuncFormatter(lambda v, _: f"{v:,.0f}"))
fig.savefig("ai-notes/gambar-k3-rumus.png", bbox_inches="tight", facecolor="white")
print("ok", p0, round(p0 * np.exp(q10)), round(p0 * np.exp(q50)), round(p0 * np.exp(q90)), round(pw, 2))
