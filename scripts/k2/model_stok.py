"""TERAWANG K2 · Neraca stok beredar per kabupaten/kota per bulan (v2: Bulog sebagai penyangga).

Stok beredar = stok NON-BULOG (model, per kabupaten: pedagang, penggilingan) + stok BULOG (data BPS, hanya tingkat provinsi).
  non-Bulog_t = non-Bulog_{t-1} + produksi'_t - konsumsi + arus_masuk - arus_keluar - keluar_provinsi_t
  produksi' = produksi beras BPS dikurangi serapan Bulog (pemasukan - pengeluaran Bulog Jatim bulan itu), dibagi ke kabupaten
              menurut porsi produksi (bila Bulog menyerap) atau porsi konsumsi (bila Bulog melepas).
  konsumsi  = penduduk proyeksi 2025 x konsumsi beras per kapita kab (Susenas Maret 2025, kg/minggu x 30/7)
  arus      = surplus tahunan kab mengalir ke kab defisit tahunan, biaya jarak jalan minimum (linear programming)
  keluar_provinsi = phi x produksi' bulan itu (sisa surplus keluar Jatim / penggunaan non-rumah tangga mengikuti panen);
                    stok awal dipilih agar siklus tahunan berulang dan rata-rata cakupan non-Bulog = skenario.
Skenario cakupan non-Bulog (bulan konsumsi): RENDAH 0,7 | TENGAH 1,0 | TINGGI 1,3  (label DUMMY: pedagang 11% + penggilingan 7% dari
stok nasional 9,71 juta ton, survei Cadangan Beras Nasional Juni 2022, dibagi konsumsi bulanan nasional).
Status per kab (dari non-Bulog): CUKUP >= 0,63 bulan konsumsi; TIPIS 0,47-0,63; DEFISIT < 0,47 (ambang 1,0 dan 0,75 dari aplikasi,
diskalakan 0,625 = 1,0/1,6 karena yang dinilai hanya bagian non-Bulog).

  python scripts/k2/model_stok.py            # hitung dan cetak ringkasan
  python scripts/k2/model_stok.py --simpan   # juga tulis ke app.estimasi_stok
"""
import argparse
import io
import json
import os
import subprocess

import numpy as np
import pandas as pd
from scipy.optimize import linprog

SKENARIO = {"RENDAH": 0.7, "TENGAH": 1.0, "TINGGI": 1.3}
AMBANG_CUKUP, AMBANG_TIPIS = 0.63, 0.47
TAHUN = 2025


def sql(q):
    if os.environ.get("DATABASE_URL"):  # dipakai pipeline Dagster (server tanpa psql lokal); tanpa env ini tetap lewat psql
        return _sql_url(q, os.environ["DATABASE_URL"])
    out = subprocess.run(["psql", "-d", "terawang", "--csv", "-c", q], capture_output=True, text=True, check=True).stdout
    return pd.read_csv(io.StringIO(out))


def _sql_url(q, url):
    import sqlalchemy as sa
    from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

    u = urlsplit(url)
    qs = urlencode([(k, v) for k, v in parse_qsl(u.query) if k != "schema"])  # parameter schema milik Prisma
    eng = sa.create_engine(urlunsplit(("postgresql+psycopg2", u.netloc, u.path, qs, "")))
    with eng.connect() as c:
        return pd.read_sql(sa.text(q), c)


def muat():
    w = sql("select id, nama_repo kab from ref.wilayah where level='KABKOTA' order by id").set_index("kab")
    pop = sql(f"select w.nama_repo kab, p.jumlah_jiwa from silver.penduduk p join ref.wilayah w on w.id=p.wilayah_id where w.level='KABKOTA' and p.tahun={TAHUN}").set_index("kab").jumlah_jiwa
    ks = sql("select w.nama_repo kab, k.kg_per_kapita from silver.konsumsi_beras k join ref.wilayah w on w.id=k.wilayah_id where w.level='KABKOTA' and k.tahun=2025").set_index("kab").kg_per_kapita
    b = pd.read_csv("data/bps/produksi_padi/kabkota/bulanan/bps_jatim_padi_kabkota_bulanan_2025.csv")
    P = b.pivot(index="nama_repo", columns="bulan", values="produksi_beras_ton").loc[w.index]
    C = (pop * ks * 30 / 7 / 1000).loc[w.index]
    j = sql("select a.nama_repo dari, b.nama_repo ke, j.jarak_jalan_km km from silver.jarak_antar_wilayah j join ref.wilayah a on a.id=j.dari_id join ref.wilayah b on b.id=j.ke_id")
    D = j.pivot(index="dari", columns="ke", values="km").loc[w.index, w.index]
    bl = sql(f"select bulan, pemasukan_kg/1e3 masuk, pengeluaran_kg/1e3 keluar, persediaan_akhir_kg/1e3 akhir from silver.stok_bulog_bulanan where tahun={TAHUN} order by bulan").set_index("bulan")
    return w, P, C, D, bl


def arus_lp(net, D):
    sup, dem = net[net > 0], -net[net < 0]
    ns, nd = len(sup), len(dem)
    cost = np.array([[D.loc[i, j] for j in dem.index] for i in sup.index]).reshape(-1)
    A_eq = np.zeros((nd, ns * nd))
    for jj in range(nd):
        A_eq[jj, jj::nd] = 1
    A_ub = np.zeros((ns, ns * nd))
    for ii in range(ns):
        A_ub[ii, ii * nd:(ii + 1) * nd] = 1
    r = linprog(cost, A_ub=A_ub, b_ub=sup.to_numpy(), A_eq=A_eq, b_eq=dem.to_numpy(), bounds=(0, None), method="highs")
    assert r.status == 0, r.message
    return pd.DataFrame(r.x.reshape(ns, nd), index=sup.index, columns=dem.index)


def siklus(p, c, masuk, keluar, target, surplus_sisa):
    """Keluar provinsi mengikuti panen: bagian phi dari produksi tiap bulan langsung keluar (phi = sisa surplus / produksi tahunan).
    Lintasan = stok awal + kumulatif (produksi tersisa - konsumsi + arus). Stok awal dipilih agar rata-rata cakupan = target
    (siklus tahunan berulang). Lintasan negatif berarti stok yang diasumsikan tidak cukup melewati bulan-bulan tipis."""
    phi = surplus_sisa / p.sum() if p.sum() > 0 else 0.0
    inc = (1 - phi) * p - c + masuk - keluar
    cum = np.cumsum(inc)
    return cum + (target * c - cum.mean()), phi


def status(cak):
    return "CUKUP" if cak >= AMBANG_CUKUP else ("TIPIS" if cak >= AMBANG_TIPIS else "DEFISIT")


def hitung(pakai_bulog=True):
    w, P, C, D, bl = muat()
    kab = list(w.index)
    dB = (bl.masuk - bl.keluar).to_numpy() * (1.0 if pakai_bulog else 0.0)  # serapan bersih Bulog per bulan (ton)
    w_prod = P.sum(axis=1) / P.sum().sum()
    w_kons = C / C.sum()
    Pn = P.copy().astype(float)
    for t in range(12):
        share = w_prod if dB[t] > 0 else w_kons
        Pn[t + 1] = P[t + 1] - share * dB[t]
    net = Pn.sum(axis=1) - 12 * C
    F = arus_lp(net, D)
    masuk_th, keluar_th = pd.Series(0.0, index=kab), pd.Series(0.0, index=kab)
    masuk_th[F.columns] = F.sum(axis=0)
    keluar_th[F.index] = F.sum(axis=1)
    sisa = (net.clip(lower=0) - keluar_th).clip(lower=0)
    rows = []
    for nama, target in SKENARIO.items():
        for k in kab:
            tr, _ = siklus(Pn.loc[k].to_numpy(float), C[k], masuk_th[k] / 12, keluar_th[k] / 12, target, sisa[k])
            for t in range(12):
                cak = tr[t] / C[k]
                rows.append((k, TAHUN, t + 1, nama, tr[t], cak, status(cak)))
    R = pd.DataFrame(rows, columns=["kab", "tahun", "bulan", "skenario", "stok_ton", "cakupan_bulan", "status"])
    info = dict(P=P, Pn=Pn, C=C, net=net, F=F, sisa=sisa, bl=bl, w=w, dB=dB)
    return R, info


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--simpan", action="store_true")
    a = ap.parse_args()
    R, i = hitung()
    P, Pn, C, net, F, sisa, bl, w = i["P"], i["Pn"], i["C"], i["net"], i["F"], i["sisa"], i["bl"], i["w"]
    print(f"Jatim {TAHUN}: produksi beras {P.sum().sum() / 1e3:,.0f} rb ton | konsumsi {12 * C.sum() / 1e3:,.0f} rb ton | serapan bersih Bulog {i['dB'].sum() / 1e3:,.0f} rb ton")
    print(f"  surplus setelah Bulog {net.sum() / 1e3:,.0f} rb ton; kab defisit tahunan {int((net < 0).sum())} (kebutuhan {(-net[net < 0]).sum() / 1e3:,.0f} rb ton); arus antar kab {F.to_numpy().sum() / 1e3:,.0f} rb ton")
    print(f"  keluar provinsi / penggunaan lain {sisa.sum() / 1e3:,.0f} rb ton")
    T = R[R.skenario == "TENGAH"]
    print("\nSkenario TENGAH (cakupan non-Bulog rata-rata 1,0 bulan): jumlah kab per status")
    print(T.pivot_table(index="bulan", columns="status", values="kab", aggfunc="count", fill_value=0).reindex(columns=["CUKUP", "TIPIS", "DEFISIT"], fill_value=0).T.to_string())
    nb = R.groupby(["skenario", "bulan"]).stok_ton.sum().unstack(0) / 1e3
    tot = nb["TENGAH"] + bl.akhir.to_numpy() / 1e3
    print("\nStok seluruh Jatim (rb ton), skenario TENGAH:")
    print(pd.DataFrame({"non-Bulog (model)": nb["TENGAH"], "Bulog (data)": bl.akhir / 1e3, "total beredar": tot}).round(0).T.to_string())
    print(f"\nCakupan total beredar (non-Bulog + Bulog) / konsumsi bulanan Jatim: " + ", ".join(f"{x:.1f}" for x in tot / (C.sum() / 1e3)))

    if a.simpan:
        par = {"konsumsi": "Susenas Maret 2025 kg/kapita/minggu x 30/7", "penduduk": f"proyeksi {TAHUN}", "produksi": f"BPS beras bulanan {TAHUN}, dikurangi serapan bersih Bulog",
               "arus": "linear programming jarak jalan", "skenario_cakupan_nonbulog_bulan": SKENARIO, "ambang": [AMBANG_CUKUP, AMBANG_TIPIS]}
        met = {"kab_defisit_tahunan": int((net < 0).sum()), "serapan_bulog_rb_ton": float(i["dB"].sum() / 1e3)}
        rid = int(sql(f"insert into app.model_run (jenis, nama_versi, parameter, metrik, selesai_pada) values ('K2_STOK', 'neraca_v2_{TAHUN}', "
                      f"'{json.dumps(par)}'::jsonb, '{json.dumps(met)}'::jsonb, now()) returning id").iloc[0, 0])
        ids = w.id.to_dict()
        vals = ",".join(f"({rid},{ids[r.kab]},{r.tahun},{r.bulan},'{r.skenario}',{r.stok_ton},{r.cakupan_bulan},'{r.status}','DUMMY')" for r in R.itertuples())
        subprocess.run(["psql", "-d", "terawang", "-c", f"insert into app.estimasi_stok (model_run_id,wilayah_id,tahun,bulan,skenario,stok_ton,cakupan_bulan,status,jenis_data) values {vals}"], check=True, capture_output=True)
        print(f"\ntersimpan: model_run {rid}, {len(R)} baris di app.estimasi_stok")


if __name__ == "__main__":
    main()
