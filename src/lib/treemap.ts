export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Tata letak treemap "squarified" (Bruls dkk., 2000): kotak sedekat mungkin ke persegi. */
export function squarify<T>(items: T[], val: (t: T) => number, r: Rect): (Rect & { item: T })[] {
  const total = items.reduce((a, t) => a + Math.max(0, val(t)), 0)
  if (!total || r.w <= 0 || r.h <= 0) return []
  const k = (r.w * r.h) / total
  const nodes = items.map((item) => ({ item, a: Math.max(0, val(item)) * k })).filter((n) => n.a > 0)
  nodes.sort((a, b) => b.a - a.a)
  const out: (Rect & { item: T })[] = []
  let { x, y, w, h } = r
  const worst = (row: typeof nodes, side: number) => {
    const s = row.reduce((a, n) => a + n.a, 0)
    let mx = 0
    let mn = Infinity
    for (const n of row) {
      mx = Math.max(mx, n.a)
      mn = Math.min(mn, n.a)
    }
    return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn))
  }
  const place = (row: typeof nodes) => {
    const s = row.reduce((a, n) => a + n.a, 0)
    if (w >= h) {
      const cw = s / h
      let yy = y
      for (const n of row) {
        const hh = n.a / cw
        out.push({ x, y: yy, w: cw, h: hh, item: n.item })
        yy += hh
      }
      x += cw
      w -= cw
    } else {
      const rh = s / w
      let xx = x
      for (const n of row) {
        const ww = n.a / rh
        out.push({ x: xx, y, w: ww, h: rh, item: n.item })
        xx += ww
      }
      y += rh
      h -= rh
    }
  }
  let row: typeof nodes = []
  for (let i = 0; i < nodes.length; ) {
    const side = Math.min(w, h)
    const n = nodes[i]
    if (!row.length || worst([...row, n], side) <= worst(row, side)) {
      row.push(n)
      i++
    } else {
      place(row)
      row = []
    }
  }
  if (row.length) place(row)
  return out
}
