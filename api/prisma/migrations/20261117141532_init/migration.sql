-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "app";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "ref";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "silver";

-- CreateEnum
CREATE TYPE "app"."SkenarioStok" AS ENUM ('RENDAH', 'TENGAH', 'TINGGI');

-- CreateEnum
CREATE TYPE "app"."StatusStok" AS ENUM ('CUKUP', 'TIPIS', 'DEFISIT');

-- CreateEnum
CREATE TYPE "app"."TingkatStatus" AS ENUM ('AMAN', 'WASPADA', 'SIAGA');

-- CreateEnum
CREATE TYPE "app"."JenisModel" AS ENUM ('K1_PRODUKSI', 'K2_STOK', 'K3_HARGA', 'K3_SPHP');

-- CreateEnum
CREATE TYPE "app"."TipeOrganisasi" AS ENUM ('DINAS_KETAHANAN_PANGAN', 'DINAS_PERTANIAN', 'TPID', 'BULOG', 'PENGGILINGAN', 'PEDAGANG_BESAR', 'LAINNYA');

-- CreateEnum
CREATE TYPE "app"."PeranPengguna" AS ENUM ('ADMIN', 'ANALIS', 'PEMANTAU');

-- CreateEnum
CREATE TYPE "app"."JenisPeringatan" AS ENUM ('HARGA', 'STOK', 'PRODUKSI', 'PERTANAMAN');

-- CreateEnum
CREATE TYPE "app"."TingkatPeringatan" AS ENUM ('WASPADA', 'SIAGA');

-- CreateEnum
CREATE TYPE "app"."StatusPeringatan" AS ENUM ('AKTIF', 'DITANGANI', 'SELESAI', 'DIABAIKAN');

-- CreateEnum
CREATE TYPE "app"."KanalNotifikasi" AS ENUM ('WHATSAPP', 'EMAIL', 'DASHBOARD');

-- CreateEnum
CREATE TYPE "app"."StatusKirim" AS ENUM ('ANTRE', 'TERKIRIM', 'DIBACA', 'GAGAL');

-- CreateEnum
CREATE TYPE "app"."ArahPesan" AS ENUM ('MASUK', 'KELUAR');

-- CreateEnum
CREATE TYPE "app"."StatusLangganan" AS ENUM ('AKTIF', 'BERHENTI', 'KEDALUWARSA');

-- CreateEnum
CREATE TYPE "ref"."JenisData" AS ENUM ('ASLI', 'MODEL', 'DUMMY');

-- CreateEnum
CREATE TYPE "ref"."LevelWilayah" AS ENUM ('NASIONAL', 'PROVINSI', 'KABKOTA');

-- CreateEnum
CREATE TYPE "ref"."JenisWilayah" AS ENUM ('KABUPATEN', 'KOTA');

-- CreateEnum
CREATE TYPE "ref"."StatusRun" AS ENUM ('BERJALAN', 'SELESAI', 'GAGAL');

-- CreateEnum
CREATE TYPE "silver"."StatusAngka" AS ENUM ('TETAP', 'SEMENTARA', 'POTENSI');

-- CreateEnum
CREATE TYPE "silver"."Granularitas" AS ENUM ('BULANAN', 'PERIODE', 'TAHUNAN');

-- CreateEnum
CREATE TYPE "silver"."JenisAngkaPenduduk" AS ENUM ('HASIL_SENSUS', 'PROYEKSI');

-- CreateEnum
CREATE TYPE "silver"."PutaranSusenas" AS ENUM ('MARET', 'SEPTEMBER');

-- CreateEnum
CREATE TYPE "silver"."SatuanKonsumsi" AS ENUM ('KG_KAPITA_MINGGU', 'KG_KAPITA_BULAN');

-- CreateEnum
CREATE TYPE "silver"."KlasifikasiDaerah" AS ENUM ('TOTAL', 'KOTA', 'DESA');

-- CreateEnum
CREATE TYPE "silver"."SaluranPengadaan" AS ENUM ('KUD', 'NON_KUD_KTNA', 'SATGAS_UPGB_DRAYING');

-- CreateTable
CREATE TABLE "app"."ambang_harga" (
    "id" SERIAL NOT NULL,
    "komoditas_id" INTEGER NOT NULL,
    "wilayah_id" INTEGER,
    "berlaku_dari" DATE NOT NULL,
    "berlaku_sampai" DATE,
    "het_rp_kg" INTEGER NOT NULL,
    "ambang_waspada_pct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ambang_siaga_pct" DOUBLE PRECISION NOT NULL DEFAULT 5,
    "jenis_data" "ref"."JenisData" NOT NULL DEFAULT 'ASLI',
    "sumber_id" INTEGER,
    "catatan" TEXT,

    CONSTRAINT "ambang_harga_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."model_run" (
    "id" SERIAL NOT NULL,
    "jenis" "app"."JenisModel" NOT NULL,
    "nama_versi" TEXT NOT NULL,
    "mlflow_run_id" TEXT,
    "parameter" JSONB,
    "metrik" JSONB,
    "status" "ref"."StatusRun" NOT NULL DEFAULT 'SELESAI',
    "dibuat_pada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "selesai_pada" TIMESTAMP(3),

    CONSTRAINT "model_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."prediksi_produksi" (
    "id" SERIAL NOT NULL,
    "model_run_id" INTEGER NOT NULL,
    "wilayah_id" INTEGER NOT NULL,
    "tahun" INTEGER NOT NULL,
    "bulan" INTEGER NOT NULL,
    "produksi_beras_ton" DOUBLE PRECISION NOT NULL,
    "batas_bawah_ton" DOUBLE PRECISION,
    "batas_atas_ton" DOUBLE PRECISION,
    "jenis_data" "ref"."JenisData" NOT NULL DEFAULT 'MODEL',

    CONSTRAINT "prediksi_produksi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."estimasi_stok" (
    "id" SERIAL NOT NULL,
    "model_run_id" INTEGER NOT NULL,
    "wilayah_id" INTEGER NOT NULL,
    "tahun" INTEGER NOT NULL,
    "bulan" INTEGER NOT NULL,
    "skenario" "app"."SkenarioStok" NOT NULL,
    "stok_ton" DOUBLE PRECISION NOT NULL,
    "cakupan_bulan" DOUBLE PRECISION,
    "status" "app"."StatusStok",
    "jenis_data" "ref"."JenisData" NOT NULL DEFAULT 'MODEL',

    CONSTRAINT "estimasi_stok_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."prediksi_harga" (
    "id" SERIAL NOT NULL,
    "model_run_id" INTEGER NOT NULL,
    "wilayah_id" INTEGER NOT NULL,
    "komoditas_id" INTEGER NOT NULL,
    "tanggal_acuan" DATE NOT NULL,
    "horizon_hari" INTEGER NOT NULL,
    "harga_prediksi" DOUBLE PRECISION NOT NULL,
    "batas_bawah" DOUBLE PRECISION,
    "batas_atas" DOUBLE PRECISION,
    "status" "app"."TingkatStatus",
    "jenis_data" "ref"."JenisData" NOT NULL DEFAULT 'MODEL',

    CONSTRAINT "prediksi_harga_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."rekomendasi_sphp" (
    "id" SERIAL NOT NULL,
    "model_run_id" INTEGER NOT NULL,
    "tahun" INTEGER NOT NULL,
    "bulan" INTEGER NOT NULL,
    "dari_id" INTEGER NOT NULL,
    "ke_id" INTEGER NOT NULL,
    "volume_ton" DOUBLE PRECISION NOT NULL,
    "jarak_jalan_km" DOUBLE PRECISION,
    "jenis_data" "ref"."JenisData" NOT NULL DEFAULT 'MODEL',

    CONSTRAINT "rekomendasi_sphp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."organisasi" (
    "id" SERIAL NOT NULL,
    "nama" TEXT NOT NULL,
    "tipe" "app"."TipeOrganisasi" NOT NULL,
    "wilayah_id" INTEGER,
    "aktif" BOOLEAN NOT NULL DEFAULT true,
    "dibuat_pada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organisasi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."pengguna" (
    "id" SERIAL NOT NULL,
    "organisasi_id" INTEGER NOT NULL,
    "nama" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "kata_sandi_hash" TEXT NOT NULL,
    "peran" "app"."PeranPengguna" NOT NULL DEFAULT 'PEMANTAU',
    "aktif" BOOLEAN NOT NULL DEFAULT true,
    "terakhir_masuk" TIMESTAMP(3),
    "dibuat_pada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pengguna_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."wilayah_pantauan" (
    "pengguna_id" INTEGER NOT NULL,
    "wilayah_id" INTEGER NOT NULL,

    CONSTRAINT "wilayah_pantauan_pkey" PRIMARY KEY ("pengguna_id","wilayah_id")
);

-- CreateTable
CREATE TABLE "app"."paket_langganan" (
    "id" SERIAL NOT NULL,
    "kode" TEXT NOT NULL,
    "nama" TEXT NOT NULL,
    "harga_bulanan_rp" INTEGER NOT NULL,
    "fitur" JSONB NOT NULL,
    "aktif" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "paket_langganan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."langganan" (
    "id" SERIAL NOT NULL,
    "organisasi_id" INTEGER NOT NULL,
    "paket_id" INTEGER NOT NULL,
    "status" "app"."StatusLangganan" NOT NULL DEFAULT 'AKTIF',
    "mulai" DATE NOT NULL,
    "selesai" DATE,

    CONSTRAINT "langganan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."status_wilayah" (
    "wilayah_id" INTEGER NOT NULL,
    "tanggal" DATE NOT NULL,
    "status_produksi" "app"."TingkatStatus",
    "status_stok" "app"."StatusStok",
    "status_harga" "app"."TingkatStatus",
    "status_gabungan" "app"."TingkatStatus" NOT NULL,
    "produksi_estimasi_ton" DOUBLE PRECISION,
    "cakupan_stok_bulan" DOUBLE PRECISION,
    "harga_terkini_rp_kg" DOUBLE PRECISION,
    "harga_prediksi_rp_kg" DOUBLE PRECISION,
    "run_produksi_id" INTEGER,
    "run_stok_id" INTEGER,
    "run_harga_id" INTEGER,
    "jenis_data" "ref"."JenisData" NOT NULL DEFAULT 'MODEL',

    CONSTRAINT "status_wilayah_pkey" PRIMARY KEY ("wilayah_id","tanggal")
);

-- CreateTable
CREATE TABLE "app"."peringatan" (
    "id" SERIAL NOT NULL,
    "wilayah_id" INTEGER NOT NULL,
    "jenis" "app"."JenisPeringatan" NOT NULL,
    "tingkat" "app"."TingkatPeringatan" NOT NULL,
    "judul" TEXT NOT NULL,
    "pesan" TEXT NOT NULL,
    "dasar" JSONB,
    "model_run_id" INTEGER,
    "status" "app"."StatusPeringatan" NOT NULL DEFAULT 'AKTIF',
    "jenis_data" "ref"."JenisData" NOT NULL DEFAULT 'MODEL',
    "dibuat_pada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "berlaku_sampai" TIMESTAMP(3),
    "ditangani_oleh_id" INTEGER,
    "ditangani_pada" TIMESTAMP(3),

    CONSTRAINT "peringatan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."kontak_warga" (
    "id" SERIAL NOT NULL,
    "nomor_wa" TEXT NOT NULL,
    "nama" TEXT,
    "wilayah_id" INTEGER,
    "bahasa" TEXT NOT NULL DEFAULT 'id',
    "opt_in" BOOLEAN NOT NULL DEFAULT false,
    "dibuat_pada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "berhenti_pada" TIMESTAMP(3),

    CONSTRAINT "kontak_warga_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."langganan_peringatan" (
    "id" SERIAL NOT NULL,
    "kontak_id" INTEGER NOT NULL,
    "wilayah_id" INTEGER NOT NULL,
    "tingkat_minimum" "app"."TingkatPeringatan" NOT NULL DEFAULT 'WASPADA',
    "aktif" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "langganan_peringatan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."notifikasi" (
    "id" SERIAL NOT NULL,
    "peringatan_id" INTEGER NOT NULL,
    "kanal" "app"."KanalNotifikasi" NOT NULL,
    "kontak_id" INTEGER,
    "pengguna_id" INTEGER,
    "status" "app"."StatusKirim" NOT NULL DEFAULT 'ANTRE',
    "pesan_id_eksternal" TEXT,
    "galat" TEXT,
    "dibuat_pada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dikirim_pada" TIMESTAMP(3),

    CONSTRAINT "notifikasi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."percakapan_bot" (
    "id" SERIAL NOT NULL,
    "kontak_id" INTEGER NOT NULL,
    "arah" "app"."ArahPesan" NOT NULL,
    "isi" TEXT NOT NULL,
    "intent" TEXT,
    "wilayah_id" INTEGER,
    "dibuat_pada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "percakapan_bot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."parameter_sistem" (
    "kunci" TEXT NOT NULL,
    "nilai" JSONB NOT NULL,
    "deskripsi" TEXT,
    "diperbarui_pada" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "parameter_sistem_pkey" PRIMARY KEY ("kunci")
);

-- CreateTable
CREATE TABLE "ref"."sumber" (
    "id" SERIAL NOT NULL,
    "kode" TEXT NOT NULL,
    "nama" TEXT NOT NULL,
    "penerbit" TEXT NOT NULL,
    "nomor_rilis" TEXT,
    "url" TEXT,
    "tanggal_terbit" DATE,
    "tanggal_ambil" DATE,
    "catatan" TEXT,

    CONSTRAINT "sumber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ref"."wilayah" (
    "id" SERIAL NOT NULL,
    "kode" TEXT NOT NULL,
    "nama" TEXT NOT NULL,
    "nama_repo" TEXT,
    "level" "ref"."LevelWilayah" NOT NULL,
    "jenis" "ref"."JenisWilayah",
    "induk_id" INTEGER,
    "lon" DOUBLE PRECISION,
    "lat" DOUBLE PRECISION,
    "batas_geojson" JSONB,

    CONSTRAINT "wilayah_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ref"."komoditas" (
    "id" SERIAL NOT NULL,
    "kode" TEXT NOT NULL,
    "nama" TEXT NOT NULL,
    "satuan" TEXT NOT NULL,
    "kode_siskaperbapo" INTEGER,

    CONSTRAINT "komoditas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "silver"."ingest_run" (
    "id" SERIAL NOT NULL,
    "sumber_id" INTEGER NOT NULL,
    "nama_berkas" TEXT,
    "checksum_sha256" TEXT,
    "jumlah_baris" INTEGER NOT NULL DEFAULT 0,
    "status" "ref"."StatusRun" NOT NULL DEFAULT 'SELESAI',
    "catatan" TEXT,
    "dibuat_pada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ingest_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "silver"."penduduk" (
    "id" SERIAL NOT NULL,
    "wilayah_id" INTEGER NOT NULL,
    "tahun" INTEGER NOT NULL,
    "jenis_angka" "silver"."JenisAngkaPenduduk" NOT NULL,
    "jumlah_jiwa" INTEGER NOT NULL,
    "jenis_data" "ref"."JenisData" NOT NULL DEFAULT 'ASLI',
    "sumber_id" INTEGER NOT NULL,

    CONSTRAINT "penduduk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "silver"."konsumsi_beras" (
    "id" SERIAL NOT NULL,
    "wilayah_id" INTEGER NOT NULL,
    "tahun" INTEGER NOT NULL,
    "putaran" "silver"."PutaranSusenas" NOT NULL,
    "klasifikasi" "silver"."KlasifikasiDaerah" NOT NULL DEFAULT 'TOTAL',
    "satuan" "silver"."SatuanKonsumsi" NOT NULL,
    "kg_per_kapita" DOUBLE PRECISION NOT NULL,
    "nilai_rp_per_kapita_bulan" DOUBLE PRECISION,
    "jenis_data" "ref"."JenisData" NOT NULL DEFAULT 'ASLI',
    "sumber_id" INTEGER NOT NULL,

    CONSTRAINT "konsumsi_beras_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "silver"."produksi_padi" (
    "id" SERIAL NOT NULL,
    "wilayah_id" INTEGER NOT NULL,
    "granularitas" "silver"."Granularitas" NOT NULL,
    "tahun" INTEGER NOT NULL,
    "bulan_awal" INTEGER NOT NULL,
    "bulan_akhir" INTEGER NOT NULL,
    "status_angka" "silver"."StatusAngka" NOT NULL,
    "luas_panen_ha" DOUBLE PRECISION,
    "produksi_gkp_ton" DOUBLE PRECISION,
    "produksi_gkg_ton" DOUBLE PRECISION,
    "produksi_beras_ton" DOUBLE PRECISION,
    "jenis_data" "ref"."JenisData" NOT NULL DEFAULT 'ASLI',
    "sumber_id" INTEGER NOT NULL,
    "catatan" TEXT,
    "koreksi" JSONB,

    CONSTRAINT "produksi_padi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "silver"."satelit_wilayah" (
    "id" SERIAL NOT NULL,
    "wilayah_id" INTEGER NOT NULL,
    "tanggal_acuan" DATE NOT NULL,
    "luas_sawah_proksi_ha" DOUBLE PRECISION NOT NULL,
    "indeks_pertanaman" DOUBLE PRECISION NOT NULL,
    "fase_bera_pct" DOUBLE PRECISION NOT NULL,
    "fase_olah_pct" DOUBLE PRECISION NOT NULL,
    "fase_vegetatif_pct" DOUBLE PRECISION NOT NULL,
    "fase_generatif_pct" DOUBLE PRECISION NOT NULL,
    "fase_siap_panen_pct" DOUBLE PRECISION NOT NULL,
    "petak_tertinggal_pct" DOUBLE PRECISION NOT NULL,
    "proyeksi_panen_ribu_ton" DOUBLE PRECISION NOT NULL,
    "proyeksi_panen_lalu_ribu_ton" DOUBLE PRECISION NOT NULL,
    "cakupan_s2" DOUBLE PRECISION NOT NULL,
    "vh_db" JSONB NOT NULL,
    "vh_rata3tahun_db" JSONB NOT NULL,
    "jenis_data" "ref"."JenisData" NOT NULL DEFAULT 'MODEL',
    "sumber_id" INTEGER NOT NULL,
    "catatan" TEXT,

    CONSTRAINT "satelit_wilayah_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "silver"."kantor_wilayah_bulog" (
    "id" SERIAL NOT NULL,
    "nama" TEXT NOT NULL,
    "wilayah_provinsi_id" INTEGER,

    CONSTRAINT "kantor_wilayah_bulog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "silver"."kantor_cabang_bulog" (
    "id" SERIAL NOT NULL,
    "kanwil_id" INTEGER NOT NULL,
    "nama" TEXT NOT NULL,

    CONSTRAINT "kantor_cabang_bulog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "silver"."cakupan_cabang_bulog" (
    "cabang_id" INTEGER NOT NULL,
    "wilayah_id" INTEGER NOT NULL,
    "sumber_id" INTEGER,
    "catatan" TEXT,

    CONSTRAINT "cakupan_cabang_bulog_pkey" PRIMARY KEY ("cabang_id","wilayah_id")
);

-- CreateTable
CREATE TABLE "silver"."stok_bulog_bulanan" (
    "kanwil_id" INTEGER NOT NULL,
    "tahun" INTEGER NOT NULL,
    "bulan" INTEGER NOT NULL,
    "persediaan_awal_kg" DOUBLE PRECISION NOT NULL,
    "pemasukan_kg" DOUBLE PRECISION NOT NULL,
    "persediaan_dikuasai_kg" DOUBLE PRECISION NOT NULL,
    "pengeluaran_kg" DOUBLE PRECISION NOT NULL,
    "persediaan_akhir_kg" DOUBLE PRECISION NOT NULL,
    "jenis_data" "ref"."JenisData" NOT NULL DEFAULT 'ASLI',
    "sumber_id" INTEGER NOT NULL,

    CONSTRAINT "stok_bulog_bulanan_pkey" PRIMARY KEY ("kanwil_id","tahun","bulan")
);

-- CreateTable
CREATE TABLE "silver"."stok_bulog_kanwil" (
    "kanwil_id" INTEGER NOT NULL,
    "tahun" INTEGER NOT NULL,
    "stok_kg" DOUBLE PRECISION NOT NULL,
    "jenis_data" "ref"."JenisData" NOT NULL DEFAULT 'ASLI',
    "sumber_id" INTEGER NOT NULL,

    CONSTRAINT "stok_bulog_kanwil_pkey" PRIMARY KEY ("kanwil_id","tahun")
);

-- CreateTable
CREATE TABLE "silver"."pengadaan_bulog" (
    "cabang_id" INTEGER NOT NULL,
    "tahun" INTEGER NOT NULL,
    "saluran" "silver"."SaluranPengadaan" NOT NULL,
    "volume_kg" DOUBLE PRECISION NOT NULL,
    "jenis_data" "ref"."JenisData" NOT NULL DEFAULT 'ASLI',
    "sumber_id" INTEGER NOT NULL,

    CONSTRAINT "pengadaan_bulog_pkey" PRIMARY KEY ("cabang_id","tahun","saluran")
);

-- CreateTable
CREATE TABLE "silver"."harga_penggilingan_bulog" (
    "cabang_id" INTEGER NOT NULL,
    "tahun" INTEGER NOT NULL,
    "harga_rp_kg" DOUBLE PRECISION NOT NULL,
    "jenis_data" "ref"."JenisData" NOT NULL DEFAULT 'ASLI',
    "sumber_id" INTEGER NOT NULL,
    "catatan" TEXT,

    CONSTRAINT "harga_penggilingan_bulog_pkey" PRIMARY KEY ("cabang_id","tahun")
);

-- CreateTable
CREATE TABLE "silver"."harga_pembelian_pemerintah" (
    "tahun" INTEGER NOT NULL,
    "keterangan" TEXT NOT NULL DEFAULT '',
    "harga_dasar_gabah_rp_kg" INTEGER NOT NULL,
    "gabah_kud_rp_kg" INTEGER NOT NULL,
    "gabah_non_kud_rp_kg" INTEGER NOT NULL,
    "beras_kud_rp_kg" INTEGER NOT NULL,
    "beras_non_kud_rp_kg" INTEGER NOT NULL,
    "jenis_data" "ref"."JenisData" NOT NULL DEFAULT 'ASLI',
    "sumber_id" INTEGER NOT NULL,

    CONSTRAINT "harga_pembelian_pemerintah_pkey" PRIMARY KEY ("tahun","keterangan")
);

-- CreateTable
CREATE TABLE "silver"."pasar" (
    "id" SERIAL NOT NULL,
    "wilayah_id" INTEGER NOT NULL,
    "nama" TEXT NOT NULL,

    CONSTRAINT "pasar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "silver"."harga_pasar_harian" (
    "pasar_id" INTEGER NOT NULL,
    "komoditas_id" INTEGER NOT NULL,
    "tanggal" DATE NOT NULL,
    "harga_rp_kg" INTEGER,
    "jenis_data" "ref"."JenisData" NOT NULL DEFAULT 'ASLI',
    "sumber_id" INTEGER NOT NULL,

    CONSTRAINT "harga_pasar_harian_pkey" PRIMARY KEY ("pasar_id","komoditas_id","tanggal")
);

-- CreateTable
CREATE TABLE "silver"."harga_kabkota_harian" (
    "wilayah_id" INTEGER NOT NULL,
    "komoditas_id" INTEGER NOT NULL,
    "tanggal" DATE NOT NULL,
    "harga_rata2_rp_kg" DOUBLE PRECISION,
    "pasar_bernilai" INTEGER NOT NULL,
    "pasar_total" INTEGER NOT NULL,
    "pasar_dikecualikan" INTEGER NOT NULL DEFAULT 0,
    "jenis_data" "ref"."JenisData" NOT NULL DEFAULT 'MODEL',
    "sumber_id" INTEGER NOT NULL,

    CONSTRAINT "harga_kabkota_harian_pkey" PRIMARY KEY ("wilayah_id","komoditas_id","tanggal")
);

-- CreateTable
CREATE TABLE "silver"."harga_provinsi_harian" (
    "wilayah_id" INTEGER NOT NULL,
    "komoditas_id" INTEGER NOT NULL,
    "tanggal" DATE NOT NULL,
    "harga_rp_kg" INTEGER,
    "jenis_data" "ref"."JenisData" NOT NULL DEFAULT 'ASLI',
    "sumber_id" INTEGER NOT NULL,

    CONSTRAINT "harga_provinsi_harian_pkey" PRIMARY KEY ("wilayah_id","komoditas_id","tanggal")
);

-- CreateTable
CREATE TABLE "silver"."jarak_antar_wilayah" (
    "dari_id" INTEGER NOT NULL,
    "ke_id" INTEGER NOT NULL,
    "jarak_garis_lurus_km" DOUBLE PRECISION NOT NULL,
    "jarak_jalan_km" DOUBLE PRECISION NOT NULL,
    "waktu_tempuh_jam" DOUBLE PRECISION NOT NULL,
    "jenis_data" "ref"."JenisData" NOT NULL DEFAULT 'MODEL',
    "sumber_id" INTEGER NOT NULL,

    CONSTRAINT "jarak_antar_wilayah_pkey" PRIMARY KEY ("dari_id","ke_id")
);

-- CreateIndex
CREATE INDEX "ambang_harga_komoditas_id_berlaku_dari_idx" ON "app"."ambang_harga"("komoditas_id", "berlaku_dari");

-- CreateIndex
CREATE UNIQUE INDEX "model_run_mlflow_run_id_key" ON "app"."model_run"("mlflow_run_id");

-- CreateIndex
CREATE INDEX "model_run_jenis_dibuat_pada_idx" ON "app"."model_run"("jenis", "dibuat_pada");

-- CreateIndex
CREATE UNIQUE INDEX "prediksi_produksi_model_run_id_wilayah_id_tahun_bulan_key" ON "app"."prediksi_produksi"("model_run_id", "wilayah_id", "tahun", "bulan");

-- CreateIndex
CREATE UNIQUE INDEX "estimasi_stok_model_run_id_wilayah_id_tahun_bulan_skenario_key" ON "app"."estimasi_stok"("model_run_id", "wilayah_id", "tahun", "bulan", "skenario");

-- CreateIndex
CREATE UNIQUE INDEX "prediksi_harga_model_run_id_wilayah_id_komoditas_id_tanggal_key" ON "app"."prediksi_harga"("model_run_id", "wilayah_id", "komoditas_id", "tanggal_acuan", "horizon_hari");

-- CreateIndex
CREATE UNIQUE INDEX "rekomendasi_sphp_model_run_id_tahun_bulan_dari_id_ke_id_key" ON "app"."rekomendasi_sphp"("model_run_id", "tahun", "bulan", "dari_id", "ke_id");

-- CreateIndex
CREATE UNIQUE INDEX "pengguna_email_key" ON "app"."pengguna"("email");

-- CreateIndex
CREATE INDEX "pengguna_organisasi_id_idx" ON "app"."pengguna"("organisasi_id");

-- CreateIndex
CREATE UNIQUE INDEX "paket_langganan_kode_key" ON "app"."paket_langganan"("kode");

-- CreateIndex
CREATE INDEX "langganan_organisasi_id_status_idx" ON "app"."langganan"("organisasi_id", "status");

-- CreateIndex
CREATE INDEX "status_wilayah_tanggal_idx" ON "app"."status_wilayah"("tanggal");

-- CreateIndex
CREATE INDEX "peringatan_wilayah_id_status_idx" ON "app"."peringatan"("wilayah_id", "status");

-- CreateIndex
CREATE INDEX "peringatan_dibuat_pada_idx" ON "app"."peringatan"("dibuat_pada");

-- CreateIndex
CREATE UNIQUE INDEX "kontak_warga_nomor_wa_key" ON "app"."kontak_warga"("nomor_wa");

-- CreateIndex
CREATE UNIQUE INDEX "langganan_peringatan_kontak_id_wilayah_id_key" ON "app"."langganan_peringatan"("kontak_id", "wilayah_id");

-- CreateIndex
CREATE INDEX "notifikasi_peringatan_id_idx" ON "app"."notifikasi"("peringatan_id");

-- CreateIndex
CREATE INDEX "notifikasi_status_dibuat_pada_idx" ON "app"."notifikasi"("status", "dibuat_pada");

-- CreateIndex
CREATE INDEX "percakapan_bot_kontak_id_dibuat_pada_idx" ON "app"."percakapan_bot"("kontak_id", "dibuat_pada");

-- CreateIndex
CREATE UNIQUE INDEX "sumber_kode_key" ON "ref"."sumber"("kode");

-- CreateIndex
CREATE UNIQUE INDEX "wilayah_kode_key" ON "ref"."wilayah"("kode");

-- CreateIndex
CREATE INDEX "wilayah_level_idx" ON "ref"."wilayah"("level");

-- CreateIndex
CREATE INDEX "wilayah_induk_id_idx" ON "ref"."wilayah"("induk_id");

-- CreateIndex
CREATE UNIQUE INDEX "komoditas_kode_key" ON "ref"."komoditas"("kode");

-- CreateIndex
CREATE UNIQUE INDEX "komoditas_kode_siskaperbapo_key" ON "ref"."komoditas"("kode_siskaperbapo");

-- CreateIndex
CREATE INDEX "ingest_run_sumber_id_idx" ON "silver"."ingest_run"("sumber_id");

-- CreateIndex
CREATE UNIQUE INDEX "penduduk_wilayah_id_tahun_jenis_angka_key" ON "silver"."penduduk"("wilayah_id", "tahun", "jenis_angka");

-- CreateIndex
CREATE UNIQUE INDEX "konsumsi_beras_wilayah_id_tahun_putaran_klasifikasi_key" ON "silver"."konsumsi_beras"("wilayah_id", "tahun", "putaran", "klasifikasi");

-- CreateIndex
CREATE INDEX "produksi_padi_wilayah_id_tahun_idx" ON "silver"."produksi_padi"("wilayah_id", "tahun");

-- CreateIndex
CREATE UNIQUE INDEX "produksi_padi_wilayah_id_tahun_bulan_awal_bulan_akhir_sumbe_key" ON "silver"."produksi_padi"("wilayah_id", "tahun", "bulan_awal", "bulan_akhir", "sumber_id");

-- CreateIndex
CREATE UNIQUE INDEX "satelit_wilayah_wilayah_id_tanggal_acuan_key" ON "silver"."satelit_wilayah"("wilayah_id", "tanggal_acuan");

-- CreateIndex
CREATE UNIQUE INDEX "kantor_wilayah_bulog_nama_key" ON "silver"."kantor_wilayah_bulog"("nama");

-- CreateIndex
CREATE UNIQUE INDEX "kantor_cabang_bulog_nama_key" ON "silver"."kantor_cabang_bulog"("nama");

-- CreateIndex
CREATE UNIQUE INDEX "pasar_wilayah_id_nama_key" ON "silver"."pasar"("wilayah_id", "nama");

-- CreateIndex
CREATE INDEX "harga_pasar_harian_komoditas_id_tanggal_idx" ON "silver"."harga_pasar_harian"("komoditas_id", "tanggal");

-- CreateIndex
CREATE INDEX "harga_kabkota_harian_komoditas_id_tanggal_idx" ON "silver"."harga_kabkota_harian"("komoditas_id", "tanggal");

-- AddForeignKey
ALTER TABLE "app"."ambang_harga" ADD CONSTRAINT "ambang_harga_komoditas_id_fkey" FOREIGN KEY ("komoditas_id") REFERENCES "ref"."komoditas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."ambang_harga" ADD CONSTRAINT "ambang_harga_wilayah_id_fkey" FOREIGN KEY ("wilayah_id") REFERENCES "ref"."wilayah"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."ambang_harga" ADD CONSTRAINT "ambang_harga_sumber_id_fkey" FOREIGN KEY ("sumber_id") REFERENCES "ref"."sumber"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."prediksi_produksi" ADD CONSTRAINT "prediksi_produksi_model_run_id_fkey" FOREIGN KEY ("model_run_id") REFERENCES "app"."model_run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."prediksi_produksi" ADD CONSTRAINT "prediksi_produksi_wilayah_id_fkey" FOREIGN KEY ("wilayah_id") REFERENCES "ref"."wilayah"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."estimasi_stok" ADD CONSTRAINT "estimasi_stok_model_run_id_fkey" FOREIGN KEY ("model_run_id") REFERENCES "app"."model_run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."estimasi_stok" ADD CONSTRAINT "estimasi_stok_wilayah_id_fkey" FOREIGN KEY ("wilayah_id") REFERENCES "ref"."wilayah"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."prediksi_harga" ADD CONSTRAINT "prediksi_harga_model_run_id_fkey" FOREIGN KEY ("model_run_id") REFERENCES "app"."model_run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."prediksi_harga" ADD CONSTRAINT "prediksi_harga_wilayah_id_fkey" FOREIGN KEY ("wilayah_id") REFERENCES "ref"."wilayah"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."prediksi_harga" ADD CONSTRAINT "prediksi_harga_komoditas_id_fkey" FOREIGN KEY ("komoditas_id") REFERENCES "ref"."komoditas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."rekomendasi_sphp" ADD CONSTRAINT "rekomendasi_sphp_model_run_id_fkey" FOREIGN KEY ("model_run_id") REFERENCES "app"."model_run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."rekomendasi_sphp" ADD CONSTRAINT "rekomendasi_sphp_dari_id_fkey" FOREIGN KEY ("dari_id") REFERENCES "ref"."wilayah"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."rekomendasi_sphp" ADD CONSTRAINT "rekomendasi_sphp_ke_id_fkey" FOREIGN KEY ("ke_id") REFERENCES "ref"."wilayah"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."organisasi" ADD CONSTRAINT "organisasi_wilayah_id_fkey" FOREIGN KEY ("wilayah_id") REFERENCES "ref"."wilayah"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."pengguna" ADD CONSTRAINT "pengguna_organisasi_id_fkey" FOREIGN KEY ("organisasi_id") REFERENCES "app"."organisasi"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."wilayah_pantauan" ADD CONSTRAINT "wilayah_pantauan_pengguna_id_fkey" FOREIGN KEY ("pengguna_id") REFERENCES "app"."pengguna"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."wilayah_pantauan" ADD CONSTRAINT "wilayah_pantauan_wilayah_id_fkey" FOREIGN KEY ("wilayah_id") REFERENCES "ref"."wilayah"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."langganan" ADD CONSTRAINT "langganan_organisasi_id_fkey" FOREIGN KEY ("organisasi_id") REFERENCES "app"."organisasi"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."langganan" ADD CONSTRAINT "langganan_paket_id_fkey" FOREIGN KEY ("paket_id") REFERENCES "app"."paket_langganan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."status_wilayah" ADD CONSTRAINT "status_wilayah_wilayah_id_fkey" FOREIGN KEY ("wilayah_id") REFERENCES "ref"."wilayah"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."status_wilayah" ADD CONSTRAINT "status_wilayah_run_produksi_id_fkey" FOREIGN KEY ("run_produksi_id") REFERENCES "app"."model_run"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."status_wilayah" ADD CONSTRAINT "status_wilayah_run_stok_id_fkey" FOREIGN KEY ("run_stok_id") REFERENCES "app"."model_run"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."status_wilayah" ADD CONSTRAINT "status_wilayah_run_harga_id_fkey" FOREIGN KEY ("run_harga_id") REFERENCES "app"."model_run"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."peringatan" ADD CONSTRAINT "peringatan_wilayah_id_fkey" FOREIGN KEY ("wilayah_id") REFERENCES "ref"."wilayah"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."peringatan" ADD CONSTRAINT "peringatan_model_run_id_fkey" FOREIGN KEY ("model_run_id") REFERENCES "app"."model_run"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."peringatan" ADD CONSTRAINT "peringatan_ditangani_oleh_id_fkey" FOREIGN KEY ("ditangani_oleh_id") REFERENCES "app"."pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."kontak_warga" ADD CONSTRAINT "kontak_warga_wilayah_id_fkey" FOREIGN KEY ("wilayah_id") REFERENCES "ref"."wilayah"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."langganan_peringatan" ADD CONSTRAINT "langganan_peringatan_kontak_id_fkey" FOREIGN KEY ("kontak_id") REFERENCES "app"."kontak_warga"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."langganan_peringatan" ADD CONSTRAINT "langganan_peringatan_wilayah_id_fkey" FOREIGN KEY ("wilayah_id") REFERENCES "ref"."wilayah"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."notifikasi" ADD CONSTRAINT "notifikasi_peringatan_id_fkey" FOREIGN KEY ("peringatan_id") REFERENCES "app"."peringatan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."notifikasi" ADD CONSTRAINT "notifikasi_kontak_id_fkey" FOREIGN KEY ("kontak_id") REFERENCES "app"."kontak_warga"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."notifikasi" ADD CONSTRAINT "notifikasi_pengguna_id_fkey" FOREIGN KEY ("pengguna_id") REFERENCES "app"."pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."percakapan_bot" ADD CONSTRAINT "percakapan_bot_kontak_id_fkey" FOREIGN KEY ("kontak_id") REFERENCES "app"."kontak_warga"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."percakapan_bot" ADD CONSTRAINT "percakapan_bot_wilayah_id_fkey" FOREIGN KEY ("wilayah_id") REFERENCES "ref"."wilayah"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ref"."wilayah" ADD CONSTRAINT "wilayah_induk_id_fkey" FOREIGN KEY ("induk_id") REFERENCES "ref"."wilayah"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "silver"."ingest_run" ADD CONSTRAINT "ingest_run_sumber_id_fkey" FOREIGN KEY ("sumber_id") REFERENCES "ref"."sumber"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "silver"."penduduk" ADD CONSTRAINT "penduduk_wilayah_id_fkey" FOREIGN KEY ("wilayah_id") REFERENCES "ref"."wilayah"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "silver"."penduduk" ADD CONSTRAINT "penduduk_sumber_id_fkey" FOREIGN KEY ("sumber_id") REFERENCES "ref"."sumber"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "silver"."konsumsi_beras" ADD CONSTRAINT "konsumsi_beras_wilayah_id_fkey" FOREIGN KEY ("wilayah_id") REFERENCES "ref"."wilayah"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "silver"."konsumsi_beras" ADD CONSTRAINT "konsumsi_beras_sumber_id_fkey" FOREIGN KEY ("sumber_id") REFERENCES "ref"."sumber"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "silver"."produksi_padi" ADD CONSTRAINT "produksi_padi_wilayah_id_fkey" FOREIGN KEY ("wilayah_id") REFERENCES "ref"."wilayah"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "silver"."produksi_padi" ADD CONSTRAINT "produksi_padi_sumber_id_fkey" FOREIGN KEY ("sumber_id") REFERENCES "ref"."sumber"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "silver"."satelit_wilayah" ADD CONSTRAINT "satelit_wilayah_wilayah_id_fkey" FOREIGN KEY ("wilayah_id") REFERENCES "ref"."wilayah"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "silver"."satelit_wilayah" ADD CONSTRAINT "satelit_wilayah_sumber_id_fkey" FOREIGN KEY ("sumber_id") REFERENCES "ref"."sumber"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "silver"."kantor_wilayah_bulog" ADD CONSTRAINT "kantor_wilayah_bulog_wilayah_provinsi_id_fkey" FOREIGN KEY ("wilayah_provinsi_id") REFERENCES "ref"."wilayah"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "silver"."kantor_cabang_bulog" ADD CONSTRAINT "kantor_cabang_bulog_kanwil_id_fkey" FOREIGN KEY ("kanwil_id") REFERENCES "silver"."kantor_wilayah_bulog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "silver"."cakupan_cabang_bulog" ADD CONSTRAINT "cakupan_cabang_bulog_cabang_id_fkey" FOREIGN KEY ("cabang_id") REFERENCES "silver"."kantor_cabang_bulog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "silver"."cakupan_cabang_bulog" ADD CONSTRAINT "cakupan_cabang_bulog_wilayah_id_fkey" FOREIGN KEY ("wilayah_id") REFERENCES "ref"."wilayah"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "silver"."cakupan_cabang_bulog" ADD CONSTRAINT "cakupan_cabang_bulog_sumber_id_fkey" FOREIGN KEY ("sumber_id") REFERENCES "ref"."sumber"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "silver"."stok_bulog_bulanan" ADD CONSTRAINT "stok_bulog_bulanan_kanwil_id_fkey" FOREIGN KEY ("kanwil_id") REFERENCES "silver"."kantor_wilayah_bulog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "silver"."stok_bulog_bulanan" ADD CONSTRAINT "stok_bulog_bulanan_sumber_id_fkey" FOREIGN KEY ("sumber_id") REFERENCES "ref"."sumber"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "silver"."stok_bulog_kanwil" ADD CONSTRAINT "stok_bulog_kanwil_kanwil_id_fkey" FOREIGN KEY ("kanwil_id") REFERENCES "silver"."kantor_wilayah_bulog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "silver"."stok_bulog_kanwil" ADD CONSTRAINT "stok_bulog_kanwil_sumber_id_fkey" FOREIGN KEY ("sumber_id") REFERENCES "ref"."sumber"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "silver"."pengadaan_bulog" ADD CONSTRAINT "pengadaan_bulog_cabang_id_fkey" FOREIGN KEY ("cabang_id") REFERENCES "silver"."kantor_cabang_bulog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "silver"."pengadaan_bulog" ADD CONSTRAINT "pengadaan_bulog_sumber_id_fkey" FOREIGN KEY ("sumber_id") REFERENCES "ref"."sumber"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "silver"."harga_penggilingan_bulog" ADD CONSTRAINT "harga_penggilingan_bulog_cabang_id_fkey" FOREIGN KEY ("cabang_id") REFERENCES "silver"."kantor_cabang_bulog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "silver"."harga_penggilingan_bulog" ADD CONSTRAINT "harga_penggilingan_bulog_sumber_id_fkey" FOREIGN KEY ("sumber_id") REFERENCES "ref"."sumber"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "silver"."harga_pembelian_pemerintah" ADD CONSTRAINT "harga_pembelian_pemerintah_sumber_id_fkey" FOREIGN KEY ("sumber_id") REFERENCES "ref"."sumber"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "silver"."pasar" ADD CONSTRAINT "pasar_wilayah_id_fkey" FOREIGN KEY ("wilayah_id") REFERENCES "ref"."wilayah"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "silver"."harga_pasar_harian" ADD CONSTRAINT "harga_pasar_harian_pasar_id_fkey" FOREIGN KEY ("pasar_id") REFERENCES "silver"."pasar"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "silver"."harga_pasar_harian" ADD CONSTRAINT "harga_pasar_harian_komoditas_id_fkey" FOREIGN KEY ("komoditas_id") REFERENCES "ref"."komoditas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "silver"."harga_pasar_harian" ADD CONSTRAINT "harga_pasar_harian_sumber_id_fkey" FOREIGN KEY ("sumber_id") REFERENCES "ref"."sumber"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "silver"."harga_kabkota_harian" ADD CONSTRAINT "harga_kabkota_harian_wilayah_id_fkey" FOREIGN KEY ("wilayah_id") REFERENCES "ref"."wilayah"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "silver"."harga_kabkota_harian" ADD CONSTRAINT "harga_kabkota_harian_komoditas_id_fkey" FOREIGN KEY ("komoditas_id") REFERENCES "ref"."komoditas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "silver"."harga_kabkota_harian" ADD CONSTRAINT "harga_kabkota_harian_sumber_id_fkey" FOREIGN KEY ("sumber_id") REFERENCES "ref"."sumber"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "silver"."harga_provinsi_harian" ADD CONSTRAINT "harga_provinsi_harian_wilayah_id_fkey" FOREIGN KEY ("wilayah_id") REFERENCES "ref"."wilayah"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "silver"."harga_provinsi_harian" ADD CONSTRAINT "harga_provinsi_harian_komoditas_id_fkey" FOREIGN KEY ("komoditas_id") REFERENCES "ref"."komoditas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "silver"."harga_provinsi_harian" ADD CONSTRAINT "harga_provinsi_harian_sumber_id_fkey" FOREIGN KEY ("sumber_id") REFERENCES "ref"."sumber"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "silver"."jarak_antar_wilayah" ADD CONSTRAINT "jarak_antar_wilayah_dari_id_fkey" FOREIGN KEY ("dari_id") REFERENCES "ref"."wilayah"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "silver"."jarak_antar_wilayah" ADD CONSTRAINT "jarak_antar_wilayah_ke_id_fkey" FOREIGN KEY ("ke_id") REFERENCES "ref"."wilayah"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "silver"."jarak_antar_wilayah" ADD CONSTRAINT "jarak_antar_wilayah_sumber_id_fkey" FOREIGN KEY ("sumber_id") REFERENCES "ref"."sumber"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
