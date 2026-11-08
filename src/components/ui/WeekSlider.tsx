import { useEffect, useRef, useState } from "react"
import { Pause, Play } from "lucide-react"
import { dfmt } from "@/lib/format"
import { weekDate, weekLabel } from "@/lib/weeks"

interface WeekSliderProps {
  /** Pekan relatif terhadap pekan ini (negatif = lampau). */
  min: number
  max: number
  value: number
  onChange: (w: number) => void
  /** Jumlah wilayah bermasalah per pekan, indeks 0 = `min`. */
  counts: number[]
  countLabel: string
  color: string
}

/** Penggeser waktu per pekan dengan tombol putar dan strip jumlah wilayah bermasalah. */
export function WeekSlider({ min, max, value, onChange, counts, countLabel, color }: WeekSliderProps) {
  const [playing, setPlaying] = useState(false)
  const valRef = useRef(value)
  useEffect(() => {
    valRef.current = value
  }, [value])
  const cm = Math.max(1, ...counts)

  useEffect(() => {
    if (!playing) return
    const id = window.setInterval(() => {
      const nx = valRef.current + 1
      if (nx > max) {
        setPlaying(false)
        return
      }
      onChange(nx)
    }, 650)
    return () => window.clearInterval(id)
  }, [playing, max, onChange])

  const toggle = () => {
    if (playing) return setPlaying(false)
    if (value >= max) onChange(min)
    setPlaying(true)
  }
  const pct = (w: number) => ((w - min) / (max - min)) * 100

  return (
    <div className="wk">
      <button type="button" className="wk-play" onClick={toggle} aria-label={playing ? "Jeda" : "Putar perubahan per pekan"}>
        {playing ? <Pause size={15} /> : <Play size={15} />}
      </button>
      <div className="wk-track">
        <div className="wk-bars" aria-hidden="true">
          {counts.map((c, i) => {
            const w = min + i
            return (
              <span
                key={w}
                className={w === value ? "on" : w > 0 ? "fc" : undefined}
                style={{ height: `${8 + (c / cm) * 30}px`, background: c ? color : "var(--rule)" }}
                title={`${weekLabel(w)}: ${c} ${countLabel}`}
                onClick={() => {
                  setPlaying(false)
                  onChange(w)
                }}
              />
            )
          })}
        </div>
        <input
          type="range"
          min={min}
          max={max}
          step={1}
          value={value}
          onChange={(e) => {
            setPlaying(false)
            onChange(+e.target.value)
          }}
          aria-label="Pekan"
          aria-valuetext={weekLabel(value)}
        />
        <div className="wk-ticks">
          <span>{dfmt(weekDate(min))}</span>
          <span className="end">+{max} pkn</span>
          <span className="now" style={{ left: `${pct(0)}%` }}>
            kini
          </span>
        </div>
      </div>
      <div className="wk-read">
        <b>{counts[value - min]}</b>
        <span>{countLabel}</span>
      </div>
    </div>
  )
}
