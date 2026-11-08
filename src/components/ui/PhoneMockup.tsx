import { BadgeCheck, ChevronLeft, Mic, MoreVertical, Paperclip, Phone, Plus, SendHorizontal } from "lucide-react"
import { useEffect, useRef } from "react"

export type ChatItem =
  | { type: "day"; text: string }
  | { type: "in" | "out"; text: React.ReactNode; time: string }
  | { type: "card"; time: string; accent: string; title: string; rows: [string, React.ReactNode][]; foot?: React.ReactNode; chart?: React.ReactNode; numbered?: boolean }
  | { type: "quick"; options: string[] }

interface PhoneMockupProps {
  items: ChatItem[]
  /** Teks status di bawah nama akun. */
  status?: string
  clock?: string
  /** Mode animasi: pesan baru muncul dengan transisi dan obrolan menggulir ke bawah. */
  animate?: boolean
  /** Teks yang sedang diketik di kolom pesan. */
  draft?: string
  /** Tampilkan gelembung "sedang mengetik" dari bot. */
  typing?: boolean
  /** Sorotan ketukan: "send" untuk tombol kirim, atau label tombol balasan cepat. */
  tap?: string | null
  /** Tampilkan papan ketik di layar. */
  keyboard?: boolean
  /** Karakter yang sedang ditekan di papan ketik. */
  pressed?: string
}

const ROWS_ABC = ["qwertyuiop", "asdfghjkl", "zxcvbnm"]
const ROWS_123 = ["1234567890", "-/:;()&@\"", ".,?!'"]

/** Papan ketik ponsel generik; tombol yang ditekan menyala dan memunculkan gelembung huruf. */
function Keyboard({ pressed, last }: { pressed?: string; last?: string }) {
  const p = pressed ?? ""
  // Tata letak (huruf besar/angka) mengikuti karakter terakhir agar tidak berkedip di antara ketukan.
  const ref = pressed && /[^\s,]/.test(pressed) ? pressed : (last ?? "")
  const num = /[0-9\-/:;()&@".?!']/.test(ref)
  const upper = ref !== ref.toLowerCase()
  const rows = num ? ROWS_123 : ROWS_ABC
  const on = (c: string) => p.toLowerCase() === c.toLowerCase()
  const key = (c: string) => (
    <span key={c} className={on(c) ? "k on" : "k"}>
      {upper ? c.toUpperCase() : c}
      {on(c) && <b className="pop">{upper ? c.toUpperCase() : c}</b>}
    </span>
  )
  return (
    <div className="ph-kb-keys" aria-hidden="true">
      <div className="kr">{[...rows[0]].map(key)}</div>
      <div className="kr r2">{[...rows[1]].map(key)}</div>
      <div className="kr">
        <span className={upper && !num ? "k fn lit" : "k fn"}>{num ? "#+=" : "⇧"}</span>
        {[...rows[2]].map(key)}
        <span className="k fn">⌫</span>
      </div>
      <div className="kr">
        <span className="k fn w2">{num ? "ABC" : "123"}</span>
        {!num && key(",")}
        <span className={p === " " ? "k sp on" : "k sp"}>spasi</span>
        <span className="k fn w2">↵</span>
      </div>
    </div>
  )
}

function StatusBar({ clock }: { clock: string }) {
  return (
    <div className="ph-status">
      <span>{clock}</span>
      <span className="ph-island" />
      <span className="ph-icons" aria-hidden="true">
        <svg width="17" height="11" viewBox="0 0 17 11">
          <rect x="0" y="7" width="3" height="4" rx="1" fill="currentColor" />
          <rect x="4.5" y="5" width="3" height="6" rx="1" fill="currentColor" />
          <rect x="9" y="2.5" width="3" height="8.5" rx="1" fill="currentColor" />
          <rect x="13.5" y="0" width="3" height="11" rx="1" fill="currentColor" />
        </svg>
        <svg width="15" height="11" viewBox="0 0 15 11">
          <path d="M7.5 2.2c2.2 0 4.2.9 5.6 2.3l1.2-1.2A9.6 9.6 0 0 0 7.5.5 9.6 9.6 0 0 0 .7 3.3l1.2 1.2a7.9 7.9 0 0 1 5.6-2.3z" fill="currentColor" />
          <path d="M7.5 5.6c1.3 0 2.4.5 3.3 1.3l1.2-1.2a6.3 6.3 0 0 0-9 0l1.2 1.2c.9-.8 2-1.3 3.3-1.3z" fill="currentColor" />
          <circle cx="7.5" cy="9.3" r="1.5" fill="currentColor" />
        </svg>
        <svg width="25" height="12" viewBox="0 0 25 12">
          <rect x=".5" y=".5" width="21" height="11" rx="3.2" fill="none" stroke="currentColor" opacity=".45" />
          <rect x="2" y="2" width="15" height="8" rx="2" fill="currentColor" />
          <rect x="22.5" y="4" width="1.8" height="4" rx=".9" fill="currentColor" opacity=".45" />
        </svg>
      </span>
    </div>
  )
}

function Ticks() {
  return (
    <svg className="ph-ticks" width="16" height="10" viewBox="0 0 16 10" aria-label="dibaca">
      <path d="M1 5.2 3.8 8 9.6 1.6M6.4 8l.6.6L13.4 1.6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Bingkai ponsel generik berisi percakapan bot TERAWANG (ilustrasi, bukan aplikasi sungguhan). */
export function PhoneMockup({ items, status = "akun resmi · biasanya membalas instan", clock = "07.12", animate, draft, typing, tap, keyboard, pressed }: PhoneMockupProps) {
  const chat = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = chat.current
    if (!animate || !el) return
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
    // Gulir lagi setelah papan ketik selesai naik/turun.
    const t = window.setTimeout(() => el.scrollTo({ top: el.scrollHeight, behavior: "smooth" }), 300)
    return () => window.clearTimeout(t)
  }, [animate, items.length, typing, keyboard])
  return (
    <div className={animate ? "ph-device ph-anim" : "ph-device"}>
      <span className="ph-btn ph-btn-a" />
      <span className="ph-btn ph-btn-b" />
      <span className="ph-btn ph-btn-c" />
      <div className="ph-screen">
        <StatusBar clock={clock} />
        <div className="ph-head">
          <ChevronLeft size={20} />
          <div className="ph-avatar" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 32 32">
              <path d="M16 5c-1.3 5.4-5.6 7.6-5.6 13a5.6 5.6 0 0 0 11.2 0c0-5.4-4.3-7.6-5.6-13z" fill="#B9E39A" />
              <path d="M16 12v15" stroke="#163E66" strokeWidth="1.8" />
            </svg>
          </div>
          <div className="ph-who">
            <b>
              TERAWANG Jatim <BadgeCheck size={13} className="ph-verified" />
            </b>
            <span>{typing ? "sedang mengetik…" : status}</span>
          </div>
          <Phone size={17} />
          <MoreVertical size={17} />
        </div>
        <div className="ph-chat" ref={chat}>
          {items.map((it, i) => {
            if (it.type === "day")
              return (
                <div key={i} className="ph-day">
                  {it.text}
                </div>
              )
            if (it.type === "quick")
              return (
                <div key={i} className="ph-quick">
                  {it.options.map((o) => (
                    <span key={o} className={tap === o ? "ph-tapping" : undefined}>
                      {o}
                    </span>
                  ))}
                </div>
              )
            if (it.type === "card")
              return (
                <div key={i} className="ph-msg in ph-card" style={{ ["--card-accent" as string]: it.accent }}>
                  <div className="ph-card-title">{it.title}</div>
                  {it.chart}
                  <dl className={it.numbered ? "num" : undefined}>
                    {it.rows.map(([k, v]) => (
                      <div key={k}>
                        <dt>{k}</dt>
                        <dd>{v}</dd>
                      </div>
                    ))}
                  </dl>
                  {it.foot && <div className="ph-card-foot">{it.foot}</div>}
                  <time>{it.time}</time>
                </div>
              )
            return (
              <div key={i} className={`ph-msg ${it.type}`}>
                {it.text}
                <time>
                  {it.time}
                  {it.type === "out" && <Ticks />}
                </time>
              </div>
            )
          })}
          {typing && (
            <div className="ph-msg in ph-typing" aria-label="Bot sedang mengetik">
              <i />
              <i />
              <i />
            </div>
          )}
        </div>
        <div className={keyboard ? "ph-input kb-open" : "ph-input"}>
          <Plus size={18} />
          <div className="ph-field">
            {draft ? (
              <span className="ph-draft">
                {draft}
                <i className="ph-caret" />
              </span>
            ) : (
              "Ketik pesan"
            )}{" "}
            <Paperclip size={15} />
          </div>
          <span className={tap === "send" ? "ph-mic ph-tapping" : "ph-mic"}>{draft ? <SendHorizontal size={15} /> : <Mic size={16} />}</span>
        </div>
        {animate && (
          <div className={keyboard ? "ph-kb open" : "ph-kb"}>
            <Keyboard pressed={pressed} last={draft?.replace(/[\s,]+$/, "").slice(-1)} />
          </div>
        )}
        <span className="ph-home" />
      </div>
    </div>
  )
}
