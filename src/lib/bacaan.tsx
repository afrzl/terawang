/* Teks "Bacaan" untuk tiap grafik: dihitung dari data yang sedang tampil, bukan cara membaca grafiknya. */
import type { ReactNode } from "react"
import { REGIONS, TRADE, TRADE_TOTAL, inflow, outflow, regionOf, regionStats } from "./arus"
import { FLOWS, HET, HIST, SIAGA, WILAYAH, byName, type LayerKey, type Wilayah } from "./data"
import { DAY, NOW, dfmt, hash, nf, rng, rp, short, sum } from "./format"
import { weekLabel } from "./weeks"

/** "A", "A dan B", "A, B, dan C". */
export function daftar(xs: string[]) {
  if (xs.length <= 1) return xs.join("")
  if (xs.length === 2) return `${xs[0]} dan ${xs[1]}`
  return `${xs.slice(0, -1).join(", ")}, dan ${xs[xs.length - 1]}`
}
const pct = (v: number, d = 0) => `${nf(v, d)}%`
const sign = (v: number, d = 1) => `${v >= 0 ? "+" : "−"}${nf(Math.abs(v), d)}`
const rasio = (a: number, b: number) => (a / b - 1) * 100

/* ---------------- Ringkasan: peta ---------------- */

export function bacaPeta(layer: LayerKey, w: number, valueAt: (l: LayerKey, k: Wilayah, w: number) => number): ReactNode {
  if (layer === "fase") {
    const ks = WILAYAH.filter((k) => k.ha >= 1500)
    const val = (k: Wilayah) => k.ph[2] + k.ph[3]
    const avg = sum(ks, (k) => k.ha * val(k)) / sum(ks, (k) => k.ha)
    const urut = ks.slice().sort((a, b) => val(b) - val(a))
    const atas = urut.slice(0, 3)
    const bawah = urut.slice(-3).reverse()
    return (
      <>
        Rata-rata <b>{pct(avg)}</b> sawah Jawa Timur sudah berisi tanaman (fase vegetatif atau generatif) pada citra 30 Okt. Paling maju{" "}
        {daftar(atas.map((k) => `${k.n} (${pct(val(k))})`))}. Paling tertinggal {daftar(bawah.map((k) => `${k.n} (${pct(val(k))})`))}: sebagian
        besar sawahnya masih bera atau baru diolah, jadi panen di sana datang paling akhir.
      </>
    )
  }
  if (layer === "produksi") {
    const tot = sum(WILAYAH, (k) => k.est)
    const top = WILAYAH.slice().sort((a, b) => b.est - a.est).slice(0, 5)
    const turun = WILAYAH.filter((k) => k.est < k.prev)
    const dalam = WILAYAH.filter((k) => k.prev > 5)
      .sort((a, b) => rasio(a.est, a.prev) - rasio(b.est, b.prev))
      .slice(0, 2)
    return (
      <>
        Lima wilayah ({daftar(top.map((k) => k.n))}) menyumbang <b>{pct((sum(top, (k) => k.est) / tot) * 100)}</b> proyeksi panen Nov–Jan.{" "}
        <b>{turun.length} dari 38</b> wilayah diproyeksikan panen lebih kecil dari periode sama 2025, dengan penurunan terdalam di{" "}
        {daftar(dalam.map((k) => `${k.n} (${sign(rasio(k.est, k.prev), 0)}%)`))}.
      </>
    )
  }
  if (layer === "stok") {
    const v = (k: Wilayah) => valueAt("stok", k, w)
    const def = WILAYAH.filter((k) => v(k) < 0.75)
    const tip = WILAYAH.filter((k) => v(k) >= 0.75 && v(k) < 1)
    const def0 = WILAYAH.filter((k) => valueAt("stok", k, 0) < 0.75).length
    const low = WILAYAH.slice().sort((a, b) => v(a) - v(b)).slice(0, 3)
    return (
      <>
        Pada {weekLabel(w)}, <b>{def.length} wilayah</b> berada di bawah 0,75 bulan konsumsi (defisit) dan {tip.length} lainnya tipis.
        {w !== 0 && (def0 ? <> Pekan ini baru {def0} wilayah yang defisit.</> : <> Pekan ini belum ada wilayah yang defisit.</>)} Paling rendah{" "}
        {daftar(low.map((k) => `${k.n} (${nf(v(k), 2)} bln)`))}
        {low.every((k) => k.isKota)
          ? ", ketiganya kota yang hidup dari pasokan kabupaten sekitar."
          : low.some((k) => k.isKota || regionOf[k.n]?.key === "madura")
            ? ", wilayah yang bergantung pada pasokan dari luar."
            : "."}
      </>
    )
  }
  const v = (k: Wilayah) => valueAt("harga", k, w)
  const popT = sum(WILAYAH, (k) => k.pop)
  const avg = sum(WILAYAH, (k) => v(k) * k.pop) / popT
  const avg0 = sum(WILAYAH, (k) => valueAt("harga", k, 0) * k.pop) / popT
  const siaga = WILAYAH.filter((k) => v(k) > SIAGA)
  const wasp = WILAYAH.filter((k) => v(k) > HET && v(k) <= SIAGA)
  const top = WILAYAH.slice().sort((a, b) => v(b) - v(a)).slice(0, 3)
  return (
    <>
      Pada {weekLabel(w)}, rata-rata harga medium Jatim <b>{rp(avg)}/kg</b>
      {w !== 0 && <> ({sign(rasio(avg, avg0))}% dari pekan ini)</>}. <b>{siaga.length} wilayah</b> di atas HET +5% ({rp(SIAGA)}) dan {wasp.length}{" "}
      di atas HET sampai HET +5%. Termahal {daftar(top.map((k) => `${k.n} (${rp(v(k))})`))}.
    </>
  )
}

/* ---------------- Produksi ---------------- */

export function bacaCitra(k: Wilayah, s: { before: number; after: number; lag: number; petak?: number; asli: boolean }): ReactNode {
  const awal = s.asli ? "Di hamparan contoh" : "Pada ilustrasi"
  const petak = s.petak ? ` (${nf(s.petak)} petak)` : ""
  const tahap =
    s.after < 25
      ? "Sebagian besar petak belum ditanami sampai akhir Oktober, jadi tanam MT I di sini baru dimulai dan panennya kemungkinan bergeser ke Februari–Maret."
      : s.after < 60
        ? "Tanam sedang berjalan, tetapi belum merata."
        : "Sebagian besar petak sudah ditanami, tanam berjalan sesuai musim."
  const nol = s.asli && s.before === 0 && s.after < 1
  const lag = s.lag > 5 ? ` ${pct(s.lag)} petak tertinggal perlu dicek lapangan (hama, kekeringan, atau air irigasi belum sampai).` : s.lag > 0 ? ` Petak tertinggal sedikit (${pct(s.lag)}).` : " Tidak ada petak yang tertinggal."
  return (
    <>
      {awal} {k.n}
      {petak}, <b>{pct(s.after)}</b> petak sudah tertanam sebulan setelah citra pertama, sementara saat itu {pct(s.before)} petak tergenang siap
      tanam. {tahap}
      {lag}
      {nol && " Angka nol di kotak ini bisa juga berarti klasifikasi otomatis belum menangkap genangan, jadi perlu dicek lapangan sebelum dipakai."}
    </>
  )
}

export function bacaTreemap(periode = "Nov–Jan"): ReactNode {
  const tot = sum(WILAYAH, (k) => k.est)
  const grp = REGIONS.map((r) => ({ r, v: sum(r.members, (m) => byName[m].est), p: sum(r.members, (m) => byName[m].prev) })).sort((a, b) => b.v - a.v)
  const big = WILAYAH.filter((k) => k.est > 60).sort((a, b) => rasio(a.est, a.prev) - rasio(b.est, b.prev))[0]
  return (
    <>
      {grp[0].r.short} menyumbang <b>{pct((grp[0].v / tot) * 100)}</b> produksi {periode}, disusul {grp[1].r.short} ({pct((grp[1].v / tot) * 100)})
      dan {grp[2].r.short} ({pct((grp[2].v / tot) * 100)}). Madura hanya {pct((grp.find((g) => g.r.key === "madura")!.v / tot) * 100)}.
      {big && (
        <>
          {" "}
          Di antara lumbung besar, {big.n} turun paling dalam ({sign(rasio(big.est, big.prev), 0)}% dari 2025), jadi kekurangan pasokan paling terasa
          bila panen di sana mundur.
        </>
      )}
    </>
  )
}

/** Perkiraan luas panen 12 pekan ke depan untuk 14 kabupaten penghasil terbesar (ribu ha). */
export function kalenderPanen() {
  const top = WILAYAH.filter((k) => !k.isKota)
    .sort((a, b) => b.est - a.est)
    .slice(0, 14)
  const weeks = [...Array(12)].map((_, i) => new Date(+NOW + (i + 1) * 7 * DAY))
  const cal = top.map((k) => {
    const R = rng(hash(k.n + "cal"))
    const peak = 5 + k.shift + R() * 3
    const tot = (k.ha * 0.17 * (1 + k.yoy * 0.2)) / 1000
    const w = weeks.map((_, i) => Math.exp(-Math.pow((i - peak) / 2.4, 2)) + 0.15 * Math.exp(-Math.pow((i - 1) / 1.5, 2)))
    const sw = w.reduce((a, b) => a + b)
    return w.map((v) => (v / sw) * tot)
  })
  return { top, weeks, cal }
}

export function bacaKalender(): ReactNode {
  const { top, weeks, cal } = kalenderPanen()
  const per = weeks.map((_, i) => sum(cal, (r) => r[i]))
  const tot = sum(per, (v) => v)
  const iPeak = per.indexOf(Math.max(...per))
  const awal = sum(per.slice(0, 6), (v) => v) / tot
  const puncak = top.map((k, r) => ({ k, i: cal[r].indexOf(Math.max(...cal[r])) }))
  const telat = puncak.filter((p) => p.i >= 10).map((p) => p.k.n)
  const dini = puncak.slice().sort((a, b) => a.i - b.i).slice(0, 2)
  return (
    <>
      Panen 14 kabupaten terbesar memuncak pada pekan <b>{dfmt(weeks[iPeak])}</b> (sekitar {nf(per[iPeak], 1)} ribu ha). Hanya{" "}
      <b>{pct(awal * 100)}</b> luas panen jatuh sebelum {dfmt(weeks[6])}, jadi November–Desember adalah masa paceklik dan pasokan baru menguat
      setelah tahun baru. Paling awal {daftar(dini.map((p) => p.k.n))}
      {telat.length ? <>; paling akhir {daftar(telat.slice(0, 3))}, yang puncaknya baru tiba di akhir Januari.</> : "."}
    </>
  )
}

export function bacaRadar(k: Wilayah): ReactNode {
  const N = 15
  const tgl = (i: number) => dfmt(new Date(2026, 5, 1 + i * 12))
  const idx = (xs: (number | null)[]) => xs.slice(0, N).map((v, i) => [v, i] as const).filter((p): p is readonly [number, number] => p[0] != null)
  const cur = idx(k.vh)
  const avg = idx(k.vhAvg)
  if (!cur.length || !avg.length) return null
  const minOf = (ps: (readonly [number, number])[]) => ps.reduce((m, p) => (p[0] < m[0] ? p : m))
  const [cMin, ci] = minOf(cur)
  const [, ai] = minOf(avg)
  const geser = (ci - ai) * 12
  const [cLast, li] = cur[cur.length - 1]
  const aLast = k.vhAvg[li]
  const d = aLast == null ? null : cLast - aLast
  const masihTurun = ci === li
  return (
    <>
      Titik terendah musim ini (tanda sawah digenangi untuk tanam) jatuh pada <b>{tgl(ci)}</b> ({nf(cMin, 1)} dB),{" "}
      {geser > 0 ? (
        <b>{geser} hari lebih lambat</b>
      ) : geser < 0 ? (
        <>{-geser} hari lebih awal</>
      ) : (
        "bersamaan"
      )}{" "}
      dibanding rata-rata 2023–25 ({tgl(ai)}).{" "}
      {masihTurun
        ? "Pantulan masih turun, jadi tanam belum selesai."
        : geser >= 24
          ? `Tanam di ${k.n} mundur, sehingga puncak panen ikut bergeser sekitar ${Math.round(geser / 7)} pekan.`
          : geser > 0
            ? "Tanam sedikit terlambat."
            : "Jadwal tanam normal."}{" "}
      {d != null &&
        (d < -0.5
          ? `Pada akuisisi terakhir (${tgl(li)}) pantulan masih ${nf(-d, 1)} dB di bawah rata-rata: tanaman belum serapat biasanya.`
          : d > 0.5
            ? `Pada akuisisi terakhir (${tgl(li)}) pantulan ${nf(d, 1)} dB di atas rata-rata: tanaman sudah lebih rapat dari biasanya.`
            : `Pada akuisisi terakhir (${tgl(li)}) pantulan sudah setara rata-rata.`)}
    </>
  )
}

export function bacaProyeksi(): ReactNode {
  const ks = WILAYAH.filter((k) => !k.isKota)
    .sort((a, b) => b.est - a.est)
    .slice(0, 16)
  const turun = ks.filter((k) => k.est < k.prev)
  const pasti = ks.filter((k) => k.prev > k.est + k.ci)
  const lebar = ks.slice().sort((a, b) => b.ci / b.est - a.ci / a.est)[0]
  return (
    <>
      <b>{turun.length} dari 16</b> kabupaten penghasil terbesar diproyeksikan panen lebih kecil dari periode yang sama pada 2025.{" "}
      {pasti.length === ks.length ? (
        "Di semua wilayah itu titik 2025 berada di luar selang 90%, jadi penurunannya hampir pasti, bukan sekadar ketidakpastian model."
      ) : pasti.length ? (
        <>
          Di {pasti.length} wilayah ({pasti.length > 4 ? `${pasti.slice(0, 3).map((k) => k.n).join(", ")}, dan ${pasti.length - 3} lainnya` : daftar(pasti.map((k) => k.n))}) titik
          2025 berada di luar selang 90%, jadi penurunannya hampir pasti, bukan sekadar ketidakpastian model.
        </>
      ) : (
        "Semua titik 2025 masih di dalam selang 90%, jadi penurunannya belum pasti."
      )}{" "}
      Selang paling lebar di {lebar.n} (±{pct((lebar.ci / lebar.est) * 100)}), tempat citra masih sering tertutup awan.
    </>
  )
}

export function bacaFase(): ReactNode {
  const ks = WILAYAH.filter((k) => !k.isKota)
  const tot = sum(ks, (k) => k.ha)
  const rata = (j: number) => sum(ks, (k) => k.ha * k.ph[j]) / tot
  const bera = ks.slice().sort((a, b) => b.ph[0] - a.ph[0]).slice(0, 2)
  const siap = ks.slice().sort((a, b) => b.ph[4] - a.ph[4])[0]
  return (
    <>
      Secara rata-rata <b>{pct(rata(0) + rata(1))}</b> sawah masih bera atau baru diolah, {pct(rata(2))} vegetatif, {pct(rata(3))} generatif, dan
      hanya {pct(rata(4))} siap panen. Bera terluas di {daftar(bera.map((k) => `${k.n} (${pct(k.ph[0])})`))}. Porsi siap panen terbesar di {siap.n} (
      {pct(siap.ph[4])}), wilayah yang paling dulu memasok gabah baru.
    </>
  )
}

/* ---------------- Stok ---------------- */

export function hariKeDefisit(k: Wilayah): number | null {
  const s = [k.cov].concat(k.covP)
  if (s[0] < 0.75) return 0
  for (let i = 1; i < s.length; i++) {
    if (s[i] < 0.75) return Math.round((i - 1 + (s[i - 1] - 0.75) / (s[i - 1] - s[i])) * 7)
  }
  return null
}

export function bacaHitungMundur(sel: string): ReactNode {
  const ls = WILAYAH.map((k) => ({ k, d: hariKeDefisit(k) }))
    .filter((x): x is { k: Wilayah; d: number } => x.d != null)
    .sort((a, b) => a.d - b.d)
  const sudah = ls.filter((x) => x.d === 0)
  const cepat = ls.filter((x) => x.d > 0).slice(0, 3)
  const ton = sum(ls.slice(0, 8), (x) => Math.max(0, 1 - x.k.covP[3]) * x.k.C * 1000)
  const sd = hariKeDefisit(byName[sel])
  return (
    <>
      <b>{ls.length} wilayah</b> diperkirakan jatuh di bawah 0,75 bulan konsumsi dalam 8 pekan.{" "}
      {sudah.length > 0 && <>{daftar(sudah.map((x) => x.k.n))} sudah di bawah ambang sekarang. </>}
      {cepat.length > 0 && <>Paling cepat {daftar(cepat.map((x) => `${x.k.n} (${x.d} hari lagi)`))}. </>}
      Untuk mengembalikan delapan wilayah tercepat ini ke batas aman 1 bulan dibutuhkan sekitar <b>{nf(ton)} ton</b> beras.{" "}
      {sel}{" "}
      {sd == null ? "tidak diperkirakan defisit dalam 8 pekan." : sd === 0 ? "sudah di bawah ambang defisit." : `diperkirakan defisit sekitar ${sd} hari lagi.`}
    </>
  )
}

export function bacaKalman(k: Wilayah, w95: number): ReactNode {
  const lalu = k.covH[HIST - 5]
  const akhir = k.covP[7]
  const iAman = [k.cov].concat(k.covP).findIndex((v) => v < 1)
  const iDef = [k.cov].concat(k.covP).findIndex((v) => v < 0.75)
  const nObs = k.obs.filter((v) => v != null).length
  return (
    <>
      Stok {k.n} kini setara <b>{nf(k.cov, 2)} bulan</b> konsumsi ({sign(rasio(k.cov, lalu), 0)}% dari 4 pekan lalu) dan diproyeksikan{" "}
      {akhir < k.cov ? "turun" : "naik"} ke {nf(akhir, 2)} bulan dalam 8 pekan.{" "}
      {iDef === 0
        ? "Stok sudah di bawah ambang defisit."
        : iDef > 0
          ? `Garis proyeksi memotong ambang defisit sekitar ${iDef} pekan lagi.`
          : iAman === 0
            ? "Stok sudah di bawah batas aman 1 bulan, tetapi belum defisit."
            : iAman > 0
              ? `Stok turun di bawah batas aman 1 bulan sekitar ${iAman} pekan lagi.`
              : "Stok tetap di atas batas aman sepanjang proyeksi."}{" "}
      Taksiran dikoreksi oleh {nObs} pengamatan stok dalam 26 pekan; di ujung proyeksi selang 95% selebar ±{nf(w95, 2)} bulan, jadi angka 8 pekan
      ke depan perlu dibaca sebagai kisaran.
    </>
  )
}

export function bacaNeraca(k: Wilayah, s0: number, p: number, kn: number, a: number, s1: number): ReactNode {
  return (
    <>
      Sepanjang Oktober {k.n} memanen setara {nf(p)} ton beras dan mengonsumsi {nf(kn)} ton.{" "}
      {a < 0 ? (
        <>
          Selisih sekitar <b>{nf(-a)} ton</b> keluar dari neraca wilayah ini (dijual ke luar, disimpan sebagai gabah, atau masuk gudang Bulog), sehingga
          stok beredar {s1 < s0 ? "turun" : "naik"} {nf(Math.abs(s1 - s0))} ton.
        </>
      ) : (
        <>
          Kekurangannya ditutup arus masuk sekitar <b>{nf(a)} ton</b> dari wilayah lain; tanpa arus itu stok akan habis{" "}
          {s0 + p - kn < 0 ? "sebelum akhir bulan" : `${nf(((s0 + p - kn) / kn) * 30)} hari lebih cepat`}.
        </>
      )}
    </>
  )
}

/* ---------------- Arus beras ---------------- */

export function bacaSankey(): ReactNode {
  const asal = WILAYAH.map((k) => ({ k, v: outflow(k.n) }))
    .filter((x) => x.v > 0)
    .sort((a, b) => b.v - a.v)
  const tuju = WILAYAH.map((k) => ({ k, v: inflow(k.n) }))
    .filter((x) => x.v > 0)
    .sort((a, b) => b.v - a.v)
  const top3 = asal.slice(0, 3)
  return (
    <>
      Tiga lumbung ({daftar(top3.map((x) => x.k.n))}) memasok <b>{pct((sum(top3, (x) => x.v) / TRADE_TOTAL) * 100)}</b> seluruh arus antarwilayah.
      Penerima terbesar {tuju[0].k.n} ({nf(tuju[0].v)} ton/bulan), disusul {daftar(tuju.slice(1, 3).map((x) => x.k.n))}. Bila panen di tiga lumbung
      itu mundur, wilayah penerima inilah yang pertama kekurangan.
    </>
  )
}

export function bacaChord(): ReactNode {
  const st = regionStats()
  const antar = sum(st, (s) => s.keluar)
  const pairs = REGIONS.flatMap((a) =>
    REGIONS.filter((b) => b !== a).map((b) => ({ a, b, v: TRADE.filter((t) => regionOf[t.from.n] === a && regionOf[t.to.n] === b).reduce((s, t) => s + t.ton, 0) })),
  ).sort((x, y) => y.v - x.v)
  const mandiri = st.slice().sort((x, y) => y.internal / (y.internal + y.masuk || 1) - x.internal / (x.internal + x.masuk || 1))[0]
  return (
    <>
      <b>{pct((antar / TRADE_TOTAL) * 100)}</b> arus beras melintasi batas kawasan. Pita terbesar {pairs[0].a.short} → {pairs[0].b.short} (
      {nf(pairs[0].v)} ton/bulan), lalu {pairs[1].a.short} → {pairs[1].b.short}. {mandiri.r.short} paling mandiri: kebutuhannya sebagian besar
      dipenuhi dari dalam kawasan sendiri.
    </>
  )
}

export function bacaNeracaKawasan(): ReactNode {
  const st = regionStats().map((s) => ({ ...s, net: s.prod - s.kons }))
  const sur = st.filter((s) => s.net > 0).sort((a, b) => b.net - a.net)
  const def = st.filter((s) => s.net < 0).sort((a, b) => a.net - b.net)
  return (
    <>
      Surplus Oktober terbesar di {daftar(sur.slice(0, 3).map((s) => `${s.r.short} (+${nf(s.net / 1000, 1)} rb ton)`))}.{" "}
      {def.length ? (
        <>
          Defisit di {daftar(def.map((s) => `${s.r.short} (−${nf(-s.net / 1000, 1)} rb ton)`))}; {def[0].r.short} paling bergantung pada beras dari luar
          kawasan.
        </>
      ) : (
        <>
          Tidak ada kawasan yang defisit di Oktober; surplus terkecil di <b>{sur[sur.length - 1].r.short}</b> (+{nf(sur[sur.length - 1].net / 1000, 1)} rb
          ton), dan di dalamnya kota-kota tetap bergantung pada pasokan dari kabupaten sekitar.
        </>
      )}{" "}
      Begitu panen Oktober habis dan panen MT I mundur, kawasan dengan surplus tipis paling cepat berbalik defisit.
    </>
  )
}

export function bacaPetaArus(): ReactNode {
  const top = TRADE.slice(0, 25)
  const v = sum(top, (t) => t.ton)
  const jauh = top.slice().sort((a, b) => b.km - a.km)[0]
  return (
    <>
      Dua puluh lima jalur ini membawa <b>{pct((v / TRADE_TOTAL) * 100)}</b> arus antarwilayah. Jalur terbesar {short(top[0].from.n)} →{" "}
      {short(top[0].to.n)} ({nf(top[0].ton)} ton/bulan); terpanjang {short(jauh.from.n)} → {short(jauh.to.n)} ({nf(jauh.km)} km), yang ongkos angkutnya
      ikut menaikkan harga di tujuan.
    </>
  )
}

/* ---------------- Harga ---------------- */

export function bacaHarga(k: Wilayah, pAboveHet: number, prov: number): ReactNode {
  const lalu = k.price[HIST - 5]
  const naik = k.pNow - lalu
  return (
    <>
      Harga medium {k.n} kini <b>{rp(k.pNow)}/kg</b>, {naik >= 0 ? "naik" : "turun"} {rp(Math.abs(naik))} dalam 4 pekan, dan{" "}
      {k.pNow > prov ? `${rp(k.pNow - prov)} di atas` : `${rp(prov - k.pNow)} di bawah`} rata-rata Jatim. Prakiraan 4 pekan ke depan{" "}
      <b>{rp(k.p4)}</b>, dengan peluang melewati HET {pAboveHet < 0.01 ? "hampir nol" : <>sekitar <b>{pct(pAboveHet * 100)}</b></>}.{" "}
      {k.hs === "siaga"
        ? "Wilayah ini masuk daftar prioritas penyaluran SPHP."
        : k.hs === "waspada"
          ? "Perlu dipantau; SPHP disiapkan bila tren berlanjut."
          : "Belum perlu intervensi."}
    </>
  )
}

export function bacaSphp(): ReactNode {
  const ton = sum(FLOWS, (f) => f.ton)
  const asal = Object.entries(
    FLOWS.reduce<Record<string, number>>((m, f) => ((m[f.from.n] = (m[f.from.n] ?? 0) + f.ton), m), {}),
  ).sort((a, b) => b[1] - a[1])
  const tujuan = new Set(FLOWS.map((f) => f.to.n)).size
  return (
    <>
      Rencana penyaluran Nov–Jan <b>{nf(ton)} ton</b> beras SPHP lewat {FLOWS.length} rute ke {tujuan} wilayah. Cabang Bulog {daftar(asal.slice(0, 2).map(([n]) => n))}{" "}
      menanggung {pct((sum(asal.slice(0, 2), ([, v]) => v) / ton) * 100)} volume.
    </>
  )
}

export function bacaRidgeline(): ReactNode {
  const med = (xs: number[]) => {
    const s = xs.slice().sort((a, b) => a - b)
    return s[Math.floor(s.length / 2)]
  }
  const iqr = (xs: number[]) => {
    const s = xs.slice().sort((a, b) => a - b)
    return s[Math.floor(s.length * 0.75)] - s[Math.floor(s.length * 0.25)]
  }
  const awal = WILAYAH.map((k) => k.price[HIST - 12])
  const kini = WILAYAH.map((k) => k.pNow)
  const depan = WILAYAH.map((k) => k.p4)
  return (
    <>
      Median harga 38 wilayah naik dari {rp(med(awal))} (12 pekan lalu) ke <b>{rp(med(kini))}</b> sekarang dan diprakirakan {rp(med(depan))} dalam 4
      pekan. Sebarannya juga melebar (selisih kuartil {rp(iqr(awal))} menjadi {rp(iqr(depan))}): wilayah di atas HET bertambah dari{" "}
      {awal.filter((v) => v > HET).length} menjadi <b>{depan.filter((v) => v > HET).length}</b>, terutama kota dan Madura yang bergantung pada
      pasokan luar.
    </>
  )
}

export function bacaHeatmap(): ReactNode {
  const naik = WILAYAH.map((k) => ({ k, d: k.p4 - k.price[HIST - 5] })).sort((a, b) => b.d - a.d)
  const top = WILAYAH.slice().sort((a, b) => b.p4 - a.p4).slice(0, 3)
  const turun = naik.filter((x) => x.d < 0)
  return (
    <>
      Baris teratas ({daftar(top.map((k) => k.n))}) diprakirakan paling mahal, di atas {rp(top[2].p4)}. Kenaikan tercepat dalam 8 pekan (4 lalu
      sampai 4 ke depan) di {daftar(naik.slice(0, 3).map((x) => `${x.k.n} (+${rp(x.d)})`))}.{" "}
      {turun.length ? `Hanya ${turun.length} wilayah yang harganya diprakirakan turun.` : "Tidak ada wilayah yang harganya diprakirakan turun."}
    </>
  )
}
