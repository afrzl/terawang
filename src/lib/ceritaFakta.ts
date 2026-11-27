/**
 * Fakta "Laporan pekan" (halaman Cerita): angka, daftar wilayah, dan isi peta tiap langkah, dihitung dari data model yang sama dengan dasbor.
 * Modul ini murni (tanpa React/DOM) supaya bisa dijalankan dua tempat:
 *   - browser: cadangan bila belum ada edisi pekanan di server,
 *   - server (api/src/cerita-fakta.ts): penyusun edisi pekanan, yang lalu meminta OpenAI menulis narasinya dari fakta ini.
 * Teks templat di sini dipakai bila edisi belum ada atau kalimat dari model tidak lolos pemeriksaan angka.
 */
import { BULAN_KINI, K1, K2, K3A, K3B, API_AKTIF } from "./api"
import { FLOWS, HET, HET_PREMIUM, WILAYAH, seriHarga, type LayerKey, type Wilayah } from "./data"
import { NOW, nf, short, sum } from "./format"
import { covBulan, hargaAt, luasPanen, produksiPrevRentang, produksiRentang, statusHargaAt, yoyRentang } from "./petaLayers"
import { tradeFor } from "./arus"

const BLN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"]
const BLN_PANJANG = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"]
export const labelBulan = (i: number) => `${BLN[i % 12]} ${2026 + Math.floor(i / 12)}`
const namaBulan = (i: number) => BLN_PANJANG[i % 12]

export type KunciLangkah = "sawah" | "panen" | "stok" | "arus" | "harga" | "aksi"

/** Isi peta satu langkah: nilai per wilayah dibekukan saat edisi disusun, supaya arsip pekan lama tetap menampilkan peta pekan itu. */
export interface PetaLangkah {
  layer: LayerKey
  nilai?: Record<string, number>
  valueLabel?: string
  legend?: string
  muted?: boolean
  arcs?: { from: string; to: string; ton: number }[]
  flows?: { dari: string; ke: string; ton: number; km: number; bulan: number }[]
}

export interface LangkahFakta {
  key: KunciLangkah
  k: string
  judul: string
  teks: string
  stat: { v: number; teks: string; unit: string }
  peta: PetaLangkah
  /** Bahan untuk penulis narasi; setiap angka di narasi harus berasal dari sini. */
  fakta: Record<string, unknown>
}

export interface FaktaPekan {
  /** Tanggal data harga terakhir (YYYY-MM-DD). */
  data_per: string
  data_per_label: string
  api_aktif: boolean
  periode: { awal: string; akhir: string; label: string }
  run: { k1: number | null; k2: number | null; k3a: number | null; k3b: number | null }
  judul: string
  dek: string
  tigaAngka: { teks: string; label: string; href: string }[]
  langkah: LangkahFakta[]
  /** Langkah "Tindakan" versi publik (tanpa angka dan rute SPHP). */
  aksiUmum: LangkahFakta
}

const tanda = (v: number) => (v < 0 ? "−" : "+")
const gabung = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")}, dan ${xs[xs.length - 1]}` : (xs[0] ?? ""))
const r = (v: number, d = 0) => Math.round(v * 10 ** d) / 10 ** d
const petakan = (f: (k: Wilayah) => number, d = 3) => Object.fromEntries(WILAYAH.map((k) => [k.n, r(f(k), d)]))
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`

/** Rata-rata harga medium provinsi `mundur` pekan sebelum titik terakhir (Rp/kg). */
function rataHarga(mundur: number) {
  const xs = WILAYAH.map((k) => {
    const s = seriHarga(k, "medium")
    return s[s.length - 1 - mundur]
  }).filter((x): x is number => typeof x === "number" && Number.isFinite(x))
  return xs.length ? sum(xs, (x) => x) / xs.length : 0
}

export function susunFakta(): FaktaPekan {
  const AWAL = BULAN_KINI
  const AKHIR = BULAN_KINI + 2
  const TENGAH = BULAN_KINI + 1
  const periode = `${BLN[AWAL % 12]}–${BLN[AKHIR % 12]}`
  const periodePanjang = `${namaBulan(AWAL)} sampai ${namaBulan(AKHIR)}`

  // ---- produksi (K1)
  const estT = sum(WILAYAH, (k) => produksiRentang(k, AWAL, AKHIR)) / 1000 // ribu ton beras
  const prevT = sum(WILAYAH, (k) => produksiPrevRentang(k, AWAL, AKHIR)) / 1000
  const yoy = prevT > 0 ? (estT / prevT - 1) * 100 : 0
  const luasRb = sum(WILAYAH, (k) => luasPanen(k, AWAL) + luasPanen(k, TENGAH) + luasPanen(k, AKHIR)) / 1000
  const urutProd = WILAYAH.slice().sort((a, b) => produksiRentang(b, AWAL, AKHIR) - produksiRentang(a, AWAL, AKHIR))
  const lumbung = urutProd.slice(0, 3)
  const turun = WILAYAH.filter((k) => produksiPrevRentang(k, AWAL, AKHIR) > 5000)
    .sort((a, b) => yoyRentang(a, AWAL, AKHIR) - yoyRentang(b, AWAL, AKHIR))
    .slice(0, 3)
  const nilaiProduksi = petakan((k) => produksiRentang(k, AWAL, AKHIR) / 1000, 2)

  // ---- stok (K2)
  const nDef = WILAYAH.filter((k) => covBulan(k, TENGAH) < 0.75)
  const nTip = WILAYAH.filter((k) => covBulan(k, TENGAH) >= 0.75 && covBulan(k, TENGAH) < 1)
  const urutCov = WILAYAH.slice().sort((a, b) => covBulan(a, TENGAH) - covBulan(b, TENGAH))
  const terendah = urutCov[0]
  const nDefKini = WILAYAH.filter((k) => covBulan(k, AWAL) < 0.75).length

  // ---- arus
  const arusBulan = tradeFor(AWAL)
  const arusTotal = arusBulan.reduce((a, t) => a + t.ton, 0)
  const arusAtas = arusBulan.slice(0, 3)

  // ---- harga (K3a)
  const hitung = (kom: "medium" | "premium", st: "waspada" | "siaga") => WILAYAH.filter((k) => statusHargaAt(k, 4, kom) === st)
  const wm = hitung("medium", "waspada")
  const sm = hitung("medium", "siaga")
  const wp = hitung("premium", "waspada")
  const sp = hitung("premium", "siaga")
  const nPerhatianM = wm.length + sm.length
  const nPerhatianP = wp.length + sp.length
  const hKini = rataHarga(0)
  const hLalu = rataHarga(1)
  const h4 = rataHarga(4)
  const hPrak = sum(WILAYAH, (k) => hargaAt(k, 4, "medium")) / WILAYAH.length
  const termahal = WILAYAH.slice().sort((a, b) => hargaAt(b, 4, "medium") - hargaAt(a, 4, "medium"))[0]

  // ---- SPHP (K3b)
  const tonS = sum(FLOWS, (f) => f.ton)
  const penerima = new Map<string, number>()
  for (const f of FLOWS) if (f.from !== f.to) penerima.set(f.to.n, (penerima.get(f.to.n) ?? 0) + f.ton)
  const penerimaAtas = [...penerima.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)

  const petaProduksi: PetaLangkah = {
    layer: "produksi",
    nilai: nilaiProduksi,
    valueLabel: `Produksi beras ${periode}`,
    legend: `Produksi beras ${labelBulan(AWAL)} sampai ${labelBulan(AKHIR)}, ribu ton`,
  }

  const langkah: LangkahFakta[] = [
    {
      key: "sawah",
      k: "01 Sawah",
      judul: "Awal tanam dibaca dari satelit",
      teks:
        "Sentinel-2 membaca kehijauan dan kandungan air sawah tiap 12 hari. Sawah yang tergenang tapi belum hijau dianggap baru ditanami, dan panennya dihitung " +
        "sekitar 96 hari kemudian. Kalau awan menutup, radar Sentinel-1 dipakai untuk mengisi celahnya.",
      stat: { v: luasRb, teks: nf(luasRb, 0), unit: `ribu ha luas panen ${periode}` },
      peta: petaProduksi,
      fakta: {
        periode: periodePanjang,
        luas_panen_ribu_ha: r(luasRb, 0),
        wilayah_luas_panen_terbesar: lumbung.map((k) => ({ wilayah: k.n, ribu_ha: r((luasPanen(k, AWAL) + luasPanen(k, TENGAH) + luasPanen(k, AKHIR)) / 1000, 1) })),
        metode: "Sentinel-2 tiap 12 hari (EVI, LSWI), panen sekitar 96 hari sesudah tanam, Sentinel-1 radar untuk celah awan",
      },
    },
    {
      key: "panen",
      k: "02 Panen",
      judul: yoy < 0 ? `Panen ${periode} lebih kecil dari tahun lalu` : `Panen ${periode} lebih besar dari tahun lalu`,
      teks:
        `Dari luas panen itu, model memperkirakan ${nf(estT / 1000, 2)} juta ton beras untuk ${periodePanjang}, ${yoy < 0 ? "turun" : "naik"} ${nf(Math.abs(yoy), 1)}% dari ` +
        `periode yang sama tahun lalu menurut BPS. Penyumbang terbesarnya ${gabung(lumbung.map((k) => short(k.n)))}. Pada uji Jan–Sep 2026, estimasinya berselisih 9,3% dari angka BPS (WAPE).`,
      stat: { v: Math.abs(yoy), teks: tanda(yoy) + nf(Math.abs(yoy), 1) + "%", unit: "proyeksi panen dibanding setahun lalu" },
      peta: petaProduksi,
      fakta: {
        periode: periodePanjang,
        produksi_beras_juta_ton: r(estT / 1000, 2),
        produksi_tahun_lalu_juta_ton: r(prevT / 1000, 2),
        perubahan_persen: r(yoy, 1),
        wilayah_produksi_terbesar: lumbung.map((k) => ({ wilayah: k.n, ribu_ton: r(produksiRentang(k, AWAL, AKHIR) / 1000, 1) })),
        wilayah_penurunan_terdalam: turun.map((k) => ({ wilayah: k.n, perubahan_persen: r(yoyRentang(k, AWAL, AKHIR) * 100, 1) })),
        selisih_uji_jan_sep_2026_wape_persen: 9.3,
      },
    },
    {
      key: "stok",
      k: "03 Stok",
      judul: nDef.length > 0 ? "Stok di beberapa wilayah mulai tipis" : "Stok di semua wilayah masih di atas batas defisit",
      teks:
        `Stok beras di luar gudang Bulog dihitung dari selisih produksi dan konsumsi tiap bulan. Pada akhir ${namaBulan(TENGAH)}, ${nDef.length} wilayah diperkirakan di bawah 0,75 bulan ` +
        `konsumsi (defisit) dan ${nTip.length} lainnya di bawah satu bulan (tipis). Yang paling rendah ${terendah?.n ?? "-"}.`,
      stat: { v: nDef.length, teks: nf(nDef.length), unit: `wilayah defisit akhir ${namaBulan(TENGAH)}` },
      peta: {
        layer: "stokK2",
        nilai: petakan((k) => covBulan(k, TENGAH), 3),
        valueLabel: `Cakupan stok akhir ${BLN[TENGAH % 12]}`,
        legend: `Cakupan stok non-Bulog, akhir ${labelBulan(TENGAH)}`,
      },
      fakta: {
        bulan: labelBulan(TENGAH),
        ambang: "defisit di bawah 0,75 bulan konsumsi, tipis 0,75 sampai 1 bulan",
        jumlah_wilayah_defisit: nDef.length,
        jumlah_wilayah_tipis: nTip.length,
        jumlah_wilayah_defisit_bulan_ini: nDefKini,
        wilayah_defisit: nDef.map((k) => k.n).slice(0, 8),
        cakupan_terendah: urutCov.slice(0, 3).map((k) => ({ wilayah: k.n, bulan_konsumsi: r(covBulan(k, TENGAH), 2) })),
      },
    },
    {
      key: "arus",
      k: "04 Arus",
      judul: "Beras bergerak ke wilayah yang kurang",
      teks:
        `Wilayah yang produksinya melebihi konsumsi mengirim ke yang kekurangan. Perkiraannya sekitar ${nf(arusTotal / 1000, 1)} ribu ton per bulan berpindah antarkabupaten, ` +
        `terbesar dari ${arusAtas[0] ? `${short(arusAtas[0].from.n)} ke ${short(arusAtas[0].to.n)}` : "-"}. Alokasi ini dihitung dari neraca produksi dan konsumsi dengan jarak jalan terpendek.`,
      stat: { v: arusTotal / 1000, teks: nf(arusTotal / 1000, 1), unit: "ribu ton beras per bulan" },
      peta: {
        layer: "stokK2",
        nilai: petakan((k) => covBulan(k, AWAL), 3),
        valueLabel: `Cakupan stok akhir ${BLN[AWAL % 12]}`,
        legend: `Cakupan stok non-Bulog, akhir ${labelBulan(AWAL)}`,
        muted: true,
        arcs: arusBulan.slice(0, 22).map((t) => ({ from: t.from.n, to: t.to.n, ton: t.ton })),
      },
      fakta: {
        total_arus_ribu_ton_per_bulan: r(arusTotal / 1000, 1),
        jumlah_rute: arusBulan.length,
        rute_terbesar: arusAtas.map((t) => ({ dari: t.from.n, ke: t.to.n, ton_per_bulan: t.ton })),
        metode: "optimasi jarak jalan atas neraca produksi dan konsumsi",
      },
    },
    {
      key: "harga",
      k: "05 Pasar",
      judul: nPerhatianM > 0 ? "Harga di sejumlah wilayah mendekati HET" : "Harga dan batas HET",
      teks:
        `Harga dilihat 28 hari ke depan terhadap HET. Untuk beras medium ada ${wm.length} wilayah berstatus Waspada dan ${sm.length} Siaga. Untuk premium ada ${wp.length} Waspada dan ${sp.length} Siaga. ` +
        "Status dihitung dari peluang harga melewati HET menurut sebaran perubahan harga setahun terakhir.",
      stat: { v: nPerhatianM, teks: nf(nPerhatianM), unit: `wilayah Waspada atau Siaga untuk medium, ${nPerhatianP} untuk premium` },
      peta: {
        layer: "harga",
        nilai: petakan((k) => hargaAt(k, 4, "medium"), 0),
        valueLabel: "Prakiraan harga medium 28 hari",
      },
      fakta: {
        het_medium_rp: HET,
        het_premium_rp: HET_PREMIUM,
        horizon_hari: 28,
        medium: { waspada: wm.length, siaga: sm.length, wilayah_siaga: sm.map((k) => k.n).slice(0, 6), wilayah_waspada: wm.map((k) => k.n).slice(0, 6) },
        premium: { waspada: wp.length, siaga: sp.length },
        harga_medium_rata_rata_rp: { pekan_ini: r(hKini, -1), pekan_lalu: r(hLalu, -1), empat_pekan_lalu: r(h4, -1), prakiraan_28_hari: r(hPrak, -1) },
        perubahan_sepekan_rp: r(hKini - hLalu, -1),
        perubahan_empat_pekan_rp: r(hKini - h4, -1),
        prakiraan_termahal: termahal ? { wilayah: termahal.n, rp: r(hargaAt(termahal, 4, "medium"), -1) } : null,
        metode: "status dari peluang harga melewati HET menurut sebaran perubahan harga setahun terakhir",
      },
    },
    {
      key: "aksi",
      k: "06 Tindakan",
      judul: "Menyiapkan penyaluran SPHP",
      teks:
        `Bulog bisa melepas beras SPHP dari cabangnya ke kabupaten yang stoknya kurang. Rekomendasi terbaru ${nf(tonS)} ton lewat ${FLOWS.length} rute, dengan ${penerima.size} wilayah ` +
        `penerima untuk ${periodePanjang}. Volumenya dihitung dari stok Bulog per cabang November 2026 (angka pimpinan cabang di media, sisanya taksiran) dan jarak jalan.`,
      stat: { v: tonS, teks: nf(tonS), unit: "ton SPHP direkomendasikan" },
      peta: { layer: "harga", nilai: petakan((k) => hargaAt(k, 4, "medium"), 0), valueLabel: "Prakiraan harga medium 28 hari", flows: FLOWS.map((f) => ({ dari: f.from.n, ke: f.to.n, ton: f.ton, km: r(f.km, 1), bulan: f.bulan })) },
      fakta: {
        periode: periodePanjang,
        total_ton: tonS,
        jumlah_rute: FLOWS.length,
        jumlah_wilayah_penerima: penerima.size,
        penerima_terbesar: penerimaAtas.map(([n, t]) => ({ wilayah: n, ton: t })),
        metode: "stok Bulog per cabang Nov 2026 (berita pimpinan cabang + taksiran dari porsi pengadaan), jarak jalan",
      },
    },
  ]

  const aksiUmum: LangkahFakta = {
    ...langkah[5],
    teks:
      "Bulog bisa melepas beras SPHP dari cabangnya ke kabupaten yang stoknya kurang. Rincian rute dan volumenya hanya tersedia untuk akun dinas dan perusahaan mitra. " +
      "Warga tetap bisa mengecek harga lewat WhatsApp.",
    stat: langkah[4].stat,
    peta: { ...langkah[5].peta, flows: undefined },
    fakta: {},
  }

  return {
    data_per: ymd(NOW),
    data_per_label: `${NOW.getDate()} ${BLN[NOW.getMonth()]} ${NOW.getFullYear()}`,
    api_aktif: API_AKTIF,
    periode: { awal: labelBulan(AWAL), akhir: labelBulan(AKHIR), label: periodePanjang },
    run: { k1: K1?.meta.model_run_id ?? null, k2: K2?.meta.model_run_id ?? null, k3a: K3A?.meta.model_run_id ?? null, k3b: K3B?.meta.model_run_id ?? null },
    judul: "Dari sawah ke pasar",
    dek:
      `Panen ${periodePanjang} diperkirakan ${yoy < 0 ? "lebih kecil" : "lebih besar"} dari tahun lalu, ` +
      (nDef.length + nTip.length > 0 ? "stok di beberapa kota mulai tipis, " : "stok masih cukup di semua wilayah, ") +
      (nPerhatianM > 0 ? "dan harga di sejumlah wilayah mendekati HET. " : "dan harga masih di bawah HET. ") +
      "Enam bagian di bawah menelusuri rantainya, dari sawah sampai beras SPHP.",
    tigaAngka: [
      { teks: tanda(yoy) + nf(Math.abs(yoy), 1) + "%", label: `proyeksi panen ${periode} dibanding periode yang sama tahun lalu`, href: "#langkah-2" },
      { teks: nf(nDef.length), label: `kabupaten/kota diperkirakan defisit stok pada akhir ${namaBulan(TENGAH)}`, href: "#langkah-3" },
      { teks: nf(nPerhatianM), label: `wilayah berstatus Waspada atau Siaga untuk beras medium, dan ${nPerhatianP} untuk premium`, href: "#langkah-5" },
    ],
    langkah,
    aksiUmum,
  }
}

/** Ringkasan untuk perbandingan dengan edisi pekan lalu. */
export const angkaKunci = (f: FaktaPekan) => ({
  perubahan_panen_persen: (f.langkah[1].fakta.perubahan_persen as number) ?? null,
  wilayah_defisit: (f.langkah[2].fakta.jumlah_wilayah_defisit as number) ?? null,
  wilayah_perhatian_harga_medium: f.langkah[4].stat.v,
  harga_medium_rata_rata_rp: ((f.langkah[4].fakta.harga_medium_rata_rata_rp as { pekan_ini: number }) ?? { pekan_ini: null }).pekan_ini,
})

