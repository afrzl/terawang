"""TERAWANG K1 · Uji "tahun analog": komponen rata-rata musiman (klim) diganti rata-rata berbobot semua tahun latih,
bobot lebih besar untuk tahun yang ONI-nya (5 bulan sebelum target) dan hujan CHIRPS kab-nya (4-6 bulan sebelum target) mirip.

  bobot_j = exp(-0,5 [(dONI/s_oni)^2 + (dlog hujan/s_hujan)^2])
Skema evaluasi sama dengan scripts/k1/uji_k1_ringkas.py / uji_oni.py. ONI pusat m-5 dan hujan s.d. m-4 sudah terbit saat
tanggal potong untuk semua jarak (0/28/56 hari).

  python scripts/k1/uji_tahun_analog.py      # tulis data/satelit/k1_uji_tahun_analog.csv
"""
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, "scripts/k1")
import k1_prakiraan as kp  # noqa: E402
import uji_oni as u  # noqa: E402
from nowcast_eval import muat_bps  # noqa: E402

_c = pd.read_csv("data/iklim/chirps_jatim_bulanan.csv").query("tingkat=='kabkota'")
HUJAN = {(w, t * 12 + b - 1): h for w, t, b, h in zip(_c.wilayah, _c.tahun, _c.bulan, _c.hujan_mm)}
KELUAR = "data/satelit/k1_uji_tahun_analog.csv"


def fitur(kab, bln, th):
    t = th * 12 + bln - 1
    oni = np.array([u.ONI.get(x - 5, np.nan) for x in t])
    huj = np.log1p(np.array([sum(HUJAN.get((k, x - d), np.nan) for d in (4, 5, 6)) for k, x in zip(kab, t)]))
    return oni, huj


class GabunganAnalog(kp.Gabungan):
    s_oni, s_hujan = 0.5, 0.3

    def _latih(self, trn):
        bg, bk, clim = super()._latih(trn)
        return bg, bk, clim, list(trn)

    def komponen(self, th, prev_y, par=None):
        bg, bk, clim, trn = par if par is not None else self.par
        idx = self.Yw.index
        kab, bln = idx.get_level_values(0).to_numpy(), idx.get_level_values(1).to_numpy()
        o0, h0 = fitur(kab, bln, th)
        num, den = np.zeros(len(idx)), np.zeros(len(idx))
        for j in trn:
            yj = self.Yw[j].to_numpy()
            oj, hj = fitur(kab, bln, j)
            z = 0.0
            if self.s_oni:
                z = z + ((o0 - oj) / self.s_oni) ** 2
            if self.s_hujan:
                z = z + np.nan_to_num((h0 - hj) / self.s_hujan, nan=0.0) ** 2
            w = np.exp(-0.5 * z) * np.isfinite(yj)
            num += w * np.nan_to_num(yj)
            den += w
        klim_a = pd.Series(np.where(den > 1e-9, num / np.maximum(den, 1e-12), clim.to_numpy()), index=idx)
        return super().komponen(th, prev_y, (bg, bk, klim_a))


def jalankan(Yw, ES, kota, fin, h, s_oni, s_hujan, kelas):
    kelas.s_oni, kelas.s_hujan = s_oni, s_hujan
    E, L = ES[h], kp.LEAD[h]
    parts = []
    for Y in [t for t in fin if t >= 2022]:
        for m in range(1, 13):
            tr = u.tr_pada(fin, Y, m, L)
            if len(tr) < 2:
                continue
            p = kelas(Yw, E, tr, kota).prediksi(Y, max(tr))
            p = p[p.index.get_level_values(1) == m].copy()
            p["y"], p["tahun"] = Yw[Y].reindex(p.index).to_numpy(), Y
            parts.append(p)
    R = pd.concat(parts).dropna(subset=["y"])
    R["kota"] = R.index.get_level_values(0).isin(kota)
    K = R[~R.kota]
    jt = R.groupby(["tahun", R.index.get_level_values(1)])[["y", "gabungan"]].sum()
    tri = K.assign(q=(K.index.get_level_values(1) - 1) // 3).groupby([K.index.get_level_values(0), "tahun", "q"])[["y", "gabungan"]].sum()
    out = dict(lead=L, s_oni=s_oni, s_hujan=s_hujan, wape_semua=u.wape(R.y, R.gabungan), wape_kab=u.wape(K.y, K.gabungan),
               wape_kab_triwulan=u.wape(tri.y, tri.gabungan), mape_jatim_bulanan=u.mape(jt.y, jt.gabungan))
    for Y in sorted(K.tahun.unique()):
        k = K[K.tahun == Y]
        out[f"kab_{Y}"] = u.wape(k.y, k.gabungan)
    return out


def main():
    y = muat_bps()
    Yw = y.pivot(index=["kabkota", "bulan"], columns="tahun", values="y")
    ES, kota, fin = kp.muat_citra(Yw), kp.daftar_kota(), kp.tahun_final(Yw)
    miss = set(Yw.index.get_level_values(0)) - set(_c.wilayah)
    if miss:
        print("PERINGATAN wilayah tanpa CHIRPS:", miss)
    rows = []
    for h in kp.LEAD:
        rows.append(jalankan(Yw, ES, kota, fin, h, None, None, kp.Gabungan) | dict(varian="sekarang"))
        for so, sh in [(0.5, None), (None, 0.3), (0.5, 0.3), (0.3, 0.2), (1.0, 0.5)]:
            rows.append(jalankan(Yw, ES, kota, fin, h, so, sh, GabunganAnalog) | dict(varian="analog"))
        print(pd.DataFrame(rows[-6:]).round(1).to_string(index=False), flush=True)
    pd.DataFrame(rows).round(3).to_csv(KELUAR, index=False)


if __name__ == "__main__":
    main()
