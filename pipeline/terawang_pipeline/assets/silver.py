"""Lapisan SILVER: tabel bersih di Postgres, dimuat oleh ingest milik api/ (`npm run ingest <modul>`).

Pipeline tidak menulis ulang logika ingest; ia hanya memanggilnya dalam urutan yang benar dan mencatat hasilnya.
Setiap modul ingest idempoten dan memeriksa hasilnya terhadap total di sumber (gagal = aset merah).
"""

from dagster import AssetExecutionContext, AssetKey, MaterializeResult, asset

from ..resources import Database, Repo

GRUP = "silver"


def _ingest(context: AssetExecutionContext, repo: Repo, db: Database, modul: str, tabel: list[str]) -> MaterializeResult:
    keluaran = repo.jalankan(["npm", "run", "--silent", "ingest", modul], cwd="api", env={"DATABASE_URL": db.url}, log=context.log)
    jumlah = {t: int(db.baca(f"select count(*) as n from {t}")["n"].iloc[0]) for t in tabel}
    cek = sum(1 for b in keluaran.splitlines() if b.strip().startswith("OK"))
    return MaterializeResult(metadata={"pemeriksaan_lolos": cek, **{f"baris {t}": n for t, n in jumlah.items()}})


def _aset_silver(nama: str, modul: str, bronze: list[str], tabel: list[str], ket: str, ref: bool = True):
    deps = [AssetKey(b) for b in bronze] + ([AssetKey("silver_ref")] if ref else [])

    @asset(name=nama, group_name=GRUP, kinds={"postgres"}, deps=deps, description=ket)
    def _f(context: AssetExecutionContext, repo: Repo, db: Database) -> MaterializeResult:
        return _ingest(context, repo, db, modul, tabel)

    return _f


silver_ref = _aset_silver("silver_ref", "ref", ["bronze_bps"], ["ref.wilayah", "ref.sumber", "ref.komoditas"],
                          "Dimensi bersama: wilayah (77), komoditas, daftar sumber.", ref=False)
silver_penduduk = _aset_silver("silver_penduduk", "penduduk", ["bronze_bps"], ["silver.penduduk"], "Penduduk per kab/kota (BPS).")
silver_konsumsi = _aset_silver("silver_konsumsi", "konsumsi", ["bronze_bps"], ["silver.konsumsi_beras"], "Konsumsi beras per kapita (Susenas).")
silver_produksi = _aset_silver("silver_produksi", "produksi", ["bronze_bps"], ["silver.produksi_padi"], "Luas panen dan produksi padi (BPS).")
silver_satelit = _aset_silver("silver_satelit", "satelit", ["bronze_citra"], ["silver.satelit_wilayah"], "Olahan citra per wilayah.")
silver_bulog = _aset_silver("silver_bulog", "bulog", ["bronze_bulog"], ["silver.stok_bulog_bulanan", "silver.pengadaan_bulog"], "Stok dan pengadaan Bulog.")
silver_harga = _aset_silver("silver_harga", "harga", ["bronze_harga"], ["silver.harga_kabkota_harian", "silver.harga_pasar_harian"],
                            "Harga beras harian per pasar dan per kab/kota.")
silver_jarak = _aset_silver("silver_jarak", "jarak", ["bronze_jarak"], ["silver.jarak_antar_wilayah"], "Jarak jalan antar kab/kota.")

SEMUA = [silver_ref, silver_penduduk, silver_konsumsi, silver_produksi, silver_satelit, silver_bulog, silver_harga, silver_jarak]
