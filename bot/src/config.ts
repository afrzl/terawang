/** Konfigurasi dari environment. Nilai rahasia hanya dari .env, tidak pernah di kode. */
const env = process.env

function angka(nama: string, bawaan: number): number {
  const v = Number(env[nama])
  return Number.isFinite(v) && env[nama] !== "" && env[nama] !== undefined ? v : bawaan
}

export const config = {
  port: angka("PORT", 8080),
  databaseUrl: env.DATABASE_URL ?? "",
  gowa: {
    url: (env.GOWA_URL ?? "http://gowa:3000").replace(/\/$/, ""),
    basicAuth: env.GOWA_BASIC_AUTH ?? "", // "user:pass"
    deviceId: env.GOWA_DEVICE_ID ?? "", // dipakai bila GoWA multi-device butuh header X-Device-Id
    webhookSecret: env.WHATSAPP_WEBHOOK_SECRET ?? "",
  },
  openai: {
    apiKey: env.OPENAI_API_KEY ?? "",
    model: env.OPENAI_MODEL ?? "gpt-5-mini",
    reasoningEffort: env.OPENAI_REASONING_EFFORT ?? "minimal", // kosongkan untuk model non-penalaran
    batasHarianPerNomor: angka("LLM_BATAS_HARIAN", 30),
  },
  /** HET beras medium cadangan bila app.ambang_harga belum diisi (zona Jawa). */
  hetMediumCadangan: angka("HET_MEDIUM", 13500),
  siaran: {
    aktif: (env.SIARAN_AKTIF ?? "1") !== "0",
    intervalMenit: angka("SIARAN_INTERVAL_MENIT", 10),
    jedaMinDetik: angka("SIARAN_JEDA_MIN", 3),
    jedaMaksDetik: angka("SIARAN_JEDA_MAKS", 8),
  },
  /** Nomor admin (628xx) yang boleh memakai perintah ADMIN. Pisahkan dengan koma. */
  admin: (env.ADMIN_WA ?? "").split(",").map((s) => s.replace(/\D/g, "")).filter(Boolean),
  /** Token untuk endpoint /api/tanya (simulator dasbor). Kosong = endpoint mati. */
  apiToken: env.BOT_API_TOKEN ?? "",
}
