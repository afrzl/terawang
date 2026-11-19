"""Lapisan MODEL -> APP: memanggil fungsi model di terawang_models (milik Danang), menulis hasil ke schema app.

Aset di sini tidak berisi logika model. Tugasnya: ambil masukan dari silver, panggil fungsi, catat app.model_run,
simpan keluaran. Mengganti model = mengganti isi terawang_models, tanpa mengubah file ini.
"""

import pandas as pd
from dagster import AssetExecutionContext, AssetKey, MetadataValue, asset

from terawang_models import k1_produksi, k2_stok, k3_harga, sphp

from ..resources import Database
from ._app import model_run, sekarang, sisipkan

GRUP = "model"
HET_CADANGAN = {"beras_medium": 13500}  # BELUM DIVERIFIKASI (lihat ai-notes/01-aturan-data.md); dipakai kalau app.ambang_harga kosong


def _bulan_target(n_depan: int = 3) -> list[tuple[int, int]]:
    """Jan tahun berjalan sampai bulan ini + n_depan - 1 (agar neraca K2 bersambung dari data BPS tahun lalu)."""
    kini = sekarang()
    akhir = pd.Period(year=kini.year, month=kini.month, freq="M") + (n_depan - 1)
    return [(p.year, p.month) for p in pd.period_range(f"{kini.year}-01", akhir, freq="M")]


def _md(df: pd.DataFrame, n: int = 10) -> MetadataValue:
    return MetadataValue.md("```\n" + df.head(n).to_string(index=False) + "\n```")


@asset(group_name=GRUP, kinds={"python", "postgres"}, deps=[AssetKey("silver_produksi"), AssetKey("silver_satelit")],
       description="K1: produksi beras bulanan per kab/kota -> app.prediksi_produksi.")
def k1_prediksi_produksi(context: AssetExecutionContext, db: Database) -> pd.DataFrame:
    hist = db.baca("""
        select p.wilayah_id, p.tahun, p.bulan_awal as bulan, p.produksi_beras_ton
        from silver.produksi_padi p join ref.wilayah w on w.id = p.wilayah_id
        where p.granularitas = 'BULANAN' and p.bulan_awal = p.bulan_akhir and w.level = 'KABKOTA'
    """)
    target = _bulan_target()
    with model_run(db, "K1_PRODUKSI", k1_produksi.VERSI, {"bulan_target": target}) as (rid, metrik):
        bagian = [k1_produksi.prediksi_produksi(hist, th, [b for t, b in target if t == th]) for th in sorted({t for t, _ in target})]
        pred = pd.concat(bagian, ignore_index=True)
        metrik.update({"wilayah": int(pred["wilayah_id"].nunique()), "bulan": len(target)})
        sisipkan(db, "app.prediksi_produksi", pred.assign(model_run_id=rid, jenis_data=k1_produksi.JENIS_DATA))
    context.add_output_metadata({"model_run_id": rid, "versi": k1_produksi.VERSI, "baris": len(pred), "contoh": _md(pred)})
    # riwayat BPS (tahun lalu) + prediksi tahun berjalan = deret produksi lengkap untuk K2
    deret = pd.concat([hist[hist["tahun"] < target[0][0]], pred[hist.columns]], ignore_index=True)
    return deret.assign(model_run_id=rid)


@asset(group_name=GRUP, kinds={"python", "postgres"}, deps=[AssetKey("silver_penduduk"), AssetKey("silver_konsumsi"), AssetKey("silver_bulog")],
       description="K2: neraca stok per kab/kota per bulan, 3 skenario stok awal -> app.estimasi_stok.")
def k2_estimasi_stok(context: AssetExecutionContext, db: Database, k1_prediksi_produksi: pd.DataFrame) -> pd.DataFrame:
    kons = db.baca("""
        select p.wilayah_id, p.jumlah_jiwa * k.kg_per_kapita * 30.0 / 7 / 1000 as konsumsi_ton_bulan
        from silver.penduduk p
        join silver.konsumsi_beras k on k.wilayah_id = p.wilayah_id and k.satuan = 'KG_KAPITA_MINGGU' and k.klasifikasi = 'TOTAL'
        where p.tahun = (select max(tahun) from silver.penduduk)
    """)
    with model_run(db, "K2_STOK", k2_stok.VERSI, {"skenario_stok_awal_bulan": k2_stok.SKENARIO_STOK_AWAL_BULAN}) as (rid, metrik):
        stok = k2_stok.estimasi_stok(k1_prediksi_produksi.drop(columns="model_run_id"), kons)
        kini = sekarang()
        tengah = stok[(stok.skenario == "TENGAH") & (stok.tahun == kini.year) & (stok.bulan == kini.month)]
        metrik.update({f"wilayah_{s.lower()}": int((tengah.status == s).sum()) for s in ("CUKUP", "TIPIS", "DEFISIT")})
        sisipkan(db, "app.estimasi_stok", stok.assign(model_run_id=rid, jenis_data=k2_stok.JENIS_DATA))
    context.add_output_metadata({"model_run_id": rid, "versi": k2_stok.VERSI, "baris": len(stok), **metrik,
                                 "catatan": "stok awal = DUMMY; tanpa arus antarwilayah"})
    return stok.merge(kons, on="wilayah_id").assign(model_run_id=rid)


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
