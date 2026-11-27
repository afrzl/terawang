import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { PetaInteraktif } from "@/components/charts/PetaInteraktif"
import { Legenda } from "@/components/charts/Legenda"
import { HargaPill, StokPill } from "@/components/ui/Pill"
import { WeekSlider } from "@/components/ui/WeekSlider"
import type { Wilayah } from "@/lib/data"
import { HET, HET_PREMIUM, byName, fcHarga, flowsBulan, pNowHarga, risk } from "@/lib/data"
import { covBulan, hargaAt, makeSpec, pAtasHet, produksiBeras, produksiPrevRentang, statusHargaAt, yoyRentang } from "@/lib/petaLayers"
import { NOW, dfmt, nf, rp, sum } from "@/lib/format"
import { useSelection } from "@/lib/selection"
import { useSesi } from "@/lib/sesi"
import { Terkunci } from "@/components/ui/Terkunci"
import { useWilayah } from "@/lib/filter"
import { usePeta } from "@/lib/peta"
import { REGIONS } from "@/lib/arus"
import { BULAN_KINI, bulanLabel, useFilter } from "@/lib/filter"

export default function Ringkasan() {
  const wil = useWilayah()
  const { layer, kom, hor, setHor, arus, dim, setLayer, setArus } = usePeta()
  const { siap, boleh } = useSesi()
  // Pilihan SPHP yang tersimpan dibatalkan bila pengguna tidak berhak melihatnya.
  useEffect(() => {
    if (!siap || boleh("dasbor_sphp")) return
    if (layer === "sphp") setLayer("statusHarga")
    if (arus === "sphp") setArus("off")
  }, [siap, boleh, layer, arus, setLayer, setArus])
  const { mulai, akhir } = useFilter()
  const { select } = useSelection()
  // Panel kanan menampilkan daftar perhatian sampai pengguna memilih satu wilayah.
  const [detail, setDetail] = useState(false)
  // Di HP panel kanan berada di bawah peta; memilih dari daftar menggulir kartu detail ke layar.
  const kananRef = useRef<HTMLDivElement>(null)
  // Filter dilepas (semua wilayah): kembali ke daftar perhatian.
  const semuaWil = wil.length === Object.keys(byName).length
  useEffect(() => {
    if (semuaWil) setDetail(false)
  }, [semuaWil])
  const spec = useMemo(() => makeSpec(layer, { mulai, akhir, hor, kom }), [layer, mulai, akhir, hor, kom])
  const onHor = useCallback((h: number) => setHor(h), [setHor])
  // Jumlah wilayah berstatus Siaga (atau peluang > 50%) tiap horizon, untuk strip pada penggeser.
  const counts = spec.waktu === "horizon" ? [1, 2, 3, 4].map((h) => wil.filter((k) => (layer === "pAtasHet" ? pAtasHet(k, h, kom) >= 0.5 : statusHargaAt(k, h, kom) === "siaga")).length) : []
  // K1: produksi beras dalam rentang bulan filter; YoY memakai periode yang sama.
  const bulanR = Array.from({ length: akhir - mulai + 1 }, (_, j) => mulai + j)
  const prodT = sum(wil, (k) => sum(bulanR, (i) => produksiBeras(k, i)))
  const prodPrev = sum(wil, (k) => produksiPrevRentang(k, mulai, akhir))
  const yoy = prodPrev > 0 ? prodT / prodPrev - 1 : 0
  // K2: stok dan status pada akhir bulan terpilih.
  const stT = sum(wil, (k) => covBulan(k, akhir) * k.C * 1000)
  const nDef = wil.filter((k) => covBulan(k, akhir) < 0.75).length
  const nTip = wil.filter((k) => covBulan(k, akhir) >= 0.75 && covBulan(k, akhir) < 1).length
  // K3: harga jenis beras terpilih pada horizon terpilih.
  const popT = sum(wil, (k) => k.pop)
  const pAvg = sum(wil, (k) => hargaAt(k, hor, kom) * k.pop) / popT
  const nS = wil.filter((k) => statusHargaAt(k, hor, kom) === "siaga").length
  const nW = wil.filter((k) => statusHargaAt(k, hor, kom) === "waspada").length

  const kpi = [
    { to: "/produksi", k: "Produksi", v: nf(prodT, 0), u: "ton beras", d: `${nf(yoy * 100, 1)}% YoY`, neg: yoy < 0 },
    { to: "/stok", k: "Stok", v: nf(stT, 0), u: "ton beras", d: `${nDef} defisit, ${nTip} tipis`, neg: nDef > 0 },
    { to: "/harga", k: "Harga", v: rp(pAvg), u: `/kg ${kom}`, d: `${nS} Siaga, ${nW} Waspada`, neg: nS > 0 },
  ]

  return (
    <section className="mapview">
      <PetaInteraktif spec={spec} onPick={() => setDetail(true)} fokus={detail} />
      <div className="fl-top">
        {kpi.map((x) => (
          <Link key={x.k} to={x.to} className="fl-kpi">
            <span className="eyebrow">{x.k}</span>
            <b>
              {x.v} <small>{x.u}</small>
            </b>
            <span className={x.neg ? "delta-dn" : ""}>{x.d}</span>
          </Link>
        ))}
      </div>
      <div className="fl-right" ref={kananRef}>
        {detail ? (
          <KabCard onBack={() => setDetail(false)} />
        ) : (
          <DaftarPerhatian
            wil={wil}
            onPick={(n) => {
              select(n)
              setDetail(true)
              if (window.matchMedia?.("(max-width: 899px)").matches) requestAnimationFrame(() => kananRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }))
            }}
          />
        )}
      </div>
      <div className="fl-bottom">
        {spec.waktu === "horizon" && (
          <WeekSlider
            min={1}
            max={4}
            value={hor}
            onChange={onHor}
            counts={counts}
            countLabel={layer === "pAtasHet" ? "wilayah ≥ 50%" : "wilayah Siaga"}
            color="var(--crit)"
          />
        )}
        <Legenda spec={spec} />
        {arus !== "off" && (
          <div className="legend">
            <span className="ttl">{arus === "sphp" ? "Rekomendasi SPHP" : "Pola pasokan, 25 pasangan terbesar"}</span>
            <span>{dim === "3d" ? "Tebal garis = volume. Lingkaran = asal, panah = tujuan" : "Tebal garis = volume, bergerak dari asal ke tujuan"}</span>
            {arus === "sphp" && (
              <span>
                <span className="bulog-ik" style={{ display: "inline-flex", width: 18, height: 18, marginRight: 5, verticalAlign: -4, boxShadow: "none", borderWidth: 1.5 }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 8.35V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.35A2 2 0 0 1 3.26 6.5l8-3.2a2 2 0 0 1 1.48 0l8 3.2A2 2 0 0 1 22 8.35Z" />
                    <path d="M6 18h12" />
                    <path d="M6 14h12" />
                    <rect width="12" height="12" x="6" y="10" />
                  </svg>
                </span>
                cabang Bulog
              </span>
            )}
            {arus === "sphp" && (
              <span>
                <svg width="16" height="16" style={{ verticalAlign: -4, marginRight: 5 }}>
                  <circle cx="8" cy="8" r="6.5" fill="var(--accent)" fillOpacity="0.45" stroke="#fff" strokeWidth="2" />
                </svg>
                kiriman ke wilayah sendiri (cabang di wilayah itu), besar = volume
              </span>
            )}
            {arus === "dagang" &&
              REGIONS.map((r) => (
                <span key={r.key}>
                  <span className="sw" style={{ background: r.color }} />
                  {r.short}
                </span>
              ))}
          </div>
        )}
      </div>
    </section>
  )
}

/** Bulan berjalan dan dua bulan sesudahnya; produksi tiap bulan dari K1 (produksiBeras). */
const POLA_PANEN = [{ i: BULAN_KINI }, { i: BULAN_KINI + 1 }, { i: BULAN_KINI + 2 }]

const G_MAX = 4

/** Wilayah dengan risiko harga/stok tertinggi bulan ini, tampil sebelum ada wilayah yang dipilih. */
function DaftarPerhatian({ wil, onPick }: { wil: Wilayah[]; onPick: (n: string) => void }) {
  const daftar = wil
    .filter((k) => k.hs !== "aman" || k.ss === "defisit" || k.ss === "tipis")
    .sort((a, b) => risk(b) - risk(a))
    .slice(0, 10)
  return (
    <aside className="panel dp" aria-live="polite">
      <div className="kab-h">
        <div>
          <div className="eyebrow">Daftar perhatian</div>
          <h3>{bulanLabel(BULAN_KINI)}</h3>
        </div>
        <span className="pill-est">{daftar.length} wilayah</span>
      </div>
      {daftar.length === 0 ? (
        <p className="dp-note">Tidak ada wilayah yang perlu perhatian khusus.</p>
      ) : (
        <ol className="dp-list">
          {daftar.map((k, i) => (
            <li key={k.n}>
              <button type="button" onClick={() => onPick(k.n)}>
                <span className="dp-no">{i + 1}</span>
                <span className="dp-n">
                  <b>{k.n}</b>
                  <span className="dp-pills">
                    <HargaPill s={k.hs} pre="Harga" />
                    <StokPill s={k.ss} pre="Stok" />
                  </span>
                  <small className="dp-sub">
                    <span title="Harga medium kini → prakiraan 4 pekan">
                      {rp(k.pNow)} → {rp(k.p4)}
                    </span>
                    <span title="Cakupan stok: berapa bulan konsumsi wilayah ini bisa dipenuhi stok yang ada (defisit < 0,75, tipis < 1)">
                      stok {nf(k.cov, 2)} bln
                    </span>
                  </small>
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </aside>
  )
}

function KabCard({ onBack }: { onBack: () => void }) {
  const { sel } = useSelection()
  const { mulai, akhir } = useFilter()
  const { kom, setKom } = usePeta()
  const k = byName[sel]
  const het = kom === "medium" ? HET : HET_PREMIUM
  const periodeFlow = flowsBulan(mulai, akhir)
  const fl = periodeFlow.filter((f) => f.to === k)
  const out = periodeFlow.filter((f) => f.from === k && f.to !== k)
  const bulanFlow = [...new Set(fl.concat(out).map((f) => f.bulan))].sort((a, b) => a - b)
  const labelBulan = bulanFlow.length > 1 ? `${bulanLabel(bulanFlow[0])} sampai ${bulanLabel(bulanFlow[bulanFlow.length - 1])}` : bulanFlow.length ? bulanLabel(bulanFlow[0]) : ""
  const namaCabang = (f: { from: typeof k }) => (f.from === k ? "cabang di wilayah ini" : `cabang ${f.from.n}`)

  // Rekomendasi SPHP (K3b): penerima dari cabang Bulog, pemasok (cabang di wilayah ini kirim ke wilayah lain), atau pantau.
  const rute = fl.length ? fl : out
  // Wilayah rawan sendiri (harga Siaga atau stok tipis/defisit) yang justru jadi pemasok perlu ditinjau ulang.
  const rawan = k.hs === "siaga" || k.ss === "defisit" || k.ss === "tipis"
  const tinjau = !fl.length && out.length > 0 && rawan
  const peran = fl.length ? "Penerima" : tinjau ? "Tinjau" : out.length ? "Pemasok" : k.hs !== "aman" ? "Pantau" : "Terkendali"
  const kondisi: string[] = []
  if (k.hs !== "aman") kondisi.push(`harga medium diprakirakan ${rp(k.p4)}/kg pada +28 hari (HET ${rp(HET)})`)
  if (k.ss === "defisit" || k.ss === "tipis") kondisi.push(`cakupan stok ${nf(k.cov, 2)} bulan konsumsi akhir ${bulanLabel(BULAN_KINI)} (${k.ss})`)
  const totalTon = sum(rute, (f) => f.ton)
  const urut = rute.slice().sort((x, y) => y.ton - x.ton)

  return (
    <aside className="panel" aria-live="polite">
      <div className="kab-h">
        <div>
          <button type="button" className="dp-back" onClick={onBack}>
            ← Daftar perhatian
          </button>
          <div className="eyebrow">
            {k.isKota ? "Kota" : "Kabupaten"}
          </div>
          <h3>{k.n}</h3>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
          <HargaPill s={k.hs} />
          <StokPill s={k.ss} />
        </div>
      </div>
      <div className="facts">
        <div className="fact blk">
          <div className="blk-h">
            <span className="k">Produksi beras <small>ton</small></span>
            <span className="pill-est">Estimasi</span>
          </div>
          <div className="mrows">
            {POLA_PANEN.map((m) => {
              const ton = produksiBeras(k, m.i)
              const mx = Math.max(1, ...POLA_PANEN.map((q) => produksiBeras(k, q.i)))
              const on = m.i >= mulai && m.i <= akhir
              return (
                <div key={m.i} className={"mrow" + (on ? " on" : "")}>
                  <span>{bulanLabel(m.i)}</span>
                  <i style={{ width: `${(ton / mx) * 100}%` }} />
                  <b>{nf(ton, 0)}</b>
                </div>
              )
            })}
          </div>
          <div className="kv">
            <span>Total {bulanLabel(BULAN_KINI).split(" ")[0]}–{bulanLabel(BULAN_KINI + 2).split(" ")[0]}</span>
            <b>{nf(POLA_PANEN.reduce((a, m) => a + produksiBeras(k, m.i), 0), 0)} ton</b>
            <span>YoY</span>
            <b className={yoyRentang(k, BULAN_KINI, BULAN_KINI + 2) < 0 ? "delta-dn" : "delta-up"}>{nf(yoyRentang(k, BULAN_KINI, BULAN_KINI + 2) * 100, 1)}%</b>
          </div>
        </div>

        <div className="fact blk">
          <div className="blk-h">
            <span className="k">Cakupan stok <small>bulan konsumsi</small></span>
            <span className="pill-est">Estimasi</span>
          </div>
          <div className="gauge">
            {[
              { i: BULAN_KINI, v: k.cov },
              { i: BULAN_KINI + 1, v: k.covP[3] },
              { i: BULAN_KINI + 2, v: k.covP[7] },
            ].map((m) => {
              const st = m.v < 0.75 ? "defisit" : m.v < 1 ? "tipis" : m.v < 1.5 ? "cukup" : "surplus"
              return (
                <div key={m.i} className={"grow" + (m.i >= mulai && m.i <= akhir ? " on" : "")}>
                  <span>{bulanLabel(m.i)}</span>
                  <div className="gtrack">
                    <i style={{ left: 0, width: `${(0.75 / G_MAX) * 100}%`, background: "var(--crit)" }} />
                    <i style={{ left: `${(0.75 / G_MAX) * 100}%`, width: `${(0.25 / G_MAX) * 100}%`, background: "var(--warn)" }} />
                    <i style={{ left: `${(1 / G_MAX) * 100}%`, width: `${(0.5 / G_MAX) * 100}%`, background: "var(--ok)" }} />
                    <i style={{ left: `${(1.5 / G_MAX) * 100}%`, right: 0, background: "var(--d5)" }} />
                    <u style={{ left: `${(Math.min(Math.max(m.v, 0), G_MAX) / G_MAX) * 100}%` }} />
                  </div>
                  <b>
                    {nf(m.v, 2)} <small>{st}</small>
                  </b>
                </div>
              )
            })}
            <div className="gscale">
              <span style={{ left: `${(0.75 / G_MAX) * 100}%` }}>0,75</span>
              <span style={{ left: `${(1.5 / G_MAX) * 100}%` }}>1,5</span>
              <span style={{ left: "100%" }}>{G_MAX} bln</span>
            </div>
          </div>
          <div className="kv">
            <span>Konsumsi</span>
            <b>{nf(k.C * 1000)} ton/bln</b>
            <span>Stok kini</span>
            <b>{nf(k.cov * k.C * 1000)} ton</b>
          </div>
        </div>

        <div className="fact blk">
          <div className="blk-h">
            <span className="k">Harga beras <small>Rp/kg</small></span>
            <span className="pill-est">Estimasi</span>
          </div>
          <div className="seg seg-s" role="group" aria-label="Jenis beras">
            <button type="button" aria-pressed={kom === "medium"} onClick={() => setKom("medium")}>
              Medium
            </button>
            <button type="button" aria-pressed={kom === "premium"} onClick={() => setKom("premium")}>
              Premium
            </button>
          </div>
          <div className="prow head">
            <span>Kini, {dfmt(NOW)}</span>
            <b>{nf(pNowHarga(k, kom), 0)}</b>
            <em>HET {nf(het, 0)}</em>
          </div>
          <div className="prow cap">
            <span />
            <b>Median</b>
            <em>P10 – P90</em>
          </div>
          {fcHarga(k, kom).map((f, i) => (
            <div key={i} className={"prow" + (f.m > het ? " over" : "")}>
              <span>+{(i + 1) * 7} hari</span>
              <b>{nf(f.m, 0)}</b>
              <em>
                {nf(f.lo, 0)} – {nf(f.hi, 0)}
              </em>
            </div>
          ))}
        </div>
      </div>
      <Terkunci judul="Rekomendasi SPHP" ringkas>
      <div className={"rek " + peran.toLowerCase()}>
        <div className="rek-top">
          <span className="rek-t">Rekomendasi SPHP</span>
          <span className="rek-pill">{peran}</span>
        </div>
        {kondisi.length > 0 && (
          <p className="rek-p">
            <b>Kondisi wilayah:</b> {kondisi.join("; ")}.
          </p>
        )}
        <p className="rek-p">
          {fl.length > 0 ? (
            <>
              Salurkan beras SPHP <b className="hl">{nf(totalTon)} ton</b> dari{" "}
              {fl.length > 3 ? `${fl.length} cabang Bulog, terbesar ${urut.slice(0, 2).map((f) => f.from.n).join(" dan ")}` : urut.map((f) => namaCabang(f) + (urut.length === 1 && f.km ? ` (${nf(f.km)} km)` : "")).join(" dan ")}, pada{" "}
              <b className="hl">{labelBulan}</b>.
            </>
          ) : out.length > 0 ? (
            <>
              Cabang Bulog di wilayah ini menyalurkan <b className="hl">{nf(totalTon)} ton</b> SPHP ke {urut.map((f) => f.to.n + (urut.length === 1 ? ` (${nf(f.km)} km)` : "")).join(", ")}, pada{" "}
              <b className="hl">{labelBulan}</b>.
              {tinjau && " Wilayah ini sendiri rawan, jadi alokasi keluar perlu ditinjau ulang bersama Bulog."}
            </>
          ) : k.hs !== "aman" ? (
            <>Harga mendekati HET. Pantau pasar utama dan siapkan Gerakan Pangan Murah bila harga pekan depan naik lagi.</>
          ) : (
            <>Kondisi terkendali. Tidak ada intervensi yang disarankan pekan ini.</>
          )}
        </p>
        {rute.length > 0 && (
          <p className="rek-p rek-asumsi">
            Volume dari model K3b: stok non-Bulog (K2), peluang harga melewati HET, dan jarak jalan, dengan stok Bulog per cabang November 2026
            (angka pimpinan cabang di media untuk Madiun, Ponorogo, dan Malang; cabang lain ditaksir dari porsi pengadaan).
          </p>
        )}
        {rute.length > 1 && (
          <div className="rek-chips">
            {urut.slice(0, 4).map((f) => (
              <span key={f.from.n + f.to.n} className="rek-chip">
                {fl.length ? (f.from === k ? "Lokal" : f.from.n) : f.to.n}
                <em>
                  {nf(f.ton)} ton{f.km ? `, ${nf(f.km)} km` : ""}
                </em>
              </span>
            ))}
            {urut.length > 4 && <span className="rek-chip more">+{urut.length - 4}</span>}
          </div>
        )}
      </div>
      </Terkunci>
    </aside>
  )
}
