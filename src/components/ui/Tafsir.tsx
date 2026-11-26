import { useEffect, useState } from "react"
import { LoaderCircle, TextSearch, X } from "lucide-react"
import { WILAYAH } from "@/lib/data"
import { SATUAN, bulanLabel, useFilterOpsional } from "@/lib/filter"

type Keadaan = { k: "diam" } | { k: "muat" } | { k: "ok"; teks: string; cache: boolean } | { k: "galat"; teks: string }

/** Konteks filter aktif yang ikut dikirim, supaya interpretasi menyebut periode/wilayah yang benar. */
function useKonteks(keterangan?: string): Record<string, string> {
  const f = useFilterOpsional()
  const out: Record<string, string> = {}
  if (f) {
    const t = f.tersedia
    if (t.waktu) out.periode = f.mulai === f.akhir ? bulanLabel(f.mulai) : `${bulanLabel(f.mulai)} s.d. ${bulanLabel(f.akhir)}`
    if (t.wilayah) {
      const n = f.W.length
      out.wilayah = n === WILAYAH.length ? `semua ${n} kab/kota Jawa Timur` : n <= 10 ? f.W.map((k) => k.n).join(", ") : `${n} kab/kota terpilih`
    }
    if (t.satuan) out.satuan_produksi = SATUAN[f.satuan].panjang
    if (t.jenis) out.jenis_beras = f.jenisHarga.join(" dan ")
  }
  if (keterangan) out.keterangan = keterangan
  return out
}

/** Tombol + kotak interpretasi satu grafik. `data` = data terdaftar oleh grafik di panel ini. */
export function useTafsir({ judul, data, keterangan }: { judul: string; data: Record<string, unknown>; keterangan?: string }) {
  const konteks = useKonteks(keterangan)
  const [st, setSt] = useState<Keadaan>({ k: "diam" })
  const ada = Object.keys(data).length > 0
  const tanda = ada ? JSON.stringify([judul, konteks, data]) : ""

  // Filter atau data berubah: interpretasi lama tidak berlaku lagi.
  useEffect(() => setSt({ k: "diam" }), [tanda])

  const minta = async () => {
    setSt({ k: "muat" })
    try {
      const isi = Object.keys(data).length === 1 ? Object.values(data)[0] : data
      const r = await fetch("/api/tafsir", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ grafik: judul, judul, konteks, data: isi }),
      })
      const j = (r.headers.get("content-type") ?? "").includes("json") ? await r.json() : null
      if (!r.ok || !j?.teks) throw new Error(j?.galat ?? "Layanan interpretasi tidak terjangkau.")
      setSt({ k: "ok", teks: j.teks, cache: !!j.cache })
    } catch (e) {
      setSt({ k: "galat", teks: e instanceof Error ? e.message : "Gagal membuat interpretasi." })
    }
  }

  const tombol = ada ? (
    <button type="button" className="tafsir-btn" onClick={minta} disabled={st.k === "muat"} aria-expanded={st.k !== "diam"}>
      {st.k === "muat" ? <LoaderCircle size={14} className="putar" /> : <TextSearch size={14} />}
      Interpretasi
    </button>
  ) : null

  const kotak =
    st.k === "diam" ? null : (
      <div className={`tafsir${st.k === "galat" ? " galat" : ""}`} role="status" aria-live="polite">
        {st.k === "muat" ? (
          <div className="tafsir-muat">
            <span />
            <span />
          </div>
        ) : (
          <p>{st.teks}</p>
        )}
        {st.k !== "muat" && (
          <button type="button" className="tafsir-tutup" onClick={() => setSt({ k: "diam" })} aria-label="Tutup interpretasi">
            <X size={14} />
          </button>
        )}
      </div>
    )

  return { tombol, kotak }
}
