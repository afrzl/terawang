-- AlterEnum
ALTER TYPE "app"."StatusStok" ADD VALUE 'SURPLUS';

-- AlterTable
ALTER TABLE "app"."estimasi_stok" ADD COLUMN     "kebutuhan_ton" DOUBLE PRECISION,
ADD COLUMN     "surplus_ton" DOUBLE PRECISION;
