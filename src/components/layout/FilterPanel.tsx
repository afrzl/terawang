import { useEffect, useRef, useState } from "react"
import { ListFilter, PanelLeftClose, RotateCcw, X } from "lucide-react"
import { MQ_SEMPIT, useMedia } from "@/hooks/useMedia"
import { BulanPicker } from "@/components/ui/BulanPicker"
import { MultiSelect } from "@/components/ui/MultiSelect"
import { WilayahSelect } from "@/components/ui/WilayahSelect"
import { Select } from "@/components/ui/Select"
import { SSTAT, STATUS, WILAYAH } from "@/lib/data"
import { SPEC_GROUPS, SPEC_LABEL, hakLapisan, isHarga, statusHargaAt, type Komoditas } from "@/lib/petaLayers"
import { usePeta, type ArusMode, type Basemap, type CitraMode } from "@/lib/peta"
import { useSelection } from "@/lib/selection"
import { useSesi } from "@/lib/sesi"
import { useLocation } from "react-router-dom"
import { BULAN_KINI, HS_ALL, N_BULAN, SS_ALL, bulanLabel, useFilter, type Satuan } from "@/lib/filter"

const WARNA_STOK = { surplus: "var(--d5)", cukup: "var(--ok)", tipis: "var(--warn)", defisit: "var(--crit)" } as const

// `est`: true = hanya untuk peran berhak estimasi, false = hanya untuk peran tanpa estimasi (berhenti di bulan lengkap terakhir).
const PINTASAN: { t: string; a: number; b: number; est?: boolean }[] = [
  { t: "3 bulan terakhir", a: BULAN_KINI - 2, b: BULAN_KINI, est: true },
  { t: "3 bulan terakhir", a: BULAN_KINI - 3, b: BULAN_KINI - 1, est: false },
  { t: "Riwayat", a: 0, b: BULAN_KINI - 1 },
  { t: "Estimasi", a: BULAN_KINI, b: N_BULAN - 1, est: true },
  { t: `Tahun ${2026 + Math.floor(BULAN_KINI / 12)}`, a: BULAN_KINI - (BULAN_KINI % 12), b: Math.min(BULAN_KINI - (BULAN_KINI % 12) + 11, N_BULAN - 1), est: true },
]

/** Pilihan waktu: satu bulan atau rentang bulan. */
function Waktu() {
  const f = useFilter()
  return (
    <div className="fp-top">
      <div className="fp-wh">
        <h3>Waktu</h3>
        <div className="seg seg-s" role="group" aria-label="Mode waktu">
          <button type="button" aria-pressed={!f.rentang} onClick={() => f.rentang && f.setRentang(false)}>
            Bulan
          </button>
          <button type="button" aria-pressed={f.rentang} onClick={() => !f.rentang && f.setRentang(true)}>
            Rentang
          </button>
        </div>
      </div>
      {f.rentang ? (
        <div className="fp-peta">
          <div className="fp-f">
            <span>Dari</span>
            <BulanPicker bulan={f.bulan} setBulan={f.setBulan} label="Bulan awal" />
          </div>
          <div className="fp-f">
            <span>Sampai</span>
            <BulanPicker bulan={f.bulan2} setBulan={f.setBulan2} label="Bulan akhir" />
          </div>
          <div className="wt-chips fp-pin" role="group" aria-label="Pintasan rentang">
            {PINTASAN.filter((p) => p.est === undefined || p.est === f.estimasi).map((p) => (
              <button key={p.t} type="button" className={`wt-chip${f.bulan === p.a && f.bulan2 === p.b ? " on" : ""}`} onClick={() => f.setRange(p.a, p.b)}>
                {p.t}
              </button>
            ))}
          </div>
          <div className="fp-sum">
            {bulanLabel(f.bulan)} – {bulanLabel(f.bulan2)} · {f.bulan2 - f.bulan + 1} bulan
          </div>
        </div>
      ) : (
        <BulanPicker bulan={f.bulan} setBulan={f.setBulan} label="Pilih bulan" />
      )}
    </div>
  )
}

/** Pengaturan lapisan peta: visualisasi, peta dasar, lapisan GEE, citra, opasitas. */
function PetaSet({ lapisan }: { lapisan: boolean }) {
  const p = usePeta()
  const { boleh } = useSesi()
  const sphp = boleh("dasbor_sphp")
  const { sel } = useSelection()
  const ck = p.citra.find((c) => c.lokasi.toLowerCase() === sel.toLowerCase())
  return (
    <div className="fp-top fp-peta">
      <h3>Peta</h3>
      {lapisan && (
        <>
          <div className="fp-f">
            <span>Visualisasi</span>
            <Select
              label="Visualisasi"
              options={SPEC_GROUPS.flatMap((g) => g.keys.filter((k) => hakLapisan(k).every(boleh)).map((k) => ({ value: k, label: SPEC_LABEL[k], grup: g.grup })))}
              value={p.layer}
              onChange={p.setLayer}
            />
          </div>
          <div className="fp-f">
            <span>Arus beras</span>
            <Select<ArusMode>
              label="Arus beras"
              options={[
                { value: "off", label: "Tidak ada" },
                ...(sphp ? [{ value: "sphp" as ArusMode, label: "Rekomendasi SPHP" }] : []),
                { value: "dagang", label: "Pola pasokan" },
              ]}
              value={p.arus}
              onChange={p.setArus}
            />
          </div>
          {isHarga(p.layer) && (
            <div className="fp-f">
              <span>Jenis beras</span>
              <Select<Komoditas>
                label="Jenis beras"
                options={[
                  { value: "medium", label: "Medium" },
                  { value: "premium", label: "Premium" },
                ]}
                value={p.kom}
                onChange={p.setKom}
              />
            </div>
          )}
        </>
      )}
      <div className="fp-f">
        <span>Peta dasar</span>
        <Select<Basemap>
          label="Peta dasar"
          options={[
            { value: "satelit", label: "Satelit" },
            { value: "jalan", label: "Peta" },
          ]}
          value={p.basemap}
          onChange={p.setBasemap}
        />
      </div>
      {!lapisan && (
        <>
      {p.overlays.length > 0 && (
        <div className="fp-f">
          <span>Lapisan GEE</span>
          <Select label="Lapisan GEE" options={[{ value: "off", label: "Tidak ada" }, ...p.overlays.map((o) => ({ value: o.id, label: o.label }))]} value={p.ov} onChange={p.setOv} />
        </div>
      )}
      <div className="fp-f">
        <span>Citra {sel}</span>
        <Select<CitraMode>
          label={`Citra ${sel}`}
          disabled={!ck}
          placeholder="Belum ada citra"
          options={[
            { value: "off", label: "Tidak ditampilkan" },
            { value: "sebelum", label: "Sebelum tanam (Sentinel-2)" },
            { value: "sesudah", label: "Sesudah tanam (Sentinel-2)" },
            { value: "kelas", label: "Kelas petak" },
          ]}
          value={ck ? p.citraMode : ("" as CitraMode)}
          onChange={p.setCitraMode}
        />
      </div>
        </>
      )}
      <label className="fp-f fp-op">
        <span>
          Opasitas isian <b>{Math.round(p.fillOp * 100)}%</b>
        </span>
        <input type="range" min={0} max={0.95} step={0.05} value={p.fillOp} onChange={(e) => p.setFillOp(+e.target.value)} />
      </label>
    </div>
  )
}

/** Filter global di sisi kiri. Berlaku untuk semua tampilan pada halaman yang sedang dibuka.
 *  Di HP dan tablet tegak (< 900 px) panel menjadi laci yang dibuka dari bilah Filter di atas konten. */
export function FilterPanel() {
  const f = useFilter()
  const { pathname } = useLocation()
  const { tersedia: t } = f
  const sempit = useMedia(MQ_SEMPIT)
  // Laci terbuka hanya untuk halaman tempat ia dibuka; pindah halaman atau melebar ke desktop otomatis menutupnya.
  const [laciDi, setLaciDi] = useState<string | null>(null)
  const laci = sempit && laciDi === pathname
  const setLaci = (buka: boolean) => setLaciDi(buka ? pathname : null)
  const laciRef = useRef<HTMLElement>(null)
  const pemicuRef = useRef<HTMLButtonElement>(null)

  // Laci terbuka: halaman di belakang tidak ikut bergulir, Esc menutup, fokus pindah ke laci.
  useEffect(() => {
    if (!laci) return
    const html = document.documentElement
    const lama = html.style.overflow
    html.style.overflow = "hidden"
    laciRef.current?.focus()
    const pemicu = pemicuRef.current
    const esc = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector(".laci [aria-expanded=\"true\"]")) setLaciDi(null)
    }
    document.addEventListener("keydown", esc)
    return () => {
      html.style.overflow = lama
      document.removeEventListener("keydown", esc)
      pemicu?.focus()
    }
  }, [laci])

  // Halaman tanpa filter yang berlaku (Alur, Kanal warga) tidak menampilkan panel.
  if (!t.waktu && !t.wilayah && !t.hs && !t.ss) return null

  const isi = (
      <div className="fp-scroll">
      {t.waktu && <Waktu />}

      {t.wilayah && (
        <div className="fp-top">
          <h3>Wilayah</h3>
          <WilayahSelect />
        </div>
      )}

      {t.jenis && (
        <div className="fp-top">
          <h3>Jenis beras</h3>
          <MultiSelect<Komoditas>
            label="Jenis beras"
            options={[
              { value: "medium", label: "Medium", color: "var(--accent)" },
              { value: "premium", label: "Premium", color: "var(--warn)" },
            ]}
            value={f.jenisHarga}
            onChange={f.setJenisHarga}
          />
        </div>
      )}

      {t.satuan && (
        <div className="fp-top">
          <h3>Satuan produksi</h3>
          <Select<Satuan>
            label="Satuan produksi"
            options={[
              { value: "gkp", label: "Gabah kering panen (GKP)" },
              { value: "gkg", label: "Gabah kering giling (GKG)" },
              { value: "beras", label: "Beras" },
            ]}
            value={f.satuan}
            onChange={f.setSatuan}
          />
        </div>
      )}

      {t.peta && <PetaSet lapisan={pathname === "/"} />}

      <div className="fp-body">
        {t.hs && (
          <section>
            <h3>Status harga</h3>
            <MultiSelect
              label="Status harga"
              options={HS_ALL.map((st) => ({ value: st, label: STATUS[st].lab, color: STATUS[st].c, n: WILAYAH.filter((k) => (pathname === "/harga" ? f.jenisHarga : [f.kom]).some((j) => statusHargaAt(k, 4, j) === st)).length }))}
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

      </div>

  )
  const reset = (
    <button type="button" className="fp-reset" onClick={f.reset} disabled={f.aktif === 0 && f.bulan === f.bulanAwal && !f.rentang}>
      <RotateCcw size={13} />
      Atur ulang filter
    </button>
  )

  if (sempit) {
    const ringkas = [t.waktu && (f.rentang ? `${bulanLabel(f.bulan)} – ${bulanLabel(f.bulan2)}` : bulanLabel(f.bulan)), t.wilayah && `${f.W.length}/${WILAYAH.length} wilayah`].filter(Boolean).join(" · ")
    return (
      <>
        <div className="fp-bar">
          <button type="button" ref={pemicuRef} className="fp-bar-btn" onClick={() => setLaci(true)} aria-haspopup="dialog" aria-expanded={laci}>
            <ListFilter size={15} />
            Filter
            {f.aktif > 0 && <span className="fp-badge">{f.aktif}</span>}
          </button>
          <span className="fp-bar-sum">{ringkas}</span>
        </div>
        {laci && (
          <>
            <div className="laci-bg" onClick={() => setLaci(false)} aria-hidden="true" />
            <aside className="fp open laci" role="dialog" aria-modal="true" aria-label="Filter" ref={laciRef} tabIndex={-1}>
              <div className="fp-head">
                <ListFilter size={15} />
                <b>Filter</b>
                <span className="fp-count">
                  {f.W.length}/{WILAYAH.length}
                </span>
                <button type="button" className="fp-ib" onClick={() => setLaci(false)} aria-label="Tutup filter" title="Tutup filter">
                  <X size={18} />
                </button>
              </div>
              {isi}
              <div className="fp-foot laci-foot">
                {reset}
                <button type="button" className="laci-ok" onClick={() => setLaci(false)}>
                  Lihat hasil
                </button>
              </div>
            </aside>
          </>
        )}
      </>
    )
  }

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

      {isi}
      <div className="fp-foot">{reset}</div>
    </aside>
  )
}
