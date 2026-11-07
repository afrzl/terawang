import { useMemo } from "react"
import { DataTable, type Column } from "@/components/ui/DataTable"
import { Panel, ViewHeader } from "@/components/ui/Panel"
import { HargaPill } from "@/components/ui/Pill"
import { STATUS, WILAYAH, byName, dist, fcDates, type Wilayah } from "@/lib/data"
import { dfmt, nf, rp } from "@/lib/format"
import { useSelection } from "@/lib/selection"

const COMMANDS: [string, string][] = [
  ["HARGA <wilayah>", "Harga beras medium dan premium terkini, perbandingan dengan HET, dan arah harga 2 pekan."],
  ["SPHP <wilayah>", "Titik penjualan beras SPHP terdekat (pasar, RPK, Gerakan Pangan Murah) dan jadwalnya."],
  ["BANDINGKAN", 'Wilayah sekitar dengan harga lebih rendah, untuk menjawab "ke mana cari beras murah".'],
  ["LAPOR", "Warga melaporkan harga di pasar setempat. Laporan menjadi data tambahan setelah divalidasi."],
  ["LANGGANAN", "Peringatan otomatis saat status harga wilayah berubah menjadi Waspada atau Siaga."],
]

/** Jumlah pelanggan siaran (simulasi), dihitung sekali per wilayah. */
const SUBSCRIBERS: Record<string, number> = Object.fromEntries(
  WILAYAH.filter((q) => q.hs !== "aman").map((q) => [q.n, Math.round(q.pop * 1.6 * (0.5 + q.R() * 0.5))]),
)

const broadcastColumns: Column<Wilayah>[] = [
  { head: "Wilayah", cell: (q) => <b>{q.n}</b> },
  { head: "Status", cell: (q) => <HargaPill s={q.hs} /> },
  { head: "Pelanggan", right: true, num: true, cell: (q) => nf(SUBSCRIBERS[q.n] ?? 0) },
  {
    head: "Isi siaran",
    style: { whiteSpace: "normal", minWidth: 240 },
    cell: (q) => `Harga beras diperkirakan ${rp(q.p4)}/kg dalam 4 pekan. Beras SPHP tersedia di pasar dan RPK terdekat.`,
  },
]

export default function Whatsapp() {
  const { sel } = useSelection()
  const k = byName[sel]

  const msgs = useMemo(() => {
    const near = WILAYAH.filter((q) => q !== k)
      .sort((a, b) => dist(a.n, k.n) - dist(b.n, k.n))
      .slice(0, 4)
      .sort((a, b) => a.pNow - b.pNow)
      .slice(0, 2)
    const arah = k.fc[1].m - k.pNow
    return [
      { d: "out", t: `HARGA ${k.n.toUpperCase()}`, tm: "07.12" },
      {
        d: "in",
        t: `Harga beras ${k.n}, pekan 44:\n• Medium ${rp(k.pNow)}/kg (HET Rp13.500)\n• Premium ${rp(k.prem)}/kg\nArah 2 pekan: ${arah > 40 ? "naik" : "stabil"} ke sekitar ${rp(k.fc[1].m)}/kg.\nStatus: ${STATUS[k.hs].lab.toUpperCase()}`,
        tm: "07.12",
      },
      { d: "out", t: "SPHP", tm: "07.13" },
      {
        d: "in",
        t: `Beras SPHP Rp12.500/kg (kemasan 5 kg) tersedia di:\n1. Pasar ${k.isKota ? "Besar" : "Induk"} ${k.n.replace("Kota ", "")} · Selasa & Jumat\n2. RPK Bulog terdekat · setiap hari 08.00–15.00\n3. Gerakan Pangan Murah di kantor kecamatan · Sabtu, ${dfmt(fcDates[0])}`,
        tm: "07.13",
      },
      { d: "out", t: "BANDINGKAN", tm: "07.14" },
      {
        d: "in",
        t: `Wilayah sekitar dengan harga medium lebih rendah:\n• ${near[0].n} ${rp(near[0].pNow)}/kg\n• ${near[1].n} ${rp(near[1].pNow)}/kg\nKetik LANGGANAN untuk dapat peringatan bila harga di ${k.n} naik.`,
        tm: "07.14",
      },
    ]
  }, [k])

  const broadcast = WILAYAH.filter((q) => q.hs !== "aman")
    .sort((a, b) => b.p4 - a.p4)
    .slice(0, 8)

  return (
    <section className="view">
      <ViewHeader eyebrow="Kanal warga" title="Bot WhatsApp TERAWANG">
        Warga dan pedagang kecil tidak perlu membuka dasbor. Cukup kirim pesan untuk tahu harga beras di wilayahnya dan titik penjualan beras SPHP
        terdekat. Isi jawaban diambil dari data yang sama dengan dasbor.
      </ViewHeader>
      <div className="wa-grid">
        <div className="phone" aria-label="Contoh percakapan">
          <div className="bar">
            <b>TERAWANG Jatim</b>
            <span>akun resmi · info harga &amp; stok beras</span>
          </div>
          <div className="chat">
            {msgs.map((m, i) => (
              <div key={i} className={`msg ${m.d}`}>
                {m.t}
                <time>{m.tm}</time>
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
          <div>
            <div className="eyebrow" style={{ marginBottom: 8 }}>
              Perintah yang dikenali
            </div>
            <div className="cmds">
              {COMMANDS.map(([c, d]) => (
                <div className="cmd" key={c}>
                  <code>{c}</code>
                  <span>{d}</span>
                </div>
              ))}
            </div>
          </div>
          <Panel title="Siaran peringatan terjadwal" note="Dikirim Senin 06.00 ke pelanggan wilayah terkait">
            <DataTable rows={broadcast} columns={broadcastColumns} rowKey={(q) => q.n} rowName={(q) => q.n} />
          </Panel>
        </div>
      </div>
    </section>
  )
}
