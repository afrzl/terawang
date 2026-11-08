import { DAY, NOW, dfmt } from "./format"

/** Tanggal untuk pekan relatif `w` terhadap pekan ini. */
export const weekDate = (w: number) => new Date(+NOW + w * 7 * DAY)

export function weekLabel(w: number) {
  if (w === 0) return `pekan ini (${dfmt(NOW)})`
  return w < 0 ? `${-w} pekan lalu (${dfmt(weekDate(w))})` : `prakiraan +${w} pekan (${dfmt(weekDate(w))})`
}
