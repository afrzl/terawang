"""Titik masuk Dagster: semua aset, job, jadwal, dan sensor TERAWANG."""

from dagster import (AssetSelection, DefaultScheduleStatus, DefaultSensorStatus, Definitions, RunRequest, ScheduleDefinition,
                     SensorEvaluationContext, SkipReason, define_asset_job, load_assets_from_modules, sensor)

from .assets import bronze, model, silver, status
from .resources import folder_manual, semua_resource

ASET = load_assets_from_modules([bronze, silver, model, status])

# Semua job masuk satu antrean: run berikutnya menunggu run yang sedang jalan selesai (batas di DAGSTER_HOME/dagster.yaml,
# run_queue.tag_concurrency_limits, ditulis deploy-pipeline.sh). Tanpa ini job harian dan pipeline_penuh dari sensor bisa menulis
# silver_harga bersamaan dan gagal "Unique constraint failed".
ANTREAN = {"terawang/antrean": "pipeline"}

# Seluruh alur, dari sumber sampai peringatan.
job_penuh = define_asset_job("pipeline_penuh", selection=AssetSelection.all(), tags=ANTREAN, description="Semua sumber -> silver -> K1, K2, K3, SPHP -> status dan peringatan.")

# Harian: hanya yang bergantung pada harga. Stok dan produksi dipakai dari run terakhir lewat input upstream.
job_harga = define_asset_job(
    "pipeline_harga_harian",
    tags=ANTREAN,
    selection=AssetSelection.assets("bronze_harga", "bronze_bapanas").downstream() | AssetSelection.assets("k1_prediksi_produksi", "k2_estimasi_stok"),
    description="Ambil harga terbaru -> silver harga -> K3 -> status dan peringatan.",
)

# Citra baru: bronze_citra dan turunannya (K1 -> K2 -> SPHP, status, peringatan). K3 ikut agar status lengkap.
job_citra = define_asset_job(
    "pipeline_citra",
    tags=ANTREAN,
    selection=AssetSelection.assets("bronze_citra", "bronze_titik_satelit", "bronze_iklim").downstream() | AssetSelection.assets("k3_prediksi_harga"),
    description="Citra Sentinel terbaru dari GEE -> silver satelit dan deret titik sawah -> K1 (nowcast citra, produksi), K2, SPHP -> status dan peringatan.",
)

# SISKAPERBAPO memperbarui harga sepanjang hari, jadi diambil pagi dan siang.
jadwal_harian = ScheduleDefinition(name="harga_0600_1400_wib", job=job_harga, cron_schedule="0 6,14 * * *",
                                   execution_timezone="Asia/Jakarta", default_status=DefaultScheduleStatus.RUNNING)
jadwal_mingguan = ScheduleDefinition(name="penuh_senin_0500_wib", job=job_penuh, cron_schedule="0 5 * * 1",
                                     execution_timezone="Asia/Jakarta", default_status=DefaultScheduleStatus.RUNNING)


@sensor(job=job_penuh, minimum_interval_seconds=300, default_status=DefaultSensorStatus.RUNNING,
        description="Jalankan ulang alur penuh kalau berkas BPS, Bulog, jarak, atau bahan citra K1 di repo berubah (mis. setelah git pull), "
                    "atau ada unggahan manual baru di TERAWANG_MANUAL_DIR.")
def sensor_berkas_data(context: SensorEvaluationContext):
    res = semua_resource()
    repo = res["repo"]
    paths = [p for rel in bronze.BERKAS_STATIS.values() for p in bronze.berkas_di(repo, rel)] + [repo.path / p for p in bronze.SATELIT_STATIS]
    if res["sumber_citra"].mode == "berkas":  # mode gee dipantau sensor_citra_baru
        paths += [repo.path / "src/lib/gee_wilayah.json"] + [repo.path / "data/satelit" / b for b in res["sumber_citra"].TITIK]
    manual = folder_manual()
    if manual.is_dir():  # unggahan halaman admin (folder _arsip dan berkas _log diabaikan)
        paths += sorted(p for p in manual.rglob("*") if p.is_file() and not any(b.startswith((".", "_")) for b in p.relative_to(manual).parts))
    cs = bronze.checksum_gabungan([p for p in paths if p.exists()])[:16]
    if context.cursor == cs:
        return SkipReason("berkas data tidak berubah")
    pertama = context.cursor is None
    context.update_cursor(cs)
    if pertama:
        return SkipReason("checksum awal dicatat")
    return RunRequest(run_key=cs)


@sensor(job=job_citra, minimum_interval_seconds=6 * 3600, default_status=DefaultSensorStatus.RUNNING,
        description="Cek GEE tiap 6 jam; kalau ada akuisisi Sentinel-1 baru di Jawa Timur, jalankan pipeline_citra. Aktif bila TERAWANG_SUMBER_CITRA=gee.")
def sensor_citra_baru(context: SensorEvaluationContext):
    citra = semua_resource()["sumber_citra"]
    if citra.mode != "gee":
        return SkipReason("TERAWANG_SUMBER_CITRA bukan gee; citra dibaca dari berkas")
    terbaru = citra.citra_terbaru()
    if context.cursor == terbaru:
        return SkipReason(f"belum ada citra baru (terakhir {terbaru})")
    context.update_cursor(terbaru)
    return RunRequest(run_key=f"citra-{terbaru}", tags={"citra_acuan": terbaru})


defs = Definitions(assets=ASET, jobs=[job_penuh, job_harga, job_citra], schedules=[jadwal_harian, jadwal_mingguan],
                   sensors=[sensor_berkas_data, sensor_citra_baru], resources=semua_resource())
