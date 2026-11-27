// Rekam Peta Ringkasan terawang.tech secara REAL-TIME lewat CDP Page.startScreencast.
// Pakai: node rekam.js desktop|hp   -> hasil di d/ atau m/ (frames mentah + events.json)
const { chromium } = require("playwright")
const fs = require("fs")
const path = require("path")

const HP = process.argv[2] === "hp"
const OUT = path.join(__dirname, HP ? "m" : "d")
const RAW = path.join(OUT, "raw")
const VIEW = HP ? { width: 540, height: 960 } : { width: 1600, height: 900 }
const DSF = 2
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const jeda = (a = 800, b = 1500) => sleep(a + Math.random() * (b - a))
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

let page, cdp
let cur = HP ? { x: 470, y: 700 } : { x: 1450, y: 620 }
const clicks = [] // {ts, aksi, target}
const skipped = []

async function moveTo(x, y, ms = 380) {
  const a = { ...cur }
  const t0 = Date.now()
  for (;;) {
    const t = Math.min(1, (Date.now() - t0) / ms)
    const e = ease(t)
    await page.mouse.move(a.x + (x - a.x) * e, a.y + (y - a.y) * e)
    if (t >= 1) break
    await sleep(14)
  }
  cur = { x, y }
}
async function click(target) {
  clicks.push({ ts: Date.now() / 1000, aksi: "klik", target })
  await page.mouse.down()
  await sleep(90)
  await page.mouse.up()
}
async function center(sel) {
  const loc = page.locator(sel).filter({ visible: true }).first()
  const bb = await loc.boundingBox({ timeout: 3000 })
  if (!bb) throw new Error("tidak terlihat: " + sel)
  return { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2, bb }
}
async function step(name, fn) {
  try { await fn() } catch (e) {
    skipped.push(name + ": " + e.message.split("\n")[0])
    console.log("LEWATI", name, e.message.split("\n")[0])
  }
}

const CURSOR_JS = (hp) => {
  const d = document.createElement("div")
  d.id = "__fake_cursor"
  d.style.cssText = "position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;transition:none;will-change:transform;"
  d.innerHTML = hp
    ? '<div style="width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;background:rgba(255,255,255,.38);border:2px solid rgba(255,255,255,.85);box-shadow:0 2px 10px rgba(0,0,0,.35)"></div>'
    : '<svg width="22" height="22" viewBox="0 0 22 22" style="display:block;filter:drop-shadow(0 1px 2px rgba(0,0,0,.45))"><path d="M2 1.5 L2 18.5 L6.6 14.3 L9.6 20.6 L12.6 19.2 L9.7 13 L16 13 Z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>'
  const inner = d.firstElementChild
  inner.style.transformOrigin = hp ? "center" : "2px 1.5px"
  document.documentElement.appendChild(d)
  let x = -100, y = -100, down = false
  const upd = () => {
    d.style.transform = `translate(${x}px,${y}px)`
    inner.style.transform = down ? (hp ? "scale(.8)" : "scale(.85)") : "none"
    if (hp) inner.style.background = down ? "rgba(255,255,255,.6)" : "rgba(255,255,255,.38)"
  }
  addEventListener("mousemove", (e) => { x = e.clientX; y = e.clientY; upd() }, true)
  addEventListener("mousedown", () => { down = true; upd() }, true)
  addEventListener("mouseup", () => { down = false; upd() }, true)
  upd()
}

;(async () => {
  fs.rmSync(OUT, { recursive: true, force: true })
  fs.mkdirSync(RAW, { recursive: true })
  const browser = await chromium.launch({ headless: false, args: ["--ignore-gpu-blocklist", "--enable-gpu-rasterization"] })
  const ctx = await browser.newContext({
    viewport: VIEW, deviceScaleFactor: DSF, locale: "id-ID",
    ...(HP ? { isMobile: true, hasTouch: true } : {}),
  })
  page = await ctx.newPage()
  await page.goto("https://terawang.tech/", { waitUntil: "networkidle", timeout: 90000 })
  await page.waitForTimeout(3000)
  await page.waitForLoadState("networkidle")
  await page.addStyleTag({ content: 'a[title="Tanya lewat WhatsApp"],.wa-fab,[class*="cookie"],[id*="cookie"]{display:none!important} *{cursor:none!important}' })
  await page.evaluate(CURSOR_JS, HP)
  await page.mouse.move(cur.x, cur.y)
  await sleep(500)

  // Mulai screencast
  cdp = await ctx.newCDPSession(page)
  const frames = [] // {ts, file}
  const writes = []
  cdp.on("Page.screencastFrame", (f) => {
    const file = path.join(RAW, String(frames.length).padStart(5, "0") + ".jpg")
    frames.push({ ts: f.metadata.timestamp, file })
    writes.push(fs.promises.writeFile(file, Buffer.from(f.data, "base64")))
    cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {})
  })
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, everyNthFrame: 1, maxWidth: VIEW.width * DSF, maxHeight: VIEW.height * DSF })
  const tStart = Date.now() / 1000
  await sleep(400)

  // 1. Visualisasi -> Peluang melewati HET
  await step("ganti lapisan", async () => {
    if (HP) {
      const f = await center('button:has-text("Filter")')
      await moveTo(f.x, f.y); await click("Filter"); await sleep(400)
    }
    const v = await center('button[aria-label="Visualisasi"]')
    await moveTo(v.x, v.y); await click("Visualisasi"); await sleep(500)
    const o = await center('[role=option]:has-text("Peluang melewati HET")')
    await moveTo(o.x, o.y, 350); await click("Peluang melewati HET"); await sleep(HP ? 400 : 600)
    if (HP) {
      const t = await center('button:has-text("Lihat hasil")')
      await moveTo(t.x, t.y, 350); await click("Lihat hasil"); await sleep(400)
    }
    await jeda(500, 700)
  })

  // 2. Tarik penggeser pekan mundur 2 langkah
  await step("geser pekan", async () => {
    const s = await center('input[aria-label="Pekan"]')
    const [mn, mx, val] = await page.evaluate(() => {
      const e = [...document.querySelectorAll('input[aria-label="Pekan"]')].find((x) => x.offsetParent)
      return [+e.min, +e.max, +e.value]
    })
    const px = (v) => s.bb.x + 8 + ((v - mn) / (mx - mn)) * (s.bb.width - 16)
    await moveTo(px(val), s.y)
    clicks.push({ ts: Date.now() / 1000, aksi: "klik", target: "Penggeser pekan (tarik)" })
    await page.mouse.down()
    await sleep(80)
    await moveTo(px(Math.max(mn, val - 2)), s.y, 450)
    await page.mouse.up()
    await jeda(500, 700)
  })

  // 3. Peta 3D, tunggu animasi
  await step("3D", async () => {
    const b = await center('button[title="Peta 3D dengan batang"]')
    await moveTo(b.x, b.y); await click("Peta 3D dengan batang")
    await sleep(1800)
  })

  // 4. Putar ke kanan 2x
  await step("putar ke kanan", async () => {
    const r = await center('button[title="Putar ke kanan"]')
    await moveTo(r.x, r.y, 400); await click("Putar ke kanan"); await sleep(1250)
    if (!HP) { await click("Putar ke kanan"); await sleep(1250) } // ponsel: sekali, seperti rekam.js lama
  })

  // 5. Kembali ke seluruh Jatim
  await step("kembali ke seluruh Jatim", async () => {
    const k = await center('button[title="Kembali ke seluruh Jawa Timur"]')
    await moveTo(k.x, k.y, 400); await click("Kembali ke seluruh Jawa Timur")
    await sleep(HP ? 1250 : 1500)
  })

  const tEnd = Date.now() / 1000
  await cdp.send("Page.stopScreencast")
  await sleep(300)
  await Promise.all(writes)

  // Deret 30 fps konstan
  const t0 = tStart
  const N = Math.floor((tEnd - t0) * 30)
  const FR = path.join(OUT, "frames")
  fs.mkdirSync(FR, { recursive: true })
  let j = 0
  const pick = []
  for (let k = 0; k < N; k++) {
    const t = t0 + k / 30
    while (j + 1 < frames.length && frames[j + 1].ts <= t) j++
    pick.push(j)
    fs.copyFileSync(frames[j].file, path.join(FR, String(k + 1).padStart(4, "0") + ".jpg"))
  }
  const events = clicks.map((c) => ({ frame: Math.round((c.ts - t0) * 30) + 1, aksi: c.aksi, target: c.target }))
  fs.writeFileSync(path.join(OUT, "events.json"), JSON.stringify(events, null, 1))
  fs.writeFileSync(path.join(OUT, "frames-raw.json"), JSON.stringify(frames.map((f) => f.ts - t0)))
  console.log(JSON.stringify({ mode: HP ? "hp" : "desktop", durasi: +(tEnd - t0).toFixed(2), rawFrames: frames.length, fpsRata: +(frames.length / (tEnd - t0)).toFixed(1), frames30: N, unik: new Set(pick).size, events, skipped }, null, 1))
  await browser.close()
})()
