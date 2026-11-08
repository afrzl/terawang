/** Ornamen latar kop: orbit satelit dan petak sawah bergaris. */
export function KopPattern() {
  return (
    <svg className="kop-pattern" viewBox="0 0 1400 200" preserveAspectRatio="xMaxYMid slice" aria-hidden="true">
      <defs>
        <pattern id="kop-rows" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(-28)">
          <line x1="0" y1="0" x2="0" y2="14" stroke="rgba(255,255,255,.07)" strokeWidth="2" />
        </pattern>
        <linearGradient id="kop-fade" x1="0" x2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset=".55" stopColor="#fff" stopOpacity=".9" />
          <stop offset="1" stopColor="#fff" stopOpacity="1" />
        </linearGradient>
        <mask id="kop-mask">
          <rect width="1400" height="200" fill="url(#kop-fade)" />
        </mask>
      </defs>
      <g mask="url(#kop-mask)">
        <rect width="1400" height="200" fill="url(#kop-rows)" />
        <g fill="none" stroke="rgba(255,255,255,.16)">
          <ellipse cx="1180" cy="40" rx="260" ry="90" />
          <ellipse cx="1180" cy="40" rx="190" ry="62" strokeDasharray="3 6" />
          <ellipse cx="1180" cy="40" rx="330" ry="125" />
        </g>
        <g transform="translate(1418 52) rotate(18)">
          <rect x="-7" y="-5" width="14" height="10" rx="2" fill="rgba(255,255,255,.55)" />
          <rect x="-26" y="-3" width="16" height="6" fill="rgba(185,227,154,.6)" />
          <rect x="10" y="-3" width="16" height="6" fill="rgba(185,227,154,.6)" />
        </g>
        <circle cx="940" cy="40" r="3" fill="rgba(255,255,255,.5)" />
      </g>
    </svg>
  )
}
