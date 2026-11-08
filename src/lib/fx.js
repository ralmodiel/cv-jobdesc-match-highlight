// Marks + the chosen style per category → per-character effect bits for each marked block.
export const FX = { bold: 1, underline: 2, highlight: 4, off: 0 };

/** effects(blocks, marks, styles) → Map<blockIndex, Uint8Array(text.length)> of FX bits */
export function effects(blocks, marks, styles) {
  const out = new Map();
  for (const m of marks) {
    const f = FX[styles[m.cat]] || 0, b = blocks[m.block];
    if (!f || !b) continue;
    let eff = out.get(m.block);
    if (!eff) out.set(m.block, (eff = new Uint8Array(b.text.length)));
    // a tab is the gap before a date or a column: shaded or underlined, it would draw a bar across the empty space
    for (let i = Math.max(0, m.start); i < Math.min(m.end, eff.length); i++) if (b.text[i] !== "\t") eff[i] |= f;
  }
  return out;
}
