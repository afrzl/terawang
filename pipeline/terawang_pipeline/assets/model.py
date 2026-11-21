"""Lapisan MODEL -> APP: memanggil fungsi model di terawang_models (milik Danang), menulis hasil ke schema app.

Aset di sini tidak berisi logika model. Tugasnya: ambil masukan, panggil model, catat app.model_run, simpan keluaran.
K1 dan K2 memanggil skrip asli Danang (scripts/k1, scripts/k2) lewat terawang_models.k1_produksi / k2_stok;
K3 dan SPHP masih baseline di terawang_models.
"""

import os
import shutil
import sys
from pathlib import Path

import pandas as pd
from dagster import AssetExecutionContext, AssetKey, MaterializeResult, MetadataValue, asset

from terawang_models import k1_produksi, k2_stok, k3_harga, sphp

from ..resources import Database, Repo, SumberCitra
from ._app import model_run, sekarang, sisipkan

GRUP = "model"
HET_CADANGAN = {"beras_medium": 13500}  # BELUM DIVERIFIKASI (lihat ai-notes/01-aturan-data.md); dipakai kalau app.ambang_harga kosong


def _md(df: pd.DataFrame, n: int = 10) -> MetadataValue:
    return MetadataValue.md("```\n" + df.head(n).to_string(index=False) + "\n```")


def folder_k1() -> Path:
    """Taksiran citra K1 bulan operasional (est_nowcast2_lead*_2026.csv), di luar repo supaya worktree git tetap bersih."""
    return Path(os.environ.get("TERAWANG_K1_DIR", Path.home() / ".local/share/terawang/k1"))


def _env_danang(repo: Repo, db: Database, sumber_citra: SumberCitra) -> dict[str, str]:
    return {"DATABASE_URL": db.url, "TERAWANG_K1_DIR": str(folder_k1()), "TERAWANG_TITIK_DIR": str(sumber_citra.folder_titik(repo))}


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
                       "hari_ke_defisit": {k: round(float(v)) for v, k in segera}, "parameter": h["parameter"]})
        kolom = ["wilayah_id", "tahun", "bulan", "skenario", "stok_ton", "cakupan_bulan", "status", "surplus_ton", "kebutuhan_ton"]
        sisipkan(db, "app.estimasi_stok", stok[kolom].assign(model_run_id=rid, jenis_data=k2_stok.JENIS_DATA))
    context.add_output_metadata({"model_run_id": rid, "versi": k2_stok.VERSI, "baris": len(stok),
                                 **{k: v for k, v in metrik.items() if k.startswith("wilayah_")},
                                 "akan_defisit": _md(pd.DataFrame([(k, round(v)) for v, k in segera], columns=["kab", "hari"]), 12) if segera else "tidak ada",
                                 "catatan": "jangkar stok awal = asumsi (cakupan terendah Jatim 1,0 bulan); lihat ai-notes/metodologi-k2.md"})
    kons = h["konsumsi"].rename_axis("kab").reset_index()
    hari = pd.Series(h["hari_ke_defisit"], name="hari_ke_defisit", dtype=float).rename_axis("kab").reset_index()
    return stok.merge(kons, on="kab").merge(hari, on="kab", how="left").assign(model_run_id=rid)


def _het(db: Database) -> dict[int, float]:
    kom = db.baca("select id, kode from ref.komoditas")
    resmi = db.baca("select komoditas_id, het_rp_kg from app.ambang_harga where wilayah_id is null and berlaku_sampai is null")
    het = dict(zip(resmi.komoditas_id, resmi.het_rp_kg.astype(float)))
    for r in kom.itertuples():
        if r.id not in het and r.kode in HET_CADANGAN:
            het[r.id] = float(HET_CADANGAN[r.kode])
    return het


@asset(group_name=GRUP, kinds={"python", "postgres"}, deps=[AssetKey("silver_harga")],
       description="K3: prediksi harga 14 dan 28 hari + backtest MAPE -> app.prediksi_harga.")
def k3_prediksi_harga(context: AssetExecutionContext, db: Database) -> pd.DataFrame:
    harga = db.baca("""
        select wilayah_id, komoditas_id, tanggal, harga_rata2_rp_kg as harga
        from silver.harga_kabkota_harian where tanggal >= (select max(tanggal) from silver.harga_kabkota_harian) - interval '3 years'
    """)
    het = _het(db)
    with model_run(db, "K3_HARGA", k3_harga.VERSI, {"horizon_hari": k3_harga.HORIZON_HARI, "het": het}) as (rid, metrik):
        pred = k3_harga.prediksi_harga(harga)
        pred["status"] = [k3_harga.status_harga(r.harga_prediksi, het.get(r.komoditas_id)) for r in pred.itertuples()]
        metrik.update(k3_harga.backtest_naif(harga))
        sisipkan(db, "app.prediksi_harga", pred.assign(model_run_id=rid, jenis_data=k3_harga.JENIS_DATA))
    context.add_output_metadata({"model_run_id": rid, "versi": k3_harga.VERSI, "baris": len(pred), **metrik,
                                 "tanggal_acuan": str(pred["tanggal_acuan"].max()), "contoh": _md(pred)})
    return pred.assign(model_run_id=rid)


@asset(group_name=GRUP, kinds={"python", "postgres"}, deps=[AssetKey("silver_jarak")],
       description="SPHP: rute penyaluran dari wilayah surplus ke defisit -> app.rekomendasi_sphp.")
def k3_rekomendasi_sphp(context: AssetExecutionContext, db: Database, k2_estimasi_stok: pd.DataFrame) -> pd.DataFrame:
    kini = sekarang()
    s = k2_estimasi_stok
    s = s[(s.skenario == "TENGAH") & (s.tahun == kini.year) & (s.bulan == kini.month)]
    saldo = s.assign(saldo_ton=s.stok_ton - s.konsumsi_ton_bulan)[["wilayah_id", "saldo_ton"]]  # sisakan 1 bulan konsumsi
    jarak = db.baca("select dari_id, ke_id, jarak_jalan_km from silver.jarak_antar_wilayah where dari_id <> ke_id")
    with model_run(db, "K3_SPHP", sphp.VERSI, {"tahun": kini.year, "bulan": kini.month, "cadangan_bulan": 1}) as (rid, metrik):
        rute = sphp.rekomendasi_sphp(saldo, jarak)
        metrik.update({"rute": len(rute), "volume_ton": round(float(rute.volume_ton.sum()), 1) if len(rute) else 0.0})
        sisipkan(db, "app.rekomendasi_sphp", rute.assign(model_run_id=rid, tahun=kini.year, bulan=kini.month, jenis_data=sphp.JENIS_DATA))
    context.add_output_metadata({"model_run_id": rid, "versi": sphp.VERSI, **metrik})
    return rute
