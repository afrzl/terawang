/** Telemetri ringan di memori untuk halaman admin: webhook GoWA, balasan, dan panggilan OpenAI. */
export const pantau = {
  mulai: Date.now(),
  webhook: { terakhir: 0, jumlah: {} as Record<string, number>, tandaTanganGagal: 0, terakhirGagalTanda: 0, pesanTerakhir: 0 },
  balasan: { terakhirOk: 0, terakhirGagal: 0, galat: "", jumlahOk: 0, jumlahGagal: 0 },
  llm: { terakhir: 0, ok: true, galat: "", token: 0, terakhirGagal: 0 },
  perangkat: { kejadian: "", waktu: 0 }, // device.logged_out, device.temporary_ban, ...
}

export function catatWebhook(event: string) {
  pantau.webhook.terakhir = Date.now()
  pantau.webhook.jumlah[event] = (pantau.webhook.jumlah[event] ?? 0) + 1
  if (/^device\./.test(event)) pantau.perangkat = { kejadian: event, waktu: Date.now() }
}
