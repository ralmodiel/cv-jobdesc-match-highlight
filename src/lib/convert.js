// The download. Same format as the upload: the original file edited in place, so the layout is exactly the person's own.
// Other format: rebuilt from the text blocks in a clean one-column layout (name, headings, bullets, right-aligned dates).
// docx, pdf-lib and fontkit (most of the weight) load only on the paths that need them.
import { writeDocx } from "./docx.js";
import { detectSections } from "./match.js";
import { effects } from "./fx.js";
import { MIME } from "./files.js";

const LETTER = { w: 612, h: 792 };
const BULLET_LEAD = /^\s*[•·▪◦‣●■◆➢✓*–-]\s*/u;

/** buildOutput(doc, marks, styles, format 'pdf'|'docx') → { blob, fallback (PDF words underlined instead of bold), rebuilt } */
export async function buildOutput(doc, marks, styles, format) {
  if (format === doc.kind) {
    return doc.kind === "pdf" ? { ...(await (await import("./pdf-write.js")).writePdf(doc, marks, styles)), rebuilt: false }
      : { blob: await writeDocx(doc, marks, styles), fallback: 0, rebuilt: false };
  }
  const items = toItems(doc, marks, styles);
  const page = pageSize(doc);
  const blob = format === "pdf" ? await itemsToPdf(items, styles, page) : await itemsToDocx(items, styles, page);
  return { blob, fallback: 0, rebuilt: true };
}

function pageSize(doc) {
  const v = doc.kind === "pdf" ? doc.pages[0]?.view : null;
  if (v) return { w: Math.abs(v[2] - v[0]), h: Math.abs(v[3] - v[1]) };
  return doc.page || LETTER;
}

// Links: the file's own (Word hyperlinks, PDF link areas) and typed addresses, as PDF viewers link those. Only web, mail and
// phone addresses are written (no javascript:, file: or local paths), at most 2,000 characters.
const safeUrl = (u) => { try { const x = new URL(u); return /^(https?|mailto|tel):$/.test(x.protocol) && x.href.length <= 2000 ? x.href : null; } catch { return null; } };
const TYPED = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+|\b(?:https?:\/\/|www\.)[^\s<>"()]+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|dev|me|co|ai|app|ph|uk|ca|au|de|eu|in|sg)\b(?:\/[^\s<>"()]*)?/g;
export function urlsOf(b) {
  const u = new Array(b.text.length).fill(null);
  for (const [s, e, href] of b.links || []) { const h = safeUrl(href); if (h) u.fill(h, s, e); }
  for (const m of b.text.matchAll(TYPED)) {
    const t = m[0].replace(/[.,;:!?'"\]]+$/, ""), s = m.index, e = s + t.length;
    const href = /^https?:/i.test(t) ? t : /^www\./i.test(t) || !t.includes("@") ? "https://" + t : "mailto:" + t;
    if (!u.slice(s, e).some(Boolean)) u.fill(safeUrl(href), s, e); // the file's own link wins
  }
  return u;
}

// A PDF's page furniture: in one flowing rebuild, page numbers and the running header and footer of every page would land
// mid-text. Only lines near the top or bottom edge count: page numbers go, and a line that another page has at the same height
// and size (its page number aside) is kept once, a header first, a footer last. A line seen once (page 2's own first line) stays.
const PAGE_NO = /^[-–—(\s]*(?:(?:page|pg|p|página|pagina|seite)\.?\s*)?#(?:\s*(?:of|de|von|di|sur|\/|\|)\s*#)?[-–—)\s]*$/u;
export function furniture(doc) {
  const skip = new Set();
  if (doc.kind !== "pdf") return skip;
  const groups = new Map();
  doc.blocks.forEach((b, i) => {
    const p = doc.pages[b.page], [, v0, , v1] = p.view, band = 0.12 * (v1 - v0);
    let hi = -Infinity, lo = Infinity;
    for (const g of b.gmap) if (g >= 0) { hi = Math.max(hi, p.glyphs[g].y0); lo = Math.min(lo, p.glyphs[g].y0); }
    const edge = v1 - hi < band ? "top" : lo - v0 < band ? "bottom" : null;
    if (!edge) return;
    const key = b.text.toLowerCase().replace(/\d+/g, (d) => (+d === b.page + 1 || +d === doc.pages.length ? "#" : d)).replace(/\s+/g, " ").trim();
    if (PAGE_NO.test(key)) { skip.add(i); return; }
    const k = edge + "\n" + key;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push({ i, page: b.page, at: edge === "top" ? v1 - hi : lo - v0, size: b.size });
  });
  for (const [k, list] of groups) {
    const rep = list.filter((a) => list.some((o) => o.page !== a.page && Math.abs(o.at - a.at) <= 3 && Math.abs(o.size - a.size) <= 0.6));
    const keep = k.startsWith("top") ? rep[0] : rep[rep.length - 1];
    for (const a of rep) if (a !== keep) skip.add(a.i);
  }
  return skip;
}

/** Blocks → [{ role: name|heading|bullet|para, left: [{t, e, u}], right: [{t, e, u}] | null }], e = FX bits (1 bold, 2 underline, 4 highlight), u = link */
function toItems(doc, marks, styles) {
  const eff = effects(doc.blocks, marks, styles);
  const secs = detectSections(doc.blocks);
  const skip = furniture(doc);
  let named = false, lead = 0;
  const items = [];
  // a Word file's page header goes first and its footer last (see readDocx); they are not matched, so nothing in them is marked
  const parts = [...(doc.head || []).map((b) => [b, -1, true]), ...doc.blocks.map((b, i) => [b, i]), ...(doc.foot || []).map((b) => [b, -1])];
  parts.forEach(([b, i, head]) => {
    const text = b.text;
    if (!text.trim() || skip.has(i)) return;
    const e = eff.get(i) || new Uint8Array(text.length);
    // original bold survives a rebuild: from a PDF glyph by glyph, from Word by its runs' direct bold
    const url = urlsOf(b);
    const bold = (c) => (doc.kind === "pdf" ? b.gmap[c] >= 0 && doc.pages[b.page].glyphs[b.gmap[c]].bold : b.bold?.some(([x, z]) => c >= x && c < z)) ? 1 : 0;
    const words = text.trim().split("\t")[0].trim().split(/\s+/).length; // the left column: contact details beside a name do not make it long
    const role = !named && words <= 5 && items.length === lead ? "name" // the first short line, a header's contact line aside
      : b.kind === "heading" || secs[i]?.heading ? "heading" : b.kind === "bullet" || BULLET_LEAD.test(text) ? "bullet" : "para";
    if (role === "name") named = true;
    let from = role === "bullet" ? (text.match(BULLET_LEAD)?.[0].length || 0) : 0;
    const tab = text.indexOf("\t", from), lastTab = text.lastIndexOf("\t");
    const segs = (a, z) => {
      const out = [];
      for (let c = a; c < z; c++) {
        // a middle column ("Google⇥Mountain View⇥2016") joins the left one; a run of tabs is one separator
        const ch = text[c] !== "\t" ? text[c] : c > a && !/\s/.test(text[c - 1]) ? " · " : "", f = e[c] | bold(c), u = url[c];
        const last = out[out.length - 1];
        if (last && last.e === f && last.u === u) last.t += ch; else out.push({ t: ch, e: f, u });
      }
      return out;
    };
    let end = tab >= 0 ? lastTab : text.length;
    while (end > from && /\s/.test(text[end - 1])) end--;
    items.push({ role, left: segs(from, end), right: tab >= 0 ? segs(lastTab + 1, text.length) : null });
    if (head) lead++;
  });
  return items;
}

// a dated line after bullets starts the next entry (a job, a degree), so both rebuilds leave a gap before it
const opensEntry = (items, i) => !!items[i].right && items[i - 1]?.role === "bullet";
const hex = (c) => (c || "#fff59d").replace(/^#/, "").toUpperCase();

async function itemsToDocx(items, styles, page) {
  const { AlignmentType, BorderStyle, Document, ExternalHyperlink, LevelFormat, Packer, Paragraph, ShadingType, Tab, TabStopType, TextRun } = await import("docx");
  const tw = (pt) => Math.round(pt * 20);
  const margin = 54, right = tw(page.w - 2 * margin);
  const fill = hex(styles.color);
  // a link keeps the text's own look: underline and colour already say "matches the job" here
  const runs = (segs, size, extra = {}) => segs.map(({ t, e, u }) => {
    const run = new TextRun({
      text: t, size, ...extra, bold: !!(e & 1) || extra.bold || undefined,
      underline: e & 2 ? { type: "single" } : undefined,
      shading: e & 4 ? { type: ShadingType.CLEAR, color: "auto", fill } : undefined,
    });
    return u ? new ExternalHyperlink({ link: u, children: [run] }) : run;
  });
  const paras = items.map((it, i) => {
    const base = it.role === "name" ? { size: 40, bold: true } : it.role === "heading" ? { size: 23, bold: true, color: "1F3A5F" } : { size: 21 };
    const children = runs(it.left, base.size, base);
    // contact details beside the name keep the body's size
    if (it.right) children.push(new TextRun({ children: [new Tab()], size: base.size }), ...runs(it.right, it.role === "name" ? 21 : base.size, { color: "555555" }));
    return new Paragraph({
      children,
      tabStops: it.right ? [{ type: TabStopType.RIGHT, position: right }] : undefined,
      numbering: it.role === "bullet" ? { reference: "dots", level: 0 } : undefined,
      spacing: it.role === "heading" ? { before: 240, after: 80 } : it.role === "bullet" ? { after: 40 } : { before: opensEntry(items, i) ? 120 : undefined, after: 80 },
      border: it.role === "heading" ? { bottom: { style: BorderStyle.SINGLE, size: 6, color: "9DB3CC", space: 2 } } : undefined,
    });
  });
  // no author fields (docx would write "Un-named"): the file goes to an employer, so it says nothing about how it was made
  const doc = new Document({
    creator: "", lastModifiedBy: "",
    styles: { default: { document: { run: { font: "Calibri", size: 21 }, paragraph: { spacing: { line: 264 } } } } },
    numbering: { config: [{ reference: "dots", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: 360, hanging: 240 } } } }] }] },
    sections: [{ properties: { page: { size: { width: tw(page.w), height: tw(page.h) },
      margin: { top: tw(margin), bottom: tw(margin), left: tw(margin), right: tw(margin) } } }, children: paras }],
  });
  return new Blob([await Packer.toBlob(doc)], { type: MIME.docx });
}

let fontBytes = null;
const fonts = () => (fontBytes ||= Promise.all(["LiberationSans-Regular.ttf", "LiberationSans-Bold.ttf"].map(async (f) => {
  const res = await fetch(new URL("pdfjs/standard_fonts/" + f, document.baseURI));
  if (!res.ok) throw new Error(`Font ${f} is missing (HTTP ${res.status}).`);
  return res.arrayBuffer();
})).catch((e) => { fontBytes = null; throw e; }));

async function itemsToPdf(items, styles, page) {
  const [{ PDFDocument, PDFHexString, rgb }, { default: fontkit }] = await Promise.all([import("pdf-lib"), import("@pdf-lib/fontkit")]);
  const pdf = await PDFDocument.create({ updateMetadata: false }); // no producer or creator naming a tool (see the Word file above)
  pdf.registerFontkit(fontkit);
  const [regBytes, boldBytes] = await fonts();
  const reg = await pdf.embedFont(regBytes, { subset: true }), bold = await pdf.embedFont(boldBytes, { subset: true });
  // a run the font has no glyphs for (emoji, ★, ₱, Chinese; pdf.js ships a 669-character Liberation, same in bold) would draw as boxes:
  // the browser draws it with its own fonts instead, embedded as a picture 48 px high
  // shortcut: a picture is not text, so copying it out of the PDF (or an ATS reading it) gets nothing; embed a fuller font if CVs in other scripts matter
  const has = new Set(reg.getCharacterSet()), graphemes = new Intl.Segmenter("en", { granularity: "grapheme" }), pictures = new Map();
  const picture = (t, b, c) => {
    const css = `rgb(${c.red * 255} ${c.green * 255} ${c.blue * 255})`, font = `${b ? "bold " : ""}48px Arial, "Liberation Sans", sans-serif`, k = font + css + t;
    if (!pictures.has(k)) pictures.set(k, (async () => {
      const m = new OffscreenCanvas(1, 1).getContext("2d");
      m.font = font;
      const w = Math.max(1, Math.ceil(m.measureText(t).width)), cv = new OffscreenCanvas(w, 56), g = cv.getContext("2d");
      g.font = font; g.fillStyle = css; g.fillText(t, 0, 44); // 12 px below the baseline: drawn from y - size / 4, size * 7 / 6 high
      return { img: await pdf.embedPng(await (await cv.convertToBlob()).arrayBuffer()), w: w / 48 };
    })());
    return pictures.get(k);
  };
  // segments → the same, with each run the font cannot draw cut out as { pic: { img, w (em) } }; icon-font codes (private use) are dropped
  const split = async (segs, fb, color) => {
    const out = [];
    for (const s of segs) for (const { segment: g } of graphemes.segment(s.t.normalize("NFC"))) {
      if (/[\ue000-\uf8ff]/u.test(g)) continue;
      const pic = ![...g].every((ch) => has.has(ch.codePointAt(0))), last = out[out.length - 1];
      if (last && last.e === s.e && last.u === s.u && !!last.pic === pic) last.t += g; else out.push({ ...s, t: g, pic });
    }
    for (const p of out) if (p.pic) p.pic = await picture(p.t, p.e & 1 || fb, color);
    return out;
  };
  const M = 54, W = page.w - 2 * M, ink = rgb(0.13, 0.13, 0.13), accent = rgb(0.12, 0.23, 0.37), muted = rgb(0.33, 0.33, 0.33);
  const c = parseInt(hex(styles.color), 16), hl = rgb((c >> 16) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255);
  let pg = pdf.addPage([page.w, page.h]), y = page.h - M;
  const fontOf = (e, forceBold) => (e & 1 || forceBold ? bold : reg);
  const width = (pieces, size, fb) => pieces.reduce((s, p) => s + (p.pic ? p.pic.w * size : fontOf(p.e, fb).widthOfTextAtSize(p.t, size)), 0);

  // segments → words (pieces of equal effect, trailing spaces attached), so lines break only at spaces
  const wordsOf = (segs) => {
    const words = [];
    let cur = [];
    for (const s of segs) for (const part of s.t.split(/(?<=\s)(?=\S)/u)) {
      cur.push({ ...s, t: part });
      if (/\s$/u.test(part)) { words.push(cur); cur = []; }
    }
    if (cur.length) words.push(cur);
    return words;
  };
  const drawLine = (pieces, x, size, fb, color) => {
    const trimmed = pieces.map((p) => ({ ...p }));
    while (trimmed.length && !trimmed[trimmed.length - 1].t.trim()) trimmed.pop();
    if (trimmed.length) trimmed[trimmed.length - 1].t = trimmed[trimmed.length - 1].t.trimEnd();
    let cx = x;
    const placed = trimmed.map((p) => { const w = width([p], size, fb); const r = { ...p, x: cx, w }; cx += w; return r; });
    for (const p of placed) if (p.e & 4) pg.drawRectangle({ x: p.x - 0.5, y: y - 0.24 * size, width: p.w + 1, height: 1.14 * size, color: hl });
    for (const p of placed) {
      if (p.pic) pg.drawImage(p.pic.img, { x: p.x, y: y - size / 4, width: p.w, height: (size * 7) / 6 });
      else pg.drawText(p.t, { x: p.x, y, size, font: fontOf(p.e, fb), color });
    }
    for (const p of placed) if (p.e & 2) pg.drawRectangle({ x: p.x, y: y - 0.14 * size, width: p.w, height: Math.max(0.5, 0.06 * size), color });
    // one clickable area per run of pieces with the same address; the address goes in as hex, so no character needs escaping
    let run = null;
    const area = () => run && pg.node.addAnnot(pdf.context.register(pdf.context.obj({
      Type: "Annot", Subtype: "Link", Rect: [run.x0, y - 0.24 * size, run.x1, y + 0.9 * size], Border: [0, 0, 0],
      A: { Type: "Action", S: "URI", URI: PDFHexString.of(Array.from(run.u, (ch) => ch.charCodeAt(0).toString(16).padStart(2, "0")).join("")) },
    })));
    for (const p of placed) {
      if (p.u && run?.u === p.u) run.x1 = p.x + p.w;
      else { area(); run = p.u ? { u: p.u, x0: p.x, x1: p.x + p.w } : null; }
    }
    area();
  };
  const need = (h) => { if (y - h < M) { pg = pdf.addPage([page.w, page.h]); y = page.h - M; } };

  for (const [i, it] of items.entries()) {
    const size = it.role === "name" ? 20 : it.role === "heading" ? 11.5 : 10.5, fb = it.role === "name" || it.role === "heading";
    const color = it.role === "heading" ? accent : ink, lh = size * 1.32;
    const indent = it.role === "bullet" ? 14 : 0;
    const left = await split(it.left, fb, color), right = it.right && (await split(it.right, false, muted));
    const rs = it.role === "name" ? 10.5 : size, rightW = right ? width(right, rs, false) + 10 : 0; // contact details beside the name: body size
    if (it.role === "heading") y -= 9;
    else if (opensEntry(items, i)) y -= 6;
    const lines = [];
    let line = [], lw = 0;
    for (const w of wordsOf(left)) {
      const ww = width(w, size, fb), max = W - indent - (lines.length ? 0 : rightW);
      if (line.length && lw + width([{ ...w[w.length - 1], t: w[w.length - 1].t.trimEnd() }, ...w.slice(0, -1)], size, fb) > max) {
        lines.push(line); line = []; lw = 0;
      }
      line.push(...w); lw += ww;
    }
    if (line.length || !lines.length) lines.push(line);
    lines.forEach((ln, k) => {
      need(lh);
      y -= size;
      if (k === 0 && it.role === "bullet") pg.drawText("•", { x: M + 3, y, size, font: reg, color: ink });
      drawLine(ln, M + indent, size, fb, color);
      if (k === 0 && right) drawLine(right, M + W - width(right, rs, false), rs, false, muted);
      y -= lh - size;
    });
    if (it.role === "heading") { pg.drawRectangle({ x: M, y: y + 1, width: W, height: 0.6, color: rgb(0.62, 0.7, 0.8) }); y -= 4; }
    else y -= it.role === "bullet" ? 1.5 : it.role === "name" ? 2 : 4;
  }
  return new Blob([await pdf.save()], { type: MIME.pdf });
}
