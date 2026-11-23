import { ListFilter, PanelLeftClose, RotateCcw } from "lucide-react"
import { BulanPicker } from "@/components/ui/BulanPicker"
import { MultiSelect } from "@/components/ui/MultiSelect"
import { WilayahSelect } from "@/components/ui/WilayahSelect"
import { SSTAT, STATUS, WILAYAH } from "@/lib/data"
import { BULAN_KINI, HS_ALL, SS_ALL, useFilter } from "@/lib/filter"

const WARNA_STOK = { surplus: "var(--d5)", cukup: "var(--ok)", tipis: "var(--warn)", defisit: "var(--crit)" } as const

/** Judul bagian filter dengan pintasan pilih semua dan hapus semua. */
function Judul({ teks, onSemua, onHapus }: { teks: string; onSemua: () => void; onHapus: () => void }) {
  return (
    <div className="fp-sh">
      <h3>{teks}</h3>
      <div className="fp-acts">
        <button type="button" className="fp-link" onClick={onSemua}>
          Pilih semua
        </button>
        <button type="button" className="fp-link" onClick={onHapus}>
          Hapus semua
        </button>
      </div>
    </div>
  )
}

/** Filter global di sisi kiri. Berlaku untuk semua tampilan pada halaman yang sedang dibuka. */
export function FilterPanel() {
  const f = useFilter()
  const { tersedia: t } = f
  // Halaman tanpa filter yang berlaku (Alur, Kanal warga) tidak menampilkan panel.
  if (!t.waktu && !t.wilayah && !t.hs && !t.ss) return null

  if (f.panel === "tutup") {
    return (
      <aside className="fp rail" aria-label="Filter">
        <button type="button" className="fp-rail-btn" onClick={() => f.setPanel("buka")} aria-label="Buka filter" title="Buka filter">
          <ListFilter size={15} />
          {f.aktif > 0 && <span className="fp-badge">{f.aktif}</span>}
        </button>
      </aside>
    )
  }

  return (
    <aside className="fp open" aria-label="Filter">
      <div className="fp-head">
        <ListFilter size={15} />
        <b>Filter</b>
        <span className="fp-count">
          {f.W.length}/{WILAYAH.length}
        </span>
        <button type="button" className="fp-ib" onClick={() => f.setPanel("tutup")} aria-label="Tutup filter" title="Tutup filter">
          <PanelLeftClose size={16} />
        </button>
      </div>

      {t.waktu && (
        <div className="fp-top">
          <h3>Waktu</h3>
          <BulanPicker />
        </div>
      )}

      <div className="fp-body">
        {t.wilayah && (
          <section>
            <Judul teks="Wilayah" onSemua={() => f.setWilayah(WILAYAH.map((k) => k.n))} onHapus={() => f.setWilayah([])} />
            <WilayahSelect />
          </section>
        )}

        {t.hs && (
          <section>
            <h3>Status harga</h3>
            <MultiSelect
              label="Status harga"
              options={HS_ALL.map((st) => ({ value: st, label: STATUS[st].lab, color: STATUS[st].c, n: WILAYAH.filter((k) => k.hs === st).length }))}
              value={f.hs}
              onChange={f.setHs}
            />
          </section>
        )}

        {t.ss && (
          <section>
            <h3>Status stok</h3>
            <MultiSelect
              label="Status stok"
              options={SS_ALL.map((st) => ({ value: st, label: SSTAT[st].lab, color: WARNA_STOK[st], n: WILAYAH.filter((k) => k.ss === st).length }))}
              value={f.ss}
              onChange={f.setSs}
            />
          </section>
        )}
      </div>

      <div className="fp-foot">
        <button type="button" className="fp-reset" onClick={f.reset} disabled={f.aktif === 0 && f.bulan === BULAN_KINI}>
          <RotateCcw size={13} />
          Atur ulang filter
        </button>
      </div>
    </aside>
  )
}
