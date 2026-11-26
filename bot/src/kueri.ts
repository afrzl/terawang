/**
 * Kueri bebas baca-saja untuk OpenAI: model menulis satu SELECT, dijalankan dalam transaksi READ ONLY
 * dengan role terawang_bot_baca (tanpa akses data pribadi), batas waktu 5 detik, maksimal 50 baris.
 */
import { pool } from "./db.ts"

const DILARANG = /\b(insert|update|delete|merge|drop|alter|create|truncate|grant|revoke|copy|call|do|vacuum|analyze|set|reset|lock|listen|notify|refresh|security|pg_sleep|pg_read|lo_|dblink)\b/i

export function periksaSql(sql: string): string | null {
  const s = sql.trim().replace(/;+\s*$/, "")
  if (!/^(select|with)\b/i.test(s)) return "hanya SELECT yang diizinkan"
  if (s.includes(";")) return "hanya satu pernyataan"
  if (/--|\/\*/.test(s)) return "komentar tidak diizinkan"
  if (DILARANG.test(s.replace(/'[^']*'/g, "''"))) return "kata kunci tidak diizinkan"
  if (s.length > 2000) return "kueri terlalu panjang"
  return null
}

export async function kueriData(sql: string): Promise<{ baris: Record<string, unknown>[]; terpotong: boolean } | { galat: string }> {
  const salah = periksaSql(sql)
  if (salah) return { galat: salah }
  const c = await pool.connect()
  try {
    await c.query("begin read only")
    await c.query("set local role terawang_bot_baca")
    await c.query("set local statement_timeout = '5s'")
    const r = await c.query(`select * from (${sql.trim().replace(/;+\s*$/, "")}) as hasil limit 51`)
    return { baris: r.rows.slice(0, 50), terpotong: r.rows.length > 50 }
  } catch (e) {
    // pesan galat Postgres (kolom salah, dsb.) membantu model memperbaiki kueri; tidak ditampilkan ke pengguna
    return { galat: String((e as Error).message).slice(0, 200) }
  } finally {
    await c.query("rollback").catch(() => {})
    c.release()
  }
}

/** Daftar tabel dan kolom yang boleh dibaca role terawang_bot_baca, ringkas untuk model. */
let cacheSkema: { waktu: number; isi: unknown } | null = null
export async function skemaData() {
  if (cacheSkema && Date.now() - cacheSkema.waktu < 3600_000) return cacheSkema.isi
  const r = await pool.query<{ tabel: string; kolom: string }>(
    `select c.table_schema || '.' || c.table_name as tabel, string_agg(c.column_name || ':' || c.data_type, ', ' order by c.ordinal_position) as kolom
       from information_schema.columns c
      where c.table_schema in ('ref', 'silver', 'gold', 'bronze', 'app')
        and has_table_privilege('terawang_bot_baca', quote_ident(c.table_schema) || '.' || quote_ident(c.table_name), 'select')
      group by 1 order by 1`,
  )
  const isi = { tabel: r.rows, catatan: "Pakai join ke ref.wilayah (id, nama, jenis KABUPATEN/KOTA) untuk nama wilayah. Batasi hasil seperlunya." }
  cacheSkema = { waktu: Date.now(), isi }
  return isi
}
