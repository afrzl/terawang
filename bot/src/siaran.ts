/**
 * Siaran peringatan ke pelanggan (app.langganan_peringatan).
 * - SIAGA: dikirim segera (diperiksa tiap SIARAN_INTERVAL_MENIT).
 * - WASPADA: ringkasan tiap Senin 06.00 WIB.
 * Pipeline mengganti baris app.peringatan setiap kali berjalan, jadi penanda "sudah dikirim" dicek per
 * (kontak, wilayah, jenis, tingkat) dalam 7 hari terakhir, bukan per id peringatan.
 */
import { config } from "./config.ts"
import { q } from "./db.ts"
import { teksSiaran } from "./format.ts"
import { kirim } from "./gowa.ts"
import * as kontak from "./kontak.ts"
import { labelWilayah } from "./wilayah.ts"

type Calon = { kontak_id: number; nomor_wa: string; peringatan_id: number; wilayah_id: number; nama: string; wjenis: "KABUPATEN" | "KOTA"; jenis: string; tingkat: "WASPADA" | "SIAGA"; judul: string; pesan: string }

async function calon(tingkat: "SIAGA" | "WASPADA", hariUlang: number): Promise<Calon[]> {
  return q<Calon>(
    `select k.id as kontak_id, k.nomor_wa, p.id as peringatan_id, p.wilayah_id, w.nama, w.jenis::text as wjenis,
            p.jenis::text as jenis, p.tingkat::text as tingkat, p.judul, p.pesan
       from app.peringatan p
       join app.langganan_peringatan l on l.wilayah_id = p.wilayah_id and l.aktif
       join app.kontak_warga k on k.id = l.kontak_id and k.opt_in
       join ref.wilayah w on w.id = p.wilayah_id
      where p.status = 'AKTIF' and (p.berlaku_sampai is null or p.berlaku_sampai > now())
        and p.tingkat = $1::app."TingkatPeringatan"
        and (l.tingkat_minimum = 'WASPADA' or p.tingkat = 'SIAGA')
        and not exists (
          select 1 from app.notifikasi n join app.peringatan p2 on p2.id = n.peringatan_id
           where n.kontak_id = k.id and n.kanal = 'WHATSAPP' and n.status in ('ANTRE', 'TERKIRIM', 'DIBACA')
             and p2.wilayah_id = p.wilayah_id and p2.jenis = p.jenis and p2.tingkat = p.tingkat
             and n.dibuat_pada > now() - make_interval(days => $2)
        )
      order by k.id, p.wilayah_id`,
    [tingkat, hariUlang],
  )
}

const jeda = () => new Promise((r) => setTimeout(r, 1000 * (config.siaran.jedaMinDetik + Math.random() * (config.siaran.jedaMaksDetik - config.siaran.jedaMinDetik))))

async function kirimKelompok(rows: Calon[]): Promise<number> {
  const perKontak = new Map<number, Calon[]>()
  for (const r of rows) perKontak.set(r.kontak_id, [...(perKontak.get(r.kontak_id) ?? []), r])
  let terkirim = 0
  for (const [kontakId, xs] of perKontak) {
    const ids = await q<{ id: number }>(
      `insert into app.notifikasi (peringatan_id, kanal, kontak_id, status)
       select unnest($1::int[]), 'WHATSAPP', $2, 'ANTRE' returning id`,
      [xs.map((x) => x.peringatan_id), kontakId],
    )
    const teks = teksSiaran(xs.map((x) => ({ id: x.peringatan_id, wilayah_id: x.wilayah_id, wilayah: labelWilayah({ nama: x.nama, jenis: x.wjenis }), jenis: x.jenis, tingkat: x.tingkat, judul: x.judul, pesan: x.pesan, dibuat_pada: "" })))
    try {
      const mid = await kirim(xs[0].nomor_wa, teks)
      await q(`update app.notifikasi set status = 'TERKIRIM', dikirim_pada = now(), pesan_id_eksternal = $2 where id = any($1::int[])`, [ids.map((i) => i.id), mid ?? null])
      await kontak.catat(kontakId, "KELUAR", teks, "siaran", xs[0].wilayah_id)
      terkirim++
    } catch (e) {
      await q(`update app.notifikasi set status = 'GAGAL', galat = $2 where id = any($1::int[])`, [ids.map((i) => i.id), String((e as Error).message).slice(0, 500)])
      console.error(`[siaran] gagal ke kontak ${kontakId}:`, e)
    }
    await jeda()
  }
  return terkirim
}

let berjalan = false

export async function siaranSiaga(): Promise<number> {
  return kirimKelompok(await calon("SIAGA", 7))
}

export async function siaranWaspadaMingguan(): Promise<number> {
  return kirimKelompok(await calon("WASPADA", 6))
}

function jamWib(d = new Date()) {
  const s = d.toLocaleString("en-US", { timeZone: "Asia/Jakarta", weekday: "short", hour: "2-digit", hour12: false })
  const [hari, jam] = s.split(", ")
  return { hari, jam: Number(jam) }
}

/** Penjadwal sederhana di dalam proses bot. */
export function mulaiPenjadwal() {
  if (!config.siaran.aktif) return console.log("[siaran] nonaktif (SIARAN_AKTIF=0)")
  let pekanTerakhir = ""
  const putar = async () => {
    if (berjalan) return
    berjalan = true
    try {
      const n = await siaranSiaga()
      if (n) console.log(`[siaran] siaga terkirim ke ${n} kontak`)
      const { hari, jam } = jamWib()
      const kunci = new Date().toISOString().slice(0, 10)
      if (hari === "Mon" && jam === 6 && pekanTerakhir !== kunci) {
        pekanTerakhir = kunci
        const m = await siaranWaspadaMingguan()
        console.log(`[siaran] ringkasan waspada mingguan terkirim ke ${m} kontak`)
      }
    } catch (e) {
      console.error("[siaran] galat:", e)
    } finally {
      berjalan = false
    }
  }
  setTimeout(putar, 15_000)
  setInterval(putar, config.siaran.intervalMenit * 60_000)
}
