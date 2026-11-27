/** Tabel kanal warga: app.kontak_warga, app.percakapan_bot, app.langganan_peringatan, app.laporan_harga_warga. */
import { q, q1 } from "./db.ts"

export type Kontak = { id: number; nomor_wa: string; wilayah_id: number | null; opt_in: boolean }

export async function kontakDari(nomor: string, nama?: string): Promise<Kontak> {
  const r = await q1<Kontak>(
    `insert into app.kontak_warga (nomor_wa, nama) values ($1, $2)
     on conflict (nomor_wa) do update set nama = coalesce(excluded.nama, app.kontak_warga.nama)
     returning id, nomor_wa, wilayah_id, opt_in`,
    [nomor, nama ?? null],
  )
  return r!
}

export async function catat(kontakId: number, arah: "MASUK" | "KELUAR", isi: string, intent: string | null, wilayahId: number | null) {
  await q(
    `insert into app.percakapan_bot (kontak_id, arah, isi, intent, wilayah_id) values ($1, $2, $3, $4, $5)`,
    [kontakId, arah, isi.slice(0, 4000), intent, wilayahId],
  )
}

export async function ingatWilayah(kontakId: number, wilayahId: number) {
  await q(`update app.kontak_warga set wilayah_id = $2 where id = $1`, [kontakId, wilayahId])
}

export async function jumlahLlmHariIni(kontakId: number): Promise<number> {
  const r = await q1<{ n: number }>(
    `select count(*)::int as n from app.percakapan_bot
      where kontak_id = $1 and arah = 'KELUAR' and intent = 'llm'
        and dibuat_pada >= date_trunc('day', now() at time zone 'Asia/Jakarta') at time zone 'Asia/Jakarta'`,
    [kontakId],
  )
  return r?.n ?? 0
}

export async function berlangganan(kontakId: number, wilayahId: number) {
  await q(`update app.kontak_warga set opt_in = true, berhenti_pada = null, wilayah_id = coalesce(wilayah_id, $2) where id = $1`, [kontakId, wilayahId])
  await q(
    `insert into app.langganan_peringatan (kontak_id, wilayah_id) values ($1, $2)
     on conflict (kontak_id, wilayah_id) do update set aktif = true`,
    [kontakId, wilayahId],
  )
}

export async function daftarLangganan(kontakId: number) {
  return q<{ wilayah_id: number; nama: string; jenis: "KABUPATEN" | "KOTA" }>(
    `select l.wilayah_id, w.nama, w.jenis::text as jenis from app.langganan_peringatan l join ref.wilayah w on w.id = l.wilayah_id
      where l.kontak_id = $1 and l.aktif order by w.nama`,
    [kontakId],
  )
}

/** Berhenti dari satu wilayah, atau semua bila wilayahId kosong. */
export async function berhenti(kontakId: number, wilayahId?: number) {
  if (wilayahId) {
    await q(`update app.langganan_peringatan set aktif = false where kontak_id = $1 and wilayah_id = $2`, [kontakId, wilayahId])
    const sisa = await daftarLangganan(kontakId)
    if (sisa.length) return
  } else {
    await q(`update app.langganan_peringatan set aktif = false where kontak_id = $1`, [kontakId])
  }
  await q(`update app.kontak_warga set opt_in = false, berhenti_pada = now() where id = $1`, [kontakId])
}

export async function simpanLaporan(kontakId: number, wilayahId: number | null, kodeKomoditas: string, pasar: string, harga: number, peran: "PENJUAL" | "PEMBELI") {
  return q1<{ id: number; panel: number | null; selisih: number | null }>(
    `with k as (select id from ref.komoditas where kode = $3),
     panel as (
       select harga_rata2_rp_kg as h from silver.harga_kabkota_harian
        where wilayah_id = $2 and komoditas_id = (select id from k) and harga_rata2_rp_kg is not null
        order by tanggal desc limit 1
     ),
     ins as (
       insert into app.laporan_harga_warga (kontak_id, wilayah_id, komoditas_id, nama_pasar, harga_rp_kg, selisih_panel_pct, peran_pelapor)
       values ($1, $2, (select id from k), $4, $5::int, (select round(((($5::int::float8 / h) - 1) * 100)::numeric, 1)::float8 from panel), $6::app."PeranPelapor")
       returning id, selisih_panel_pct
     )
     select ins.id, (select round(h)::int from panel) as panel, ins.selisih_panel_pct as selisih from ins`,
    [kontakId, wilayahId, kodeKomoditas, pasar.slice(0, 120), harga, peran],
  )
}
