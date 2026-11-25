"""TERAWANG K3a · Prediksi harga HARIAN per kab/kota (7, 14, 21, 28 hari) dan status terhadap HET.

Model: harga hari terakhir (asal harian) + sebaran galat empiris jendela 365 hari terakhir (hanya galat yang targetnya sudah terjadi).
  harga_prediksi = p0 x exp(median galat);  P10/P90 = kuantil galat;  P(harga > HET) = proporsi galat > log(HET/p0)
Status (HET dari app.ambang_harga): SIAGA bila P(> 1,05 HET) >= ambang_siaga; WASPADA bila P(> HET) >= ambang_waspada; AMAN selainnya.
Ambang per horizon dikalibrasi lewat backtest (sejak 22 Agu 2025, kab yang masih <= HET): ambang yang memaksimalkan F1 deteksi
kejadian baru melewati HET (hasil dicetak dan disimpan di parameter model_run).

  python scripts/k3/k3_harga_operasional.py [--simpan]
"""
import argparse
import json
import subprocess
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, "scripts/k2")
import model_stok as ms  # noqa: E402

HOR = (7, 14, 21, 28)
JENDELA = 365
MULAI_UJI = pd.Timestamp("2025-08-22")
# komoditas_id -> (HET Rp/kg, ambang siaga % di atas HET), dipakai bila app.ambang_harga kosong. Sama dengan konstanta dasbor (src/lib/data.ts).
HET_CADANGAN = {1: (13500, 5.0), 2: (14900, 5.0)}


def harian(kom):
    h = ms.sql(f"select w.nama_repo kab,h.tanggal,h.harga_rata2_rp_kg p from silver.harga_kabkota_harian h join ref.wilayah w on w.id=h.wilayah_id where h.komoditas_id={kom}")
    h["tanggal"] = pd.to_datetime(h.tanggal)
    return h.pivot(index="tanggal", columns="kab", values="p").asfreq("D").ffill(limit=3)


def galat(L, h):
    y = (L.shift(-h) - L).stack().rename("y").reset_index()
    y.columns = ["tgl", "kab", "y"]
    y["tgt"] = y.tgl + pd.Timedelta(days=h)
    return y.dropna()


def _auc(skor, label):
    """AUC (Mann-Whitney, peringkat rata-rata untuk nilai seri). None bila hanya ada satu kelas."""
    pos, neg = int(label.sum()), int(len(label) - label.sum())
    if not pos or not neg:
        return None
    r = pd.Series(skor).rank().to_numpy()
    return round(float((r[label == 1].sum() - pos * (pos + 1) / 2) / (pos * neg)), 3)


def backtest(P, H, het):
    """Per horizon: peluang melewati HET (jendela 365 hari) untuk kab <= HET; pilih ambang waspada ber-F1 maksimum."""
    L = np.log(P)
    hasil = {}
    for h in HOR:
        kn = galat(L, h)
        lp = L.stack().rename("lp").reset_index()
        lp.columns = ["tgl", "kab", "lp"]
        te = kn.merge(lp, on=["tgl", "kab"])
        te = te[(te.tgl >= MULAI_UJI) & (te.tgt <= P.index.max())].copy()
        te["d"] = np.log(het) - te.lp
        te = te[te.d >= 0]
        te["ev"] = (te.y > te.d).astype(int)
        pe = np.zeros(len(te))
        for t, sub in te.groupby("tgl"):
            m = (kn.tgt <= t) & (kn.tgt > t - pd.Timedelta(days=JENDELA))
            e = np.sort(kn[m].y.to_numpy())
            pe[te.index.get_indexer(sub.index)] = 1 - np.searchsorted(e, sub.d.to_numpy(), side="right") / len(e)
        ev = te.ev.to_numpy()
        best = (0, 0.3, 0, 0, 0)
        for th in np.arange(0.05, 0.75, 0.05):
            tp, fp = ((pe >= th) & (ev == 1)).sum(), ((pe >= th) & (ev == 0)).sum()
            fn = ev.sum() - tp
            f1 = 2 * tp / max(2 * tp + fp + fn, 1)
            if f1 > best[0]:
                best = (f1, th, tp, fp, fn)
        hasil[h] = dict(ambang=round(float(best[1]), 2), f1=round(float(best[0]), 3), terdeteksi=int(best[2]), alarm_palsu=int(best[3]), kejadian=int(ev.sum()),
                        auc=_auc(pe, ev))
    return hasil


def hitung(cetak=True):
    """Prakiraan K3a untuk tanggal harga terakhir di database. Kembalikan (R, het, kalibrasi): R = satu baris per komoditas x kab x horizon."""
    log = print if cetak else (lambda *a, **k: None)
    het = ms.sql("select komoditas_id k, het_rp_kg het, ambang_siaga_pct sg from app.ambang_harga where wilayah_id is null order by berlaku_dari").groupby("k").last()
    for kom, (h, sg) in HET_CADANGAN.items():  # app.ambang_harga belum terisi: pakai HET cadangan (belum diverifikasi ke teks resmi)
        if kom not in het.index:
            het.loc[kom] = [h, sg]
            log(f"HET komoditas {kom} tidak ada di app.ambang_harga; dipakai cadangan Rp{h:,} (siaga +{sg}%)")
    rows, kal_all = [], {}
    for kom, nm in ((1, "medium"), (2, "premium")):
        P = harian(kom)
        L = np.log(P)
        H = float(het.loc[kom, "het"])
        siaga = H * (1 + het.loc[kom, "sg"] / 100)
        kal = backtest(P, None, H)
        kal_all[nm] = kal
        log(f"\nKalibrasi ambang WASPADA, beras {nm} (HET Rp{H:,.0f}):")
        for h, v in kal.items():
            log(f"  {h:2d} hari: ambang {v['ambang']:.2f} | F1 {v['f1']:.2f} | terdeteksi {v['terdeteksi']}/{v['kejadian']}, alarm palsu {v['alarm_palsu']}")
        tgl_acuan = P.index.max()
        p0 = P.ffill().iloc[-1]
        for h in HOR:
            kn = galat(L, h)
            e = kn[(kn.tgt <= tgl_acuan) & (kn.tgt > tgl_acuan - pd.Timedelta(days=JENDELA))].y.to_numpy()
            q10, q50, q90 = np.quantile(e, [0.1, 0.5, 0.9])
            th_w = kal[h]["ambang"]
            for kab, p in p0.items():
                pw = float((e > np.log(H / p)).mean())
                ps = float((e > np.log(siaga / p)).mean())
                st = "SIAGA" if ps >= max(th_w, 0.5) else ("WASPADA" if pw >= th_w else "AMAN")
                rows.append((kom, kab, str(tgl_acuan.date()), h, p * np.exp(q50), p * np.exp(q10), p * np.exp(q90), st, pw))
    R = pd.DataFrame(rows, columns=["komoditas", "kab", "tanggal_acuan", "horizon_hari", "harga", "p10", "p90", "status", "p_di_atas_het"])
    return R, het, kal_all


def parameter_run(het, kal_all):
    return {"model": "harga hari terakhir + sebaran galat empiris jendela 365 hari", "asal": "harian", "horizon_hari": list(HOR), "kalibrasi_ambang": kal_all,
            "uji": "backtest sejak 22 Agu 2025 (kab <= HET), ambang maks F1", "het": {int(k): int(v) for k, v in het.het.items()}}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--simpan", action="store_true")
    a = ap.parse_args()
    ids = ms.sql("select id, nama_repo kab from ref.wilayah where level='KABKOTA'").set_index("kab").id
    R, het, kal_all = hitung()
    for kom, nm in ((1, "medium"), (2, "premium")):
        d = R[R.komoditas == kom]
        print(f"\nBeras {nm}: jumlah kab per status")
        print(d.pivot_table(index="horizon_hari", columns="status", values="kab", aggfunc="count", fill_value=0).reindex(columns=["AMAN", "WASPADA", "SIAGA"], fill_value=0).to_string())
        d28 = d[d.horizon_hari == 28].sort_values("p_di_atas_het", ascending=False).head(6)
        print("  peluang melewati HET tertinggi (28 hari):", ", ".join(f"{r.kab} {r.p_di_atas_het * 100:.0f}%" for r in d28.itertuples()))
    R.to_csv("data/satelit/k3_harga_operasional.csv", index=False)
    if a.simpan:
        par = parameter_run(het, kal_all)
        rid = int(ms.sql(f"insert into app.model_run (jenis, nama_versi, parameter, selesai_pada) values ('K3_HARGA','k3_harga_harian_365_2026_11','{json.dumps(par)}'::jsonb, now()) returning id").iloc[0, 0])
        vals = [f"({rid},{ids[r.kab]},{r.komoditas},'{r.tanggal_acuan}',{r.horizon_hari},{r.harga},{r.p10},{r.p90},'{r.status}','MODEL')" for r in R.itertuples()]
        res = subprocess.run(["psql", "-d", "terawang", "-v", "ON_ERROR_STOP=1", "-c", "insert into app.prediksi_harga (model_run_id,wilayah_id,komoditas_id,tanggal_acuan,horizon_hari,harga_prediksi,batas_bawah,batas_atas,status,jenis_data) values " + ",".join(vals)], capture_output=True, text=True)
        if res.returncode:
            raise SystemExit("gagal menyimpan: " + res.stderr[:400])
        print(f"\ntersimpan: model_run {rid}, {len(vals)} baris")


if __name__ == "__main__":
    main()
