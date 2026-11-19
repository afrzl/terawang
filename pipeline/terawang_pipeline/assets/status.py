"""Lapisan APP akhir: status gabungan per kab/kota dan peringatan, yang dibaca dasbor dan bot WhatsApp."""

import json

import pandas as pd
import sqlalchemy as sa
from dagster import AssetExecutionContext, asset

from ..resources import Database
from ._app import sekarang, sisipkan

GRUP = "app"
TINGKAT = {"AMAN": 0, "WASPADA": 1, "SIAGA": 2}
STOK_KE_TINGKAT = {"CUKUP": "AMAN", "TIPIS": "WASPADA", "DEFISIT": "SIAGA"}


def _terburuk(*nilai) -> str:
    ada = [v for v in nilai if isinstance(v, str)]
    return max(ada, key=TINGKAT.get) if ada else "AMAN"


@asset(group_name=GRUP, kinds={"postgres"}, description="Status gabungan per kab/kota hari ini -> app.status_wilayah.")
def status_wilayah(context: AssetExecutionContext, db: Database, k1_prediksi_produksi: pd.DataFrame,
                   k2_estimasi_stok: pd.DataFrame, k3_prediksi_harga: pd.DataFrame) -> pd.DataFrame:
    kini = sekarang()
    medium = int(db.baca("select id from ref.komoditas where kode = 'beras_medium'")["id"].iloc[0])
    prod = k1_prediksi_produksi[(k1_prediksi_produksi.tahun == kini.year) & (k1_prediksi_produksi.bulan == kini.month)]
    stok = k2_estimasi_stok[(k2_estimasi_stok.skenario == "TENGAH") & (k2_estimasi_stok.tahun == kini.year) & (k2_estimasi_stok.bulan == kini.month)]
    h = k3_prediksi_harga[(k3_prediksi_harga.komoditas_id == medium) & (k3_prediksi_harga.horizon_hari == 28)]
    terkini = db.baca("""select distinct on (wilayah_id) wilayah_id, harga_rata2_rp_kg as harga_terkini_rp_kg
                         from silver.harga_kabkota_harian where komoditas_id = :k and harga_rata2_rp_kg is not null
                         order by wilayah_id, tanggal desc""", k=medium)
    df = (stok[["wilayah_id", "cakupan_bulan", "status", "model_run_id"]].rename(columns={"status": "status_stok", "model_run_id": "run_stok_id"})
          .merge(prod[["wilayah_id", "produksi_beras_ton", "model_run_id"]].rename(columns={"produksi_beras_ton": "produksi_estimasi_ton", "model_run_id": "run_produksi_id"}), on="wilayah_id", how="left")
          .merge(h[["wilayah_id", "harga_prediksi", "status", "model_run_id"]].rename(columns={"harga_prediksi": "harga_prediksi_rp_kg", "status": "status_harga", "model_run_id": "run_harga_id"}), on="wilayah_id", how="left")
          .merge(terkini, on="wilayah_id", how="left")
          .rename(columns={"cakupan_bulan": "cakupan_stok_bulan"}))
    df["status_gabungan"] = [_terburuk(STOK_KE_TINGKAT.get(r.status_stok), r.status_harga) for r in df.itertuples()]
    df["tanggal"] = kini.date()
    df["jenis_data"] = "MODEL"
    with db.engine().begin() as c:
        c.execute(sa.text("delete from app.status_wilayah where tanggal = :t"), {"t": kini.date()})  # idempoten per hari
    sisipkan(db, "app.status_wilayah", df.astype({"run_produksi_id": "Int64", "run_harga_id": "Int64"}))
    hitung = df["status_gabungan"].value_counts().to_dict()
    context.add_output_metadata({"tanggal": str(kini.date()), **{f"wilayah_{k.lower()}": int(v) for k, v in hitung.items()}})
    return df


@asset(group_name=GRUP, kinds={"postgres"}, description="Peringatan aktif (stok dan harga) untuk dasbor dan siaran bot -> app.peringatan.")
def peringatan(context: AssetExecutionContext, db: Database, status_wilayah: pd.DataFrame) -> None:
    nama = db.baca("select id as wilayah_id, nama from ref.wilayah")
    s = status_wilayah.merge(nama, on="wilayah_id")
    baris = []
    for r in s.itertuples():
        stok_t = STOK_KE_TINGKAT.get(r.status_stok)
        if stok_t in ("WASPADA", "SIAGA"):
            baris.append(dict(wilayah_id=r.wilayah_id, jenis="STOK", tingkat=stok_t, model_run_id=r.run_stok_id,
                              judul=f"Stok beras {r.nama} {r.status_stok.lower()}",
                              pesan=f"Perkiraan cakupan stok {r.cakupan_stok_bulan:.1f} bulan konsumsi (skenario tengah, stok awal dummy).",
                              dasar=json.dumps({"cakupan_bulan": round(float(r.cakupan_stok_bulan), 2)})))
        if r.status_harga in ("WASPADA", "SIAGA"):
            baris.append(dict(wilayah_id=r.wilayah_id, jenis="HARGA", tingkat=r.status_harga, model_run_id=int(r.run_harga_id),
                              judul=f"Harga beras medium {r.nama} {r.status_harga.lower()}",
                              pesan=f"Prediksi 4 minggu Rp{r.harga_prediksi_rp_kg:,.0f}/kg (terkini Rp{r.harga_terkini_rp_kg:,.0f}).".replace(",", "."),
                              dasar=json.dumps({"harga_prediksi": round(float(r.harga_prediksi_rp_kg)), "harga_terkini": float(r.harga_terkini_rp_kg)})))
    with db.engine().begin() as c:
        # peringatan lama dari pipeline yang belum ditangani diganti yang baru
        c.execute(sa.text("update app.peringatan set status = 'SELESAI' where status = 'AKTIF' and model_run_id is not null"))
    df = pd.DataFrame(baris)
    if not df.empty:
        df["berlaku_sampai"] = sekarang().replace(tzinfo=None) + pd.Timedelta(days=7)
        with db.engine().begin() as c:
            for r in df.to_dict("records"):
                c.execute(sa.text("""insert into app.peringatan (wilayah_id, jenis, tingkat, judul, pesan, dasar, model_run_id, berlaku_sampai)
                                     values (:wilayah_id, :jenis, :tingkat, :judul, :pesan, cast(:dasar as jsonb), :model_run_id, :berlaku_sampai)"""), r)
    context.add_output_metadata({"peringatan_aktif": len(df),
                                 **({f"jenis_{k.lower()}": int(v) for k, v in df["jenis"].value_counts().items()} if len(df) else {})})
