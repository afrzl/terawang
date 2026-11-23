import { MessageCircle } from "lucide-react"
import { useMemo } from "react"
import { Sparkline } from "@/components/charts/Sparkline"
import { WaPlayer, type WaScenario } from "@/components/ui/WaPlayer"
import { DataTable, type Column } from "@/components/ui/DataTable"
import { Panel, ViewHeader } from "@/components/ui/Panel"
import { HargaPill } from "@/components/ui/Pill"
import { HET, STATUS, WILAYAH, byName, fcDates, type Wilayah } from "@/lib/data"
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
  { head: "Wilayah", cell: (q) => <b>{q.n}</b>, sort: (q) => q.n },
  { head: "Status", cell: (q) => <HargaPill s={q.hs} />, sort: (q) => ({ aman: 0, waspada: 1, siaga: 2 })[q.hs] * 1e5 + q.p4 },
  { head: "Pelanggan", right: true, num: true, cell: (q) => nf(SUBSCRIBERS[q.n] ?? 0), sort: (q) => SUBSCRIBERS[q.n] ?? 0 },
  {
    head: "Isi siaran",
    sort: (q) => q.p4,
    style: { whiteSpace: "normal", minWidth: 240 },
    cell: (q) => `Harga beras diperkirakan ${rp(q.p4)}/kg dalam 4 pekan. Beras SPHP tersedia di pasar dan RPK terdekat.`,
  },
]

function MiniMap() {
  return (
    <svg className="ph-map" viewBox="0 0 240 110" aria-hidden="true">
      <rect width="240" height="110" fill="var(--ph-map)" />
      <g stroke="var(--ph-road)" strokeWidth="7" fill="none" strokeLinecap="round">
        <path d="M-5 72 C60 64 110 84 245 58" />
        <path d="M70 -5 L92 115" />
        <path d="M168 -5 C160 40 176 70 160 115" />
      </g>
      <g stroke="var(--ph-road)" strokeWidth="3" fill="none" opacity=".8">
        <path d="M0 28 H240" />
        <path d="M30 0 V110" />
        <path d="M128 0 V110" />
        <path d="M205 0 V110" />
      </g>
      <rect x="138" y="80" width="22" height="18" rx="3" fill="#B5D49C" opacity=".8" />
      {[
        [96, 50, "1"],
        [176, 36, "2"],
        [44, 86, "3"],
      ].map(([x, y, n]) => (
        <g key={n} transform={`translate(${x} ${y})`}>
          <path d="M0 0c-7-9-11-13-11-19a11 11 0 0 1 22 0c0 6-4 10-11 19z" fill="#1D3F74" />
          <text y="-15" textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff" fontFamily="var(--f-body)">
            {n}
          </text>
        </g>
      ))}
      <circle cx="120" cy="66" r="5" fill="#2F80ED" stroke="#fff" strokeWidth="2" />
    </svg>
  )
}



export default function Whatsapp() {
  const { sel } = useSelection()
  const k = byName[sel]

  const scenarios = useMemo<WaScenario[]>(() => {
    const arah = k.fc[1].m - k.pNow
    const pasar = `Pasar ${k.isKota ? "Besar" : "Induk"} ${k.n.replace("Kota ", "")}`
    const siaga = k.hs === "siaga" ? k : WILAYAH.filter((q) => q.hs === "siaga").sort((a, b) => b.p4 - a.p4)[0]
    const lapor = Math.round((k.pNow + 260) / 50) * 50
    return [
      {
        title: "Cek harga",
        clock: "07.12",
        caps: [
          "Simpan nomor TERAWANG Jatim, lalu buka obrolannya di WhatsApp.",
          `Ketik HARGA diikuti nama wilayah, misalnya HARGA ${k.n.toUpperCase()}, lalu kirim.`,
          "Dalam hitungan detik bot membalas: harga medium dan premium, posisinya terhadap HET, dan arah harga 2 pekan.",
          "Tombol balasan cepat membawa ke langkah berikutnya. Ketuk SPHP untuk mencari beras murah.",
        ],
        tapOption: "SPHP",
        items: [
          { type: "day", text: "Hari ini" },
          { type: "out", text: `HARGA ${k.n.toUpperCase()}`, time: "07.12" },
          {
            type: "card",
            time: "07.12",
            accent: STATUS[k.hs].c,
            title: `Harga beras ${k.n} · pekan 44`,
            chart: <Sparkline vals={k.price.slice(-10)} color={STATUS[k.hs].c} fc={k.fc.slice(0, 2).map((f) => f.m)} />,
            rows: [
              ["Medium", <b key="m">{rp(k.pNow)}/kg</b>],
              ["Premium", `${rp(k.prem)}/kg`],
              ["HET medium", "Rp13.500/kg"],
              ["2 pekan lagi", `${arah > 40 ? "naik" : "stabil"} ± ${rp(k.fc[1].m)}`],
            ],
            foot: (
              <>
                Status: <b style={{ color: STATUS[k.hs].c }}>{STATUS[k.hs].lab.toUpperCase()}</b>
              </>
            ),
          },
          { type: "quick", options: ["SPHP", "BANDINGKAN", "LANGGANAN"] },
        ],
      },
      {
        title: "Cari beras SPHP",
        clock: "07.13",
        caps: [
          "Ketik SPHP, atau ketuk tombolnya, untuk mencari beras program pemerintah.",
          "Bot menunjukkan titik penjualan beras SPHP terdekat beserta jadwalnya.",
          "Ketuk LANGGANAN supaya diberi tahu otomatis saat harga di wilayahmu naik.",
        ],
        tapOption: "LANGGANAN",
        items: [
          { type: "out", text: "SPHP", time: "07.13" },
          {
            type: "card",
            time: "07.13",
            accent: "var(--accent)",
            title: "Beras SPHP Rp12.500/kg · kemasan 5 kg",
            chart: <MiniMap />,
            numbered: true,
            rows: [
              ["1", `${pasar} · Selasa & Jumat`],
              ["2", "RPK Bulog terdekat · 08.00–15.00"],
              ["3", `Gerakan Pangan Murah · Sabtu, ${dfmt(fcDates[0])}`],
            ],
          },
          { type: "quick", options: ["BANDINGKAN", "LANGGANAN"] },
        ],
      },
      {
        title: "Peringatan otomatis",
        clock: "06.00",
        caps: [
          "Setelah berlangganan, kamu tidak perlu bertanya lagi.",
          "Setiap Senin pukul 06.00 bot mengirim peringatan kalau harga di wilayahmu masuk status Waspada atau Siaga.",
          "Balas SPHP untuk lokasi beras murah, atau BERHENTI kapan saja untuk berhenti berlangganan.",
        ],
        items: [
          { type: "day", text: "Senin, 2 Nov" },
          {
            type: "card",
            time: "06.00",
            accent: "var(--crit)",
            title: `⚠ Peringatan harga · ${siaga.n}`,
            chart: <Sparkline vals={siaga.price.slice(-10)} color="var(--crit)" fc={siaga.fc.map((f) => f.m)} />,
            rows: [
              ["Kini", rp(siaga.pNow) + "/kg"],
              ["Prakiraan 4 pekan", <b key="p">{rp(siaga.p4)}/kg</b>],
              ["Di atas HET", `+${nf((siaga.p4 / HET - 1) * 100, 1)}%`],
            ],
            foot: "Beras SPHP tersedia di pasar dan RPK terdekat. Balas SPHP untuk lokasinya.",
          },
          { type: "quick", options: ["SPHP", "BERHENTI"] },
        ],
      },
      {
        title: "Lapor harga warga",
        clock: "09.41",
        caps: [
          "Warga juga bisa ikut membantu. Ketik LAPOR untuk mengirim harga di pasarmu.",
          "Bot menjelaskan format laporannya.",
          "Kirim nama pasar, jenis beras, dan harga per kilogram.",
          "Laporan diterima dan dibandingkan dengan Panel Harga. Setelah divalidasi, laporan ikut dipakai model.",
        ],
        items: [
          { type: "out", text: "LAPOR", time: "09.40" },
          { type: "in", text: "Kirim dengan format:\nnama pasar, jenis beras, harga/kg", time: "09.40" },
          { type: "out", text: `${pasar}, medium, ${nf(lapor)}`, time: "09.41" },
          {
            type: "card",
            time: "09.41",
            accent: "var(--ok)",
            title: "✓ Laporan diterima",
            rows: [
              ["Pasar", pasar],
              ["Harga", `${rp(lapor)}/kg`],
              ["vs Panel Harga", `${lapor >= k.pNow ? "+" : "−"}${nf(Math.abs((lapor / k.pNow - 1) * 100), 1)}%`],
              ["Status", "menunggu validasi"],
            ],
            foot: "Terima kasih, laporan Anda membantu memantau harga di wilayah ini.",
          },
        ],
      },
    ]
  }, [k])

  const broadcast = WILAYAH.filter((q) => q.hs !== "aman")
    .sort((a, b) => b.p4 - a.p4)
    .slice(0, 8)

  return (
    <section className="view">
      <ViewHeader icon={MessageCircle} title="Kanal warga" />
      <div className="ph-stage">
        <WaPlayer scenarios={scenarios} />
      </div>
      <div className="grid-2">
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
    </section>
  )
}
