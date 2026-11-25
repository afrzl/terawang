import pg from "pg"
import { config } from "./config.ts"

// numeric/bigint dikembalikan sebagai number (nilai di sini jauh di bawah 2^53)
pg.types.setTypeParser(1700, (v) => Number(v))
pg.types.setTypeParser(20, (v) => Number(v))
// kolom DATE dibiarkan string YYYY-MM-DD supaya tidak bergeser zona waktu
pg.types.setTypeParser(1082, (v) => v)

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 5 })

export async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const r = await pool.query(sql, params)
  return r.rows as T[]
}

export async function q1<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | undefined> {
  return (await q<T>(sql, params))[0]
}
