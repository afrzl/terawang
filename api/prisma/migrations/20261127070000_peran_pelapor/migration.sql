-- CreateEnum
CREATE TYPE "app"."PeranPelapor" AS ENUM ('PENJUAL', 'PEMBELI');

-- AlterTable
ALTER TABLE "app"."laporan_harga_warga" ADD COLUMN     "peran_pelapor" "app"."PeranPelapor";
