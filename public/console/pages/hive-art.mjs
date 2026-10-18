// Rendering only; API calls retain the shared session and stale-response checks.
export default function create() {
  return function hiveArt() {
    return `<svg class="hive-art" viewBox="0 0 400 240" fill="none" aria-hidden="true">
<defs>
<pattern id="hex" width="76" height="88" patternUnits="userSpaceOnUse">
<path d="M38 1 75 22v44L38 87 1 66V22Z" stroke="#b8c8ab" stroke-opacity=".12"/>
</pattern>
<radialGradient id="glow">
<stop stop-color="#b0b979" stop-opacity=".17"/>
<stop offset="1" stop-color="#b0b979" stop-opacity="0"/>
</radialGradient>
</defs>
<rect width="400" height="240" fill="url(#hex)"/>
<circle cx="220" cy="125" r="125" fill="url(#glow)"/>
<path d="M205 40 269 77v74l-64 37-64-37V77Z" stroke="#e5c86d" stroke-opacity=".25"/>
<path d="m205 57 49 28v58l-49 28-49-28V85Z" fill="#2c4735" stroke="#d8bf68"/>
<path d="m205 79 30 17v13h-14v-6l-16-9-16 9v24l16 9 16-9v-3h-17v-13h31v24l-30 18-30-18V96Z" fill="#e9cd76"/>
<path d="M20 115h75l27-15h34M255 115h40l23 14h65" stroke="#cab469" stroke-dasharray="4 5"/>
<circle cx="95" cy="115" r="4" fill="#d6bd65"/>
<circle cx="320" cy="129" r="4" fill="#d6bd65"/>
<rect x="265" y="174" width="94" height="25" rx="12" fill="#3c5140" stroke="#637255"/>
<circle cx="279" cy="187" r="3" fill="#bdd694"/>
<text x="289" y="190" fill="#d1dec4" font-size="8" font-family="sans-serif">Policy gate</text>
<path d="m99 36 7 4v8l-7 4-7-4v-8Z" fill="#c9ac53" fill-opacity=".5"/>
</svg>`;
  };
}
