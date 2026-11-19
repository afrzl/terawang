"""Titik masuk Dagster: semua aset, job, jadwal, dan sensor TERAWANG."""

from dagster import (AssetSelection, DefaultScheduleStatus, DefaultSensorStatus, Definitions, RunRequest, ScheduleDefinition,
                     SensorEvaluationContext, SkipReason, define_asset_job, load_assets_from_modules, sensor)

from .assets import bronze, model, silver, status
from .resources import semua_resource

ASET = load_assets_from_modules([bronze, silver, model, status])

# Seluruh alur, dari sumber sampai peringatan.
job_penuh = define_asset_job("pipeline_penuh", selection=AssetSelection.all(), description="Semua sumber -> silver -> K1, K2, K3, SPHP -> status dan peringatan.")

# Harian: hanya yang bergantung pada harga. Stok dan produksi dipakai dari run terakhir lewat input upstream.
job_harga = define_asset_job(
    "pipeline_harga_harian",
    selection=AssetSelection.assets("bronze_harga").downstream() | AssetSelection.assets("k1_prediksi_produksi", "k2_estimasi_stok"),
    description="Ambil harga terbaru -> silver harga -> K3 -> status dan peringatan.",
)

jadwal_harian = ScheduleDefinition(name="harga_harian_0600_wib", job=job_harga, cron_schedule="0 6 * * *",
                                   execution_timezone="Asia/Jakarta", default_status=DefaultScheduleStatus.RUNNING)
jadwal_mingguan = ScheduleDefinition(name="penuh_senin_0500_wib", job=job_penuh, cron_schedule="0 5 * * 1",
                                     execution_timezone="Asia/Jakarta", default_status=DefaultScheduleStatus.RUNNING)


@sensor(job=job_penuh, minimum_interval_seconds=300, default_status=DefaultSensorStatus.RUNNING,
        description="Jalankan ulang alur penuh kalau berkas BPS, Bulog, jarak, atau citra di repo berubah (mis. setelah git pull).")
def sensor_berkas_data(context: SensorEvaluationContext):
    repo = semua_resource()["repo"]
    paths = [p for rel in bronze.BERKAS_STATIS.values() for p in bronze.berkas_di(repo, rel)]
    paths.append(repo.path / "src/lib/gee_wilayah.json")
    cs = bronze.checksum_gabungan([p for p in paths if p.exists()])[:16]
    if context.cursor == cs:
        return SkipReason("berkas data tidak berubah")
    pertama = context.cursor is None
    context.update_cursor(cs)
    if pertama:
        return SkipReason("checksum awal dicatat")
    return RunRequest(run_key=cs)


defs = Definitions(assets=ASET, jobs=[job_penuh, job_harga], schedules=[jadwal_harian, jadwal_mingguan],
                   sensors=[sensor_berkas_data], resources=semua_resource())
