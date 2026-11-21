-- CreateEnum
CREATE TYPE "app"."StatusLaporan" AS ENUM ('MENUNGGU', 'VALID', 'DITOLAK');

-- CreateTable
CREATE TABLE "app"."laporan_harga_warga" (
    "id" SERIAL NOT NULL,
    "kontak_id" INTEGER NOT NULL,
    "wilayah_id" INTEGER,
    "komoditas_id" INTEGER NOT NULL,
    "nama_pasar" TEXT NOT NULL,
    "harga_rp_kg" INTEGER NOT NULL,
    "selisih_panel_pct" DOUBLE PRECISION,
    "status" "app"."StatusLaporan" NOT NULL DEFAULT 'MENUNGGU',
    "dibuat_pada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "laporan_harga_warga_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "laporan_harga_warga_wilayah_id_dibuat_pada_idx" ON "app"."laporan_harga_warga"("wilayah_id", "dibuat_pada");

-- AddForeignKey
ALTER TABLE "app"."laporan_harga_warga" ADD CONSTRAINT "laporan_harga_warga_kontak_id_fkey" FOREIGN KEY ("kontak_id") REFERENCES "app"."kontak_warga"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "app"."laporan_harga_warga" ADD CONSTRAINT "laporan_harga_warga_wilayah_id_fkey" FOREIGN KEY ("wilayah_id") REFERENCES "ref"."wilayah"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "app"."laporan_harga_warga" ADD CONSTRAINT "laporan_harga_warga_komoditas_id_fkey" FOREIGN KEY ("komoditas_id") REFERENCES "ref"."komoditas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
