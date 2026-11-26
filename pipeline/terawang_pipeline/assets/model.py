"""Lapisan MODEL -> APP: memanggil fungsi model di terawang_models (milik Danang), menulis hasil ke schema app.

Aset di sini tidak berisi logika model. Tugasnya: ambil masukan, panggil model, catat app.model_run, simpan keluaran.
K1, K2, K3a (harga) dan K3b (SPHP) memanggil skrip asli Danang (scripts/k1, scripts/k2, scripts/k3) lewat terawang_models.
"""

import json
import os
import shutil
import sys
from pathlib import Path

import pandas as pd
import sqlalchemy as sa
from dagster import AssetExecutionContext, AssetKey, MaterializeResult, MetadataValue, asset

from terawang_models import k1_produksi, k2_stok, k3_harga, sphp

from ..resources import Database, Repo, SumberCitra, folder_lapisan
from ._app import model_run, sekarang, sisipkan

GRUP = "model"


def _md(df: pd.DataFrame, n: int = 10) -> MetadataValue:
    return MetadataValue.md("```\n" + df.head(n).to_string(index=False) + "\n```")


def folder_k1() -> Path:
    """Taksiran citra K1 bulan operasional (est_nowcast2_lead*_2026.csv), di luar repo supaya worktree git tetap bersih."""
    return Path(os.environ.get("TERAWANG_K1_DIR", Path.home() / ".local/share/terawang/k1"))


def _env_danang(repo: Repo, db: Database, sumber_citra: SumberCitra) -> dict[str, str]:
    return {"DATABASE_URL": db.url, "TERAWANG_K1_DIR": str(folder_k1()), "TERAWANG_TITIK_DIR": str(sumber_citra.folder_titik(repo)),
            "TERAWANG_DATA_DIR": str(folder_lapisan())}


@asset(group_name=GRUP, kinds={"python"}, deps=[AssetKey("bronze_titik_satelit")],
       description="K1 (Danang): taksiran luas panen dari citra, jarak 0/28/56 hari (scripts/k1/nowcast_est2.py), Okt 2026 sampai bulan ini + 2.")
def k1_nowcast_citra(context: AssetExecutionContext, repo: Repo, db: Database, sumber_citra: SumberCitra) -> MaterializeResult:
    folder_k1().mkdir(parents=True, exist_ok=True)
    akhir = k1_produksi.bulan_akhir(sekarang().date())
    env = _env_danang(repo, db, sumber_citra)
    total = {}
    for lead in k1_produksi.LEAD_HARI:
        repo.jalankan(k1_produksi.perintah_nowcast(sys.executable, lead, akhir), env=env, log=context.log)
        est = pd.read_csv(folder_k1() / f"est_nowcast2_lead{lead}_2026.csv")
        tb = est.groupby("t").est.sum()
        total[f"lead{lead}"] = {f"{(t - 1) // 12}-{(t - 1) % 12 + 1:02d}": round(float(v)) for t, v in tb.items()}
    tabel = pd.DataFrame(total).rename_axis("bulan").reset_index()
    return MaterializeResult(metadata={"sampai_bulan": akhir, "folder": str(folder_k1()), "luas_panen_ha_jatim": _md(tabel, 12)})


def _benih_k1(repo: Repo) -> None:
    """Run pertama: salin taksiran citra yang dikomit Danang bila folder K1 masih kosong."""
    folder_k1().mkdir(parents=True, exist_ok=True)
    for lead in k1_produksi.LEAD_HARI:
        tujuan = folder_k1() / f"est_nowcast2_lead{lead}_2026.csv"
        if not tujuan.exists():
            shutil.copy(repo.path / f"data/satelit/est_nowcast2_lead{lead}_2026.csv", tujuan)


def _wilayah(db: Database) -> pd.DataFrame:
    return db.baca("select id as wilayah_id, nama_repo as kab from ref.wilayah where level = 'KABKOTA'")


@asset(group_name=GRUP, kinds={"python", "postgres"}, deps=[AssetKey("k1_nowcast_citra"), AssetKey("silver_produksi")],
       description="K1 (Danang): produksi beras per kab/kota per bulan, model gabungan citra + klimatologi + musiman -> app.prediksi_produksi.")
def k1_prediksi_produksi(context: AssetExecutionContext, repo: Repo, db: Database, sumber_citra: SumberCitra) -> pd.DataFrame:
    _benih_k1(repo)
    hari_ini = sekarang().date()
    with model_run(db, "K1_PRODUKSI", k1_produksi.VERSI, {"hari_ini": hari_ini, "model": "scripts/k1/k1_prakiraan.py + nowcast_est2.py",
                                                         "pita": "P10-P90 dari galat relatif 0,15 (bulan berjalan) / 0,30 (prakiraan)"}) as (rid, metrik):
        pred = k1_produksi.prediksi_produksi(repo.path, hari_ini, _env_danang(repo, db, sumber_citra)).merge(_wilayah(db), on="kab")
        jatim = pred.groupby(["tahun", "bulan"]).produksi_beras_ton.sum()
        metrik.update({"wilayah": int(pred.wilayah_id.nunique()), "bulan": int(len(jatim)),
                       "produksi_jatim_ton": {f"{t}-{b:02d}": round(float(v)) for (t, b), v in jatim.items()}})
        kolom = ["wilayah_id", "tahun", "bulan", "produksi_beras_ton", "batas_bawah_ton", "batas_atas_ton"]
        sisipkan(db, "app.prediksi_produksi", pred[kolom].assign(model_run_id=rid, jenis_data=k1_produksi.JENIS_DATA))
    ringkas = jatim.div(1e3).round(0).rename("ribu_ton").reset_index()
    context.add_output_metadata({"model_run_id": rid, "versi": k1_produksi.VERSI, "baris": len(pred), "produksi_jatim": _md(ringkas, 15)})
    return pred.assign(model_run_id=rid)


@asset(group_name=GRUP, kinds={"python", "postgres"}, deps=[AssetKey("silver_penduduk"), AssetKey("silver_konsumsi"), AssetKey("silver_jarak")],
       description="K2 (Danang): neraca stok per kab/kota, arus antar kab (LP jarak jalan), pita ketidakpastian, 3 skenario P10/P50/P90 -> app.estimasi_stok.")
def k2_estimasi_stok(context: AssetExecutionContext, repo: Repo, db: Database, sumber_citra: SumberCitra,
                     k1_prediksi_produksi: pd.DataFrame) -> pd.DataFrame:
    hari_ini = sekarang().date()
    wil = _wilayah(db)
    with model_run(db, "K2_STOK", k2_stok.VERSI, {"hari_ini": hari_ini, "model": "scripts/k2/k2_operasional.py",
                                                 "k1_model_run_id": int(k1_prediksi_produksi.model_run_id.iloc[0])}) as (rid, metrik):
        h = k2_stok.estimasi_stok(repo.path, hari_ini, k1_prediksi_produksi, _env_danang(repo, db, sumber_citra))
        stok = h["skenario"].merge(wil, on="kab")
        kini = stok[(stok.skenario == "TENGAH") & (stok.tahun == hari_ini.year) & (stok.bulan == hari_ini.month)]
        segera = sorted((v, k) for k, v in h["hari_ke_defisit"].items() if v not in (None, 0))
        metrik.update({"jangkar_bulan_konsumsi": round(h["jangkar"], 3), **{f"wilayah_{s.lower()}": int((kini.status == s).sum()) for s in ("SURPLUS", "CUKUP", "TIPIS", "DEFISIT")},
                       "sudah_defisit": [k for k, v in h["hari_ke_defisit"].items() if v == 0],
                       "hari_ke_defisit": {k: round(float(v)) for v, k in segera}, "parameter": h["parameter"],
                       # arus beras antar kab (LP jarak jalan) yang dipakai neraca K2, ton per bulan; dibaca halaman Arus beras
                       "arus_antar_kab": [{"dari": r.dari, "ke": r.ke, "ton_bulan": round(float(r.ton_bulan), 1)} for r in h["arus"].itertuples()]})
        kolom = ["wilayah_id", "tahun", "bulan", "skenario", "stok_ton", "cakupan_bulan", "status", "surplus_ton", "kebutuhan_ton"]
        sisipkan(db, "app.estimasi_stok", stok[kolom].assign(model_run_id=rid, jenis_data=k2_stok.JENIS_DATA))
    context.add_output_metadata({"model_run_id": rid, "versi": k2_stok.VERSI, "baris": len(stok),
                                 **{k: v for k, v in metrik.items() if k.startswith("wilayah_")},
                                 "akan_defisit": _md(pd.DataFrame([(k, round(v)) for v, k in segera], columns=["kab", "hari"]), 12) if segera else "tidak ada",
                                 "catatan": "jangkar stok awal = asumsi (cakupan terendah Jatim 1,0 bulan); lihat ai-notes/metodologi-k2.md"})
    kons = h["konsumsi"].rename_axis("kab").reset_index()
    hari = pd.Series(h["hari_ke_defisit"], name="hari_ke_defisit", dtype=float).rename_axis("kab").reset_index()
    sd = h["rinci"][["kab", "tahun", "bulan", "sd"]]  # simpangan cakupan, dipakai K3b
    return stok.merge(kons, on="kab").merge(hari, on="kab", how="left").merge(sd, on=["kab", "tahun", "bulan"], how="left").assign(model_run_id=rid)


@asset(group_name=GRUP, kinds={"python", "postgres"}, deps=[AssetKey("silver_harga")],
       description="K3a (Danang): prakiraan harga harian 7/14/21/28 hari, P10-P90 dari galat empiris 365 hari, status terhadap HET "
                   "(scripts/k3/k3_harga_operasional.py) -> app.prediksi_harga.")
def k3_prediksi_harga(context: AssetExecutionContext, repo: Repo, db: Database, sumber_citra: SumberCitra) -> pd.DataFrame:
    wil = _wilayah(db)
    with model_run(db, "K3_HARGA", k3_harga.VERSI_K3A, {"model": "scripts/k3/k3_harga_operasional.py"}) as (rid, metrik):
        R, par = k3_harga.prediksi_harga_k3a(repo.path, _env_danang(repo, db, sumber_citra))
        with db.engine().begin() as c:  # parameter (HET, kalibrasi ambang) dibaca dasbor
            c.execute(sa.text("update app.model_run set parameter = cast(:p as jsonb) where id = :i"), {"i": rid, "p": json.dumps(par, default=str)})
        pred = (R.merge(wil, on="kab")
                 .rename(columns={"komoditas": "komoditas_id", "harga": "harga_prediksi", "p10": "batas_bawah", "p90": "batas_atas"}))
        kolom = ["wilayah_id", "komoditas_id", "tanggal_acuan", "horizon_hari", "harga_prediksi", "batas_bawah", "batas_atas", "status"]
        sisipkan(db, "app.prediksi_harga", pred[kolom].assign(model_run_id=rid, jenis_data=k3_harga.JENIS_DATA))
        metrik.update({"tanggal_acuan": str(pred.tanggal_acuan.max()),
                       **{f"h{h}_{s.lower()}": int(((pred.horizon_hari == h) & (pred.komoditas_id == 1) & (pred.status == s)).sum())
                          for h in (7, 28) for s in ("WASPADA", "SIAGA")}})
    context.add_output_metadata({"model_run_id": rid, "versi": k3_harga.VERSI_K3A, "baris": len(pred), **metrik, "contoh": _md(pred[["kab", *kolom[1:]]])})
    return pred.assign(model_run_id=rid)


@asset(group_name=GRUP, kinds={"python", "postgres"}, deps=[AssetKey("silver_jarak"), AssetKey("silver_bulog")],
       description="K3b (Danang): rencana penyaluran SPHP dari cabang Bulog ke kab/kota, bulan berjalan sampai +2, LP stokastik dari stok K2 "
                   "dan peluang harga > HET K3a (scripts/k3/k3b_sphp.py) -> app.rekomendasi_sphp.")
def k3_rekomendasi_sphp(context: AssetExecutionContext, repo: Repo, db: Database, sumber_citra: SumberCitra,
                        k2_estimasi_stok: pd.DataFrame, k3_prediksi_harga: pd.DataFrame) -> pd.DataFrame:
    hari_ini = sekarang().date()
    tengah = k2_estimasi_stok[k2_estimasi_stok.skenario == "TENGAH"]
    rinci = tengah[["kab", "tahun", "bulan", "stok_ton", "cakupan_bulan", "sd"]].rename(columns={"cakupan_bulan": "cak"})
    k3 = k3_prediksi_harga.rename(columns={"komoditas_id": "komoditas"})
    ids = _wilayah(db).set_index("kab").wilayah_id
    with model_run(db, "K3_SPHP", sphp.VERSI_K3B, {"model": "scripts/k3/k3b_sphp.py", "hari_ini": hari_ini,
                                                   "k2_model_run_id": int(k2_estimasi_stok.model_run_id.iloc[0]),
                                                   "k3_model_run_id": int(k3_prediksi_harga.model_run_id.iloc[0])}) as (rid, metrik):
        R, par = sphp.rekomendasi_k3b(repo.path, hari_ini, rinci, k3, _env_danang(repo, db, sumber_citra))
        rute = R.assign(dari_id=R.dari.map(ids), ke_id=R.ke.map(ids)).rename(columns={"jarak_km": "jarak_jalan_km"})
        kolom = ["tahun", "bulan", "dari_id", "ke_id", "volume_ton", "jarak_jalan_km"]
        sisipkan(db, "app.rekomendasi_sphp", rute[kolom].assign(model_run_id=rid, jenis_data=sphp.JENIS_DATA_K3B))
        metrik.update({"rute": len(rute), "volume_ton": round(float(rute.volume_ton.sum()), 1) if len(rute) else 0.0,
                       "periode": par.get("periode"), "metrik_uji": par.get("metrik_uji")})
    context.add_output_metadata({"model_run_id": rid, "versi": sphp.VERSI_K3B, "rute": metrik["rute"], "volume_ton": metrik["volume_ton"],
                                 "periode": ", ".join(par.get("periode", [])), "contoh": _md(R.sort_values("volume_ton", ascending=False))})
    return rute


def berkas_gkp() -> Path:
    """Prakiraan harga GKP bulanan (dibaca dasbor/API kelak)."""
    return Path(os.environ.get("TERAWANG_GKP_JSON", Path.home() / ".local/share/terawang/gkp_prakiraan.json"))


@asset(group_name=GRUP, kinds={"python", "json"},
       description="K3 GKP: prakiraan harga GKP petani Jatim bulanan 1-3 bulan, gabungan 50:50 naif + SARIMAX (log HPP + log luas panen; "
                   "luas bulan target = potensi BPS bila terbit, selain itu rata-rata musiman 3 tahun), P10-P90 dari uji mundur 36 bulan "
                   "(scripts/k3/k3_gkp_operasional.py). Per kab/kota: rata-rata naif kab dan prakiraan provinsi x rasio kab/provinsi 3 bulan. Harga Bapanas GKP petani diperbarui dulu (scripts/bapanas/ambil_panel_harga.py). "
                   "-> gkp_prakiraan.json (dibaca API /api/gkp).")
def k3_prakiraan_gkp(context: AssetExecutionContext, repo: Repo, db: Database, sumber_citra: SumberCitra) -> MaterializeResult:
    hari_ini = sekarang().date()
    folder = folder_lapisan() / "bapanas"
    # Ambil 45 hari terakhir ke cache (~/.cache/terawang-bapanas); CSV disusun dari seluruh cache. Riwayat lama tetap
    # dari berkas repo bila cache belum punya.
    mulai = (hari_ini - pd.Timedelta(days=45)).isoformat()
    if os.environ.get("TERAWANG_GKP_TANPA_AMBIL") != "1":
        try:
            repo.jalankan([sys.executable, "scripts/bapanas/ambil_panel_harga.py", "--komoditas", "1:2", "--mulai", mulai,
                           "--keluar", str(folder)], log=context.log)
        except RuntimeError as e:
            context.log.warning(f"Bapanas gagal diperbarui, pakai berkas terakhir: {e}")
    dir_bapanas = folder if (folder / "kabkota_harian_gkp_petani.csv").exists() else None
    # Tidak dicatat di app.model_run: jenis K3_HARGA dibaca bot/API sebagai run K3a terbaru (lihat bot/src/data.ts).
    R, par = k3_harga.prakiraan_gkp(repo.path, _env_danang(repo, db, sumber_citra), hari_ini=hari_ini, dir_bapanas=dir_bapanas)
    isi = {**par, "dibuat": sekarang().isoformat(timespec="seconds"), "riwayat": par.pop("riwayat", []), "prakiraan": R.to_dict(orient="records")}
    keluar = berkas_gkp()
    keluar.parent.mkdir(parents=True, exist_ok=True)
    keluar.write_text(json.dumps(isi, ensure_ascii=False, indent=1, default=str))
    return MaterializeResult(metadata={"versi": k3_harga.VERSI_K3_GKP, "bulan_acuan": par["bulan_acuan"],
                                       "harga_bulan_acuan": par["harga_bulan_acuan"], "berkas": str(keluar),
                                       "uji_mundur_mape": json.dumps(par["uji_mundur"]), "prakiraan": _md(R),
                                       "jumlah_kab": len(par["kabupaten"]), "uji_mundur_kab": json.dumps(par["uji_mundur_kab"])})


def berkas_deret() -> Path:
    """Deret satelit per kab/kota untuk dasbor (dibaca API /api/deret)."""
    return Path(os.environ.get("TERAWANG_DERET_JSON", Path.home() / ".local/share/terawang/deret_satelit.json"))


@asset(group_name=GRUP, kinds={"json"}, deps=[AssetKey("bronze_titik_satelit")],
       description="Deret 12-harian EVI, LSWI (Sentinel-2) dan VH (Sentinel-1) per kab/kota: median titik sawah, 15 akuisisi terakhir "
                   "+ rata-rata tanggal yang sama tahun-tahun sebelumnya -> deret_satelit.json (grafik profil sinyal di halaman Produksi).")
def deret_satelit_wilayah(context: AssetExecutionContext, repo: Repo, sumber_citra: SumberCitra) -> MaterializeResult:
    folder = sumber_citra.folder_titik(repo)
    s2 = pd.read_csv(folder / "s2_titik_12harian_kabkota.csv.gz")
    vh = pd.read_csv(folder / "vh_titik_12harian_kabkota.csv.gz")
    seri = {}
    for nama, df, awalan in (("evi", s2, "evi_"), ("lswi", s2, "lswi_"), ("vh", vh, "")):
        kol = [c for c in df.columns if c.startswith(awalan) and c[len(awalan):len(awalan) + 2] == "20"]
        m = df.groupby("kabkota")[kol].median()
        m.columns = pd.to_datetime([c[len(awalan):] for c in kol])
        seri[nama] = m
    n = 15
    tanggal = sorted(set(seri["evi"].columns) & set(seri["vh"].columns))[-n:] or sorted(seri["evi"].columns)[-n:]

    def nilai(m: pd.DataFrame, kab: str, t: pd.Timestamp):
        if kab not in m.index:
            return None
        cols = m.columns[(abs((m.columns - t).days) <= 6)]
        v = m.loc[kab, cols].dropna() if len(cols) else pd.Series(dtype=float)
        return round(float(v.mean()), 3) if len(v) else None

    def rata_riwayat(m: pd.DataFrame, kab: str, t: pd.Timestamp):
        xs = [nilai(m, kab, t - pd.DateOffset(years=y)) for y in (1, 2, 3)]
        xs = [x for x in xs if x is not None]
        return round(sum(xs) / len(xs), 3) if xs else None

    wilayah = {}
    for kab in seri["evi"].index.union(seri["vh"].index):
        w = {}
        for nama, m in seri.items():
            w[nama] = [nilai(m, kab, t) for t in tanggal]
            w[nama + "Avg"] = [rata_riwayat(m, kab, t) for t in tanggal]
        wilayah[kab] = w
    keluar = berkas_deret()
    keluar.parent.mkdir(parents=True, exist_ok=True)
    data = {"dibuat": sekarang().isoformat(timespec="seconds"), "tanggal": [t.date().isoformat() for t in tanggal],
            "sumber": "median titik sawah (scripts/gee, Sentinel-1 VH dB; Sentinel-2 EVI/LSWI), rata-rata = tanggal sama 1-3 tahun sebelumnya",
            "wilayah": wilayah}
    tmp = keluar.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False))
    tmp.replace(keluar)
    return MaterializeResult(metadata={"berkas": str(keluar), "wilayah": len(wilayah), "tanggal_awal": data["tanggal"][0],
                                       "tanggal_akhir": data["tanggal"][-1]})
