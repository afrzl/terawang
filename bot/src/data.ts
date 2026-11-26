/**
 * Semua angka yang dijawab bot berasal dari fungsi di berkas ini (schema app dan silver, hasil pipeline Dagster).
 * Bot dan LLM tidak menghitung sendiri; mereka hanya merangkai hasil fungsi ini.
 */
import { config } from "./config.ts"
import { q, q1 } from "./db.ts"
import { labelWilayah, semuaWilayah, type Wilayah } from "./wilayah.ts"

export type Tingkat = "AMAN" | "WASPADA" | "SIAGA"

async function idKomoditas(kode: string): Promise<number | undefined> {
  return (await q1<{ id: number }>("select id from ref.komoditas where kode = $1", [kode]))?.id
}

async function hetMedium(wilayahId: number): Promise<{ het: number; resmi: boolean }> {
  const r = await q1<{ het_rp_kg: number }>(
    `select a.het_rp_kg
       from app.ambang_harga a join ref.komoditas k on k.id = a.komoditas_id
      where k.kode = 'beras_medium'
        and a.berlaku_dari <= current_date and (a.berlaku_sampai is null or a.berlaku_sampai >= current_date)
        and (a.wilayah_id is null or a.wilayah_id = $1)
      order by (a.wilayah_id is null), a.berlaku_dari desc
      limit 1`,
    [wilayahId],
  )
  return r ? { het: r.het_rp_kg, resmi: true } : { het: config.hetMediumCadangan, resmi: false }
}

async function statusTerkini(wilayahId: number) {
  return q1<{
    tanggal: string
    status_produksi: Tingkat | null
    status_stok: string | null
    status_harga: Tingkat | null
    status_gabungan: Tingkat
    produksi_estimasi_ton: number | null
    cakupan_stok_bulan: number | null
    harga_terkini_rp_kg: number | null
    harga_prediksi_rp_kg: number | null
  }>(
    `select tanggal::text as tanggal, status_produksi::text as status_produksi, status_stok::text as status_stok,
            status_harga::text as status_harga, status_gabungan::text as status_gabungan,
            produksi_estimasi_ton, cakupan_stok_bulan, harga_terkini_rp_kg, harga_prediksi_rp_kg
       from app.status_wilayah where wilayah_id = $1
      order by tanggal desc limit 1`,
    [wilayahId],
  )
}

async function hargaPanelTerkini(wilayahId: number, kode: string) {
  return q1<{ tanggal: string; harga: number }>(
    `select h.tanggal::text as tanggal, h.harga_rata2_rp_kg as harga
       from silver.harga_kabkota_harian h join ref.komoditas k on k.id = h.komoditas_id
      where h.wilayah_id = $1 and k.kode = $2 and h.harga_rata2_rp_kg is not null
      order by h.tanggal desc limit 1`,
    [wilayahId, kode],
  )
}

export type InfoHarga = {
  wilayah: string
  tanggal_data: string | null
  medium_rp_kg: number | null
  premium_rp_kg: number | null
  het_medium_rp_kg: number
  het_resmi: boolean
  selisih_het_pct: number | null
  prediksi: { horizon_hari: number; tanggal_acuan: string; harga_rp_kg: number; batas_bawah: number | null; batas_atas: number | null; status: Tingkat | null }[]
  status_harga: Tingkat | null
}

export async function infoHarga(w: Wilayah): Promise<InfoHarga> {
  const [st, medium, premium, het] = await Promise.all([
    statusTerkini(w.id),
    hargaPanelTerkini(w.id, "beras_medium"),
    hargaPanelTerkini(w.id, "beras_premium"),
    hetMedium(w.id),
  ])
  const prediksi = await q<InfoHarga["prediksi"][number]>(
    `with run as (
       select m.id from app.model_run m where m.jenis = 'K3_HARGA' and m.status = 'SELESAI' and exists (select 1 from app.prediksi_harga t where t.model_run_id = m.id and t.horizon_hari = 7) order by m.id desc limit 1
     )
     select p.horizon_hari, p.tanggal_acuan::text as tanggal_acuan, round(p.harga_prediksi)::int as harga_rp_kg,
            round(p.batas_bawah)::int as batas_bawah, round(p.batas_atas)::int as batas_atas, p.status::text as status
       from app.prediksi_harga p join ref.komoditas k on k.id = p.komoditas_id
      where p.model_run_id = (select id from run) and p.wilayah_id = $1 and k.kode = 'beras_medium'
        and p.tanggal_acuan = (select max(tanggal_acuan) from app.prediksi_harga where model_run_id = (select id from run))
      order by p.horizon_hari`,
    [w.id],
  )
  const hargaMedium = medium?.harga ?? st?.harga_terkini_rp_kg ?? null
  return {
    wilayah: labelWilayah(w),
    tanggal_data: medium?.tanggal ?? st?.tanggal ?? null,
    medium_rp_kg: hargaMedium === null ? null : Math.round(hargaMedium),
    premium_rp_kg: premium ? Math.round(premium.harga) : null,
    het_medium_rp_kg: het.het,
    het_resmi: het.resmi,
    selisih_het_pct: hargaMedium === null ? null : Math.round((hargaMedium / het.het - 1) * 1000) / 10,
    prediksi,
    status_harga: st?.status_harga ?? prediksi.find((p) => p.horizon_hari === 28)?.status ?? null,
  }
}

export type InfoStok = {
  wilayah: string
  bulan_ini: { tahun: number; bulan: number; stok_ton: number; cakupan_bulan: number | null; status: string | null } | null
  bulan_defisit_pertama: { tahun: number; bulan: number; cakupan_bulan: number | null } | null
  proyeksi: { tahun: number; bulan: number; cakupan_bulan: number | null; status: string | null }[]
  catatan: string
}

export async function infoStok(w: Wilayah): Promise<InfoStok> {
  const rows = await q<{ tahun: number; bulan: number; stok_ton: number; cakupan_bulan: number | null; status: string | null }>(
    `with run as (
       -- sama dengan API dasbor: run SELESAI terbaru yang punya baris (lihat runTerbaru di api/src/server.ts)
       select m.id from app.model_run m where m.jenis = 'K2_STOK' and m.status = 'SELESAI'
          and exists (select 1 from app.estimasi_stok t where t.model_run_id = m.id)
        order by m.id desc limit 1
     )
     -- stok fisik tidak bisa negatif: dipotong di 0 (habis), sama seperti dasbor
     select tahun, bulan, round(greatest(stok_ton, 0))::int as stok_ton, round(greatest(cakupan_bulan, 0)::numeric, 2)::float8 as cakupan_bulan, status::text as status
       from app.estimasi_stok
      where model_run_id = (select id from run) and wilayah_id = $1 and skenario = 'TENGAH'
        and (tahun * 12 + bulan) >= (extract(year from now() at time zone 'Asia/Jakarta') * 12 + extract(month from now() at time zone 'Asia/Jakarta'))
      order by tahun, bulan
      limit 6`,
    [w.id],
  )
  const defisit = rows.find((r) => r.status === "DEFISIT")
  return {
    wilayah: labelWilayah(w),
    bulan_ini: rows[0] ?? null,
    bulan_defisit_pertama: defisit ? { tahun: defisit.tahun, bulan: defisit.bulan, cakupan_bulan: defisit.cakupan_bulan } : null,
    proyeksi: rows.map(({ tahun, bulan, cakupan_bulan, status }) => ({ tahun, bulan, cakupan_bulan, status })),
    catatan: "Skenario tengah. Stok awal kab/kota adalah asumsi model, bukan angka resmi.",
  }
}

export type InfoBerasMurah = {
  wilayah: string
  harga_di_sini_rp_kg: number | null
  sekitar_lebih_murah: { wilayah: string; harga_rp_kg: number; jarak_jalan_km: number; waktu_tempuh_jam: number }[]
  pasokan_sphp_masuk: { dari: string; volume_ton: number; jarak_jalan_km: number | null }[]
  pasokan_sphp_keluar: { ke: string; volume_ton: number; jarak_jalan_km: number | null }[]
  harga_sphp_rp_kg: number
}

export async function infoBerasMurah(w: Wilayah): Promise<InfoBerasMurah> {
  const medium = await idKomoditas("beras_medium")
  const sini = await hargaPanelTerkini(w.id, "beras_medium")
  const sekitar = await q<{ id: number; nama: string; jenis: "KABUPATEN" | "KOTA"; harga: number; jarak_jalan_km: number; waktu_tempuh_jam: number }>(
    `select w.id, w.nama, w.jenis::text as jenis, round(h.harga)::int as harga,
            round(j.jarak_jalan_km)::int as jarak_jalan_km, round(j.waktu_tempuh_jam::numeric, 1)::float8 as waktu_tempuh_jam
       from silver.jarak_antar_wilayah j
       join ref.wilayah w on w.id = j.ke_id
       join lateral (
         select harga_rata2_rp_kg as harga from silver.harga_kabkota_harian
          where wilayah_id = j.ke_id and komoditas_id = $2 and harga_rata2_rp_kg is not null
          order by tanggal desc limit 1
       ) h on true
      where j.dari_id = $1 and j.ke_id <> $1
      order by j.jarak_jalan_km
      limit 6`,
    [w.id, medium],
  )
  const sphp = await q<{ arah: "masuk" | "keluar"; nama: string; jenis: "KABUPATEN" | "KOTA"; volume_ton: number; jarak_jalan_km: number | null }>(
    `with run as (
       select m.id from app.model_run m where m.jenis = 'K3_SPHP' and m.status = 'SELESAI' and exists (select 1 from app.rekomendasi_sphp t where t.model_run_id = m.id) order by m.id desc limit 1
     )
     select case when r.ke_id = $1 then 'masuk' else 'keluar' end as arah,
            w.nama, w.jenis::text as jenis, round(r.volume_ton)::int as volume_ton, round(r.jarak_jalan_km)::int as jarak_jalan_km
       from app.rekomendasi_sphp r
       join ref.wilayah w on w.id = case when r.ke_id = $1 then r.dari_id else r.ke_id end
      where r.model_run_id = (select id from run) and (r.ke_id = $1 or r.dari_id = $1)
      order by r.volume_ton desc
      limit 6`,
    [w.id],
  )
  const hargaSini = sini ? Math.round(sini.harga) : null
  return {
    wilayah: labelWilayah(w),
    harga_di_sini_rp_kg: hargaSini,
    sekitar_lebih_murah: sekitar
      .filter((s) => hargaSini === null || s.harga < hargaSini)
      .slice(0, 3)
      .map((s) => ({ wilayah: labelWilayah(s), harga_rp_kg: s.harga, jarak_jalan_km: s.jarak_jalan_km, waktu_tempuh_jam: s.waktu_tempuh_jam })),
    pasokan_sphp_masuk: sphp.filter((s) => s.arah === "masuk").map((s) => ({ dari: labelWilayah(s), volume_ton: s.volume_ton, jarak_jalan_km: s.jarak_jalan_km })),
    pasokan_sphp_keluar: sphp.filter((s) => s.arah === "keluar").map((s) => ({ ke: labelWilayah(s), volume_ton: s.volume_ton, jarak_jalan_km: s.jarak_jalan_km })),
    harga_sphp_rp_kg: 12500,
  }
}

export type ItemPeringatan = { id: number; wilayah_id: number; wilayah: string; jenis: string; tingkat: "WASPADA" | "SIAGA"; judul: string; pesan: string; dibuat_pada: string }

export async function daftarPeringatan(wilayahId?: number): Promise<ItemPeringatan[]> {
  const rows = await q<ItemPeringatan & { nama: string; wjenis: "KABUPATEN" | "KOTA" }>(
    `select p.id, p.wilayah_id, w.nama, w.jenis::text as wjenis, p.jenis::text as jenis, p.tingkat::text as tingkat,
            p.judul, p.pesan, p.dibuat_pada::text as dibuat_pada
       from app.peringatan p join ref.wilayah w on w.id = p.wilayah_id
      where p.status = 'AKTIF' and (p.berlaku_sampai is null or p.berlaku_sampai > now())
        and ($1::int is null or p.wilayah_id = $1)
      order by (p.tingkat = 'SIAGA') desc, p.jenis, w.nama`,
    [wilayahId ?? null],
  )
  return rows.map(({ nama, wjenis, ...r }) => ({ ...r, wilayah: labelWilayah({ nama, jenis: wjenis }) }))
}

/** Ringkasan Jatim: jumlah kab/kota per status gabungan pada tanggal status terakhir. */
export async function ringkasanJatim() {
  return q<{ status: Tingkat; jumlah: number }>(
    `select status_gabungan::text as status, count(*)::int as jumlah
       from app.status_wilayah where tanggal = (select max(tanggal) from app.status_wilayah)
      group by 1 order by 1`,
  )
}

export { semuaWilayah }
