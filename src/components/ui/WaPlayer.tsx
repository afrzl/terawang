import { Pause, Play, RotateCcw } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { PhoneMockup, type ChatItem } from "@/components/ui/PhoneMockup"

export interface WaScenario {
  title: string
  clock: string
  items: ChatItem[]
  /** Keterangan untuk tiap item (sejajar dengan items); null = pakai keterangan sebelumnya. */
  caps: (string | null)[]
  /** Tombol balasan cepat yang diketuk di akhir adegan. */
  tapOption?: string
}

interface Frame {
  shown: number
  draft?: string
  typing?: boolean
  tap?: string
  kb?: boolean
  key?: string
  cap: string
  dur: number
}

/** Ubah satu skenario menjadi deretan bingkai berdurasi tetap (deterministik, jadi bisa direkam jadi video). */
function toFrames(sc: WaScenario): Frame[] {
  const f: Frame[] = []
  let cap = sc.caps.find(Boolean) ?? ""
  f.push({ shown: 0, cap, dur: 900 })
  sc.items.forEach((it, i) => {
    cap = sc.caps[i] ?? cap
    if (it.type === "day") f.push({ shown: i + 1, cap, dur: 900 })
    else if (it.type === "out") {
      const text = typeof it.text === "string" ? it.text : ""
      // Papan ketik naik, huruf ditekan satu per satu, kirim, lalu papan ketik turun.
      f.push({ shown: i, cap, dur: 500 })
      f.push({ shown: i, kb: true, cap, dur: 650 })
      for (let j = 1; j <= text.length; j++) f.push({ shown: i, kb: true, draft: text.slice(0, j), key: text[j - 1], cap, dur: text[j - 1] === " " ? 160 : 110 })
      f.push({ shown: i, kb: true, draft: text, cap, dur: 450 })
      f.push({ shown: i, kb: true, draft: text, tap: "send", cap, dur: 400 })
      f.push({ shown: i + 1, cap, dur: 1100 })
    } else if (it.type === "quick") {
      f.push({ shown: i + 1, cap, dur: 1900 })
      if (sc.tapOption) f.push({ shown: i + 1, tap: sc.tapOption, cap, dur: 1100 })
    } else {
      f.push({ shown: i, typing: true, cap, dur: 1300 })
      f.push({ shown: i + 1, cap, dur: it.type === "card" ? 4200 : 2200 })
    }
  })
  f[f.length - 1].dur += 1200
  return f
}

const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches

/** Pemutar animasi cara pakai bot: adegan berganti otomatis seperti video, dengan keterangan per langkah. */
export function WaPlayer({ scenarios }: { scenarios: WaScenario[] }) {
  const frames = useMemo(() => scenarios.map(toFrames), [scenarios])
  const total = useMemo(() => frames.map((fs) => fs.reduce((a, x) => a + x.dur, 0)), [frames])
  const [ch, setCh] = useState(0)
  const [fi, setFi] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [inView, setInView] = useState(false)
  const started = useRef(false)
  const root = useRef<HTMLDivElement>(null)

  // Mulai otomatis saat pemutar terlihat (sekali), jeda saat keluar layar.
  useEffect(() => {
    const el = root.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.35 })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  useEffect(() => {
    if (!inView || started.current) return
    started.current = true
    // Gerak dikurangi: tampilkan adegan pertama utuh tanpa memutar otomatis.
    const t = window.setTimeout(() => (reduced() ? setFi(frames[0].length - 1) : setPlaying(true)), 0)
    return () => window.clearTimeout(t)
  }, [inView, frames])

  const fs = frames[ch]
  const frame = fs[Math.min(fi, fs.length - 1)]
  const live = playing && inView

  useEffect(() => {
    if (!live) return
    const t = window.setTimeout(() => {
      if (fi < fs.length - 1) setFi(fi + 1)
      else {
        setCh((ch + 1) % scenarios.length)
        setFi(0)
      }
    }, frame.dur)
    return () => window.clearTimeout(t)
  }, [live, fi, ch, fs.length, frame.dur, scenarios.length])

  const go = (c: number) => {
    setCh(c)
    setFi(0)
    setPlaying(true)
  }
  const elapsed = fs.slice(0, fi).reduce((a, x) => a + x.dur, 0)
  const sc = scenarios[ch]

  return (
    <div className="wa-player" ref={root}>
      <div className="wa-phone">
        <PhoneMockup animate key={ch} items={sc.items.slice(0, frame.shown)} clock={sc.clock} draft={frame.draft} typing={frame.typing} tap={frame.tap} keyboard={frame.kb} pressed={frame.key} />
      </div>
      <div className="wa-side">
        <div className="eyebrow">Cara pakai · {scenarios.length} langkah</div>
        <ol className="wa-chapters">
          {scenarios.map((s, i) => (
            <li key={s.title}>
              <button type="button" className={i === ch ? "on" : i < ch ? "done" : undefined} onClick={() => go(i)} aria-current={i === ch ? "step" : undefined}>
                <span className="wa-n">{String(i + 1).padStart(2, "0")}</span>
                <span className="wa-t">{s.title}</span>
                <span className="wa-bar" aria-hidden="true">
                  <i
                    key={`${ch}-${fi}-${live}`}
                    style={
                      i === ch
                        ? {
                            width: `${(elapsed / total[i]) * 100}%`,
                            ["--to" as string]: `${((elapsed + frame.dur) / total[i]) * 100}%`,
                            animationDuration: `${frame.dur}ms`,
                            animationPlayState: live ? "running" : "paused",
                          }
                        : { width: i < ch ? "100%" : "0%" }
                    }
                    className={i === ch ? "run" : undefined}
                  />
                </span>
              </button>
            </li>
          ))}
        </ol>
        <p className="wa-cap" aria-live="polite" key={frame.cap}>
          {frame.cap}
        </p>
        <div className="wa-ctrl">
          <button type="button" className="wk-play" onClick={() => setPlaying(!playing)} aria-label={playing ? "Jeda" : "Putar"}>
            {playing ? <Pause size={15} /> : <Play size={15} />}
          </button>
          <button type="button" className="wa-again" onClick={() => go(0)}>
            <RotateCcw size={14} /> Ulangi dari awal
          </button>
        </div>
      </div>
    </div>
  )
}
