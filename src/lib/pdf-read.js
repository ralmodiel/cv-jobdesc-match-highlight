// PDF → text blocks with glyph geometry. pdf.js parses the file; this module replays its operator list to learn where
// every glyph sits (the same maths as pdf.js's canvas renderer), then groups glyphs into lines and lines into paragraphs.
import { getDocument, GlobalWorkerOptions, OPS, AnnotationMode } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?worker&url"; // bundled, so the stream cap in vite.config.js applies
import { InputError, LIMITS } from "./files.js";

GlobalWorkerOptions.workerSrc = workerUrl;
const asset = (p) => new URL(p, document.baseURI).href;

/** Open bytes with pdf.js, everything served from this origin (fonts, CMaps, image decoders). Reading needs no
 *  images, so it skips them; drawing leaves out any image over LIMITS.imagePx, which can take gigabytes to decode. */
// shortcut: a left-out image is just missing from the preview (the download keeps it); say so there if real CVs hit it.
export function openPdf(bytes, images = true) {
  return getDocument({
    data: bytes.slice(), // pdf.js transfers the buffer to its worker
    maxImageSize: images ? LIMITS.imagePx : 0, // the size the PDF states; vite.config.js caps the size inside the image too
    // images past 16 Mpx (Preview.jsx's PAGE_PX, iOS's canvas limit) are shrunk as they decode; without a number pdf.js
    // finds the browser's limit by trying canvases of up to 1 GB, which a large image's header sets off
    canvasMaxAreaInBytes: 4 * 16e6,
    isEvalSupported: false,
    fontExtraProperties: true,
    standardFontDataUrl: asset("pdfjs/standard_fonts/"),
    cMapUrl: asset("pdfjs/cmaps/"),
    cMapPacked: true,
    wasmUrl: asset("pdfjs/wasm/"),
    enableXfa: false,
    useSystemFonts: false,
  }).promise.catch((e) => {
    if (e?.name === "PasswordException") throw new InputError("This PDF is password-protected. Save a copy without the password, then add it again.");
    if (e?.name === "InvalidPDFException") throw new InputError("This PDF looks damaged and could not be opened. Try exporting it again.");
    throw e;
  });
}

const I = [1, 0, 0, 1, 0, 0];
const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const BOLD_NAME = /bold|black|heavy|semibold|demibold|extrabold/i;
const FILLS = new Set([OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);

async function fontsOf(page, fnArray, argsArray) {
  const ids = new Set();
  fnArray.forEach((fn, i) => {
    if (fn === OPS.setFont) ids.add(argsArray[i][0]);
    if (fn === OPS.setGState) for (const [k, v] of argsArray[i][0]) if (k === "Font") ids.add(v[0]);
  });
  const fonts = new Map();
  await Promise.all([...ids].map((id) => Promise.race([
    new Promise((res) => page.commonObjs.get(id, res)),
    new Promise((res) => setTimeout(res, 8000, null)),
  ]).then((f) => fonts.set(id, f))));
  return fonts;
}

/**
 * Replay one page's operators → { glyphs, ops, dots }.
 *  glyphs: [{ ch, x0, y0 (baseline start), x1, y1 (baseline end), ux, uy (up vector, length = size), asc, desc,
 *             op, gi, fill, bold, type3, mode, ts, skip }] in content order
 *  ops: per page-level showText (outside form XObjects): { codes: char codes, first: index of its first glyph }
 *  dots: small filled shapes { x0, x1, cy, s } (page space), i.e. bullets drawn as graphics (Chrome and most web CV builders)
 */
function replay(fnArray, argsArray, fonts) {
  let st = { ctm: I, font: null, size: 0, dir: 1, tc: 0, tw: 0, th: 1, tl: 0, rise: 0, mode: 0, fill: "#000000", tm: null, x: 0, y: 0, lx: 0, ly: 0 };
  const stack = [], glyphs = [], ops = [], dots = [];
  let form = 0;
  const setFont = (id, size) => { st.font = fonts.get(id) || null; st.dir = size < 0 ? -1 : 1; st.size = Math.abs(size); };
  const move = (x, y) => { st.x = st.lx += x; st.y = st.ly += y; };
  for (let i = 0; i < fnArray.length; i++) {
    const a = argsArray[i];
    switch (fnArray[i]) {
      case OPS.save: stack.push({ ...st }); break;
      case OPS.restore: if (stack.length) st = stack.pop(); break;
      case OPS.transform: st.ctm = mul(st.ctm, a); break;
      case OPS.paintFormXObjectBegin: stack.push({ ...st }); form++; if (a[0]) st.ctm = mul(st.ctm, Array.from(a[0])); break;
      case OPS.paintFormXObjectEnd: if (stack.length) st = stack.pop(); form = Math.max(0, form - 1); break;
      case OPS.beginText: st.tm = null; st.x = st.lx = st.y = st.ly = 0; break;
      case OPS.setCharSpacing: st.tc = a[0]; break;
      case OPS.setWordSpacing: st.tw = a[0]; break;
      case OPS.setHScale: st.th = a[0] / 100; break;
      case OPS.setLeading: st.tl = -a[0]; break;
      case OPS.setFont: setFont(a[0], a[1]); break;
      case OPS.setGState: for (const [k, v] of a[0]) if (k === "Font") setFont(v[0], v[1]); break;
      case OPS.setTextRenderingMode: st.mode = a[0]; break;
      case OPS.setTextRise: st.rise = a[0]; break;
      case OPS.moveText: move(a[0], a[1]); break;
      case OPS.setLeadingMoveText: st.tl = a[1]; move(a[0], a[1]); break;
      case OPS.setTextMatrix: st.tm = a.length === 1 ? Array.from(a[0]) : a.slice(0, 6); st.x = st.lx = st.y = st.ly = 0; break;
      case OPS.nextLine: move(0, st.tl); break;
      case OPS.setFillRGBColor: st.fill = a[0]; break;
      case OPS.setFillColorN: st.fill = null; break; // pattern or shading fill
      case OPS.constructPath: {
        const mm = a[2];
        if (!mm || !FILLS.has(a[0]) || st.fill === "#ffffff") break;
        const c = [apply(st.ctm, mm[0], mm[1]), apply(st.ctm, mm[2], mm[1]), apply(st.ctm, mm[0], mm[3]), apply(st.ctm, mm[2], mm[3])];
        const x0 = Math.min(...c.map((q) => q[0])), x1 = Math.max(...c.map((q) => q[0]));
        const y0 = Math.min(...c.map((q) => q[1])), y1 = Math.max(...c.map((q) => q[1])), w = x1 - x0, h = y1 - y0;
        if (w > 0.8 && h > 0.8 && w < 12 && h < 12 && w < 2 * h && h < 2 * w) dots.push({ x0, x1, cy: (y0 + y1) / 2, s: Math.max(w, h) });
        break;
      }
      case OPS.showText: {
        const f = st.font, fm = f?.fontMatrix || [0.001, 0, 0, 0.001, 0, 0], vertical = !!f?.vertical;
        const tm = st.tm || I, M = mul(st.ctm, tm), hs = st.th * st.dir, fs = st.size;
        const bold = !!(f?.bold || BOLD_NAME.test(f?.name || "")), type3 = !!f?.isType3Font;
        const asc = f?.ascent > 0.3 && f.ascent < 1.5 ? f.ascent : 0.8, desc = f?.descent < 0 && f.descent > -0.6 ? f.descent : -0.2;
        const ux = M[2] * fs, uy = M[3] * fs, ts = fs * Math.hypot(tm[2], tm[3]);
        const op = form ? -1 : ops.length, codes = [], first = glyphs.length;
        let x = 0, gi = 0;
        for (const g of a[0]) {
          if (typeof g === "number") { x += ((vertical ? 1 : -1) * g * fs) / 1000; continue; }
          const spacing = ((g.isSpace ? st.tw : 0) + st.tc) * st.dir;
          const w = g.width * fs * fm[0];
          const tx = st.x + x * hs, ty = st.y + st.rise;
          const [x0, y0] = apply(M, tx, ty), [x1, y1] = apply(M, tx + w * hs, ty);
          // a soft hyphen the page paints is a hyphen (LuaTeX maps its hyphen glyph to U+00AD: "cross-cluster", "2023 - 2024")
          let ch = (g.unicode || "").normalize("NFKC").replace(/\u00ad/g, w > 0 ? "-" : "").replace(/[\u0000-\u001f\u007f\u200b-\u200d\ufeff]/g, "");
          // one glyph that spells a name ("HOUSE-CHIMNEY", "GITHUB-SQUARE"): an icon font whose text is its glyph names, not text
          if (/^[A-Za-z][A-Za-z0-9-]{3,}$/.test(ch)) ch = "";
          // Ghostscript writes some kerning as a space whose advance word spacing cancels ("Dev eloper"): not a word break
          if (ch === " " && w + spacing < 0.08 * fs) ch = "";
          glyphs.push({ ch, x0, y0, x1, y1, ux, uy, asc, desc, op, gi: gi++, fill: st.fill, bold, type3, mode: st.mode, ts, skip: vertical || !f || fs === 0 });
          codes.push(g.originalCharCode);
          x += vertical ? w - spacing : w + spacing;
        }
        if (vertical) st.y -= x; else st.x += x * hs;
        if (op >= 0) ops.push({ codes, first });
        break;
      }
    }
  }
  return { glyphs, ops, dots };
}

const BULLET = /^[•‣⁃∙▪▫●○◦■□◆◇►▸➢✓✔·*–—-](?=\s|$)|^[-]/u;

// "Languages: …", "Civil Status: Single": a line led by a short label is a line of its own, not a wrapped one
const LABEL = /^\p{Lu}[\p{L}\p{N}&/+#.' -]{0,28}:\s/u;

/** Glyphs → lines in content order: { glyphs, text, gmap, size, bold, left, right, base, flat } */
function toLines(glyphs) {
  const lines = [];
  // a page that paints no spaces positions every word (TeX), and justifying shrinks those gaps to 0.13 em in some fonts
  const ink = glyphs.filter((g) => g.ch.trim()).length, minGap = glyphs.filter((g) => g.ch === " ").length < 0.02 * ink ? 0.11 : 0.18;
  let L = null;
  const close = () => {
    if (!L) return;
    const only = (keep) => { for (const k of ["chars", "gm", "gaps"]) L[k] = L[k].filter((_, i) => keep[i]); };
    // icon-font pictures (FontAwesome & co., in the private-use area) are not text; a lone one leading the line is a bullet (Symbol, Wingdings)
    const pua = L.chars.map((c) => /[\ue000-\uf8ff]/u.test(c)), icons = pua.filter(Boolean).length;
    if (icons > 1 || (icons === 1 && !pua[L.chars.findIndex((c) => /\S/u.test(c))])) only(pua.map((p) => !p));
    // letter-spaced headings ("E X P E R I E N C E", "E D U C AT I O N" with a kerned pair): keep only the gaps clearly wider than the letter spacing
    const toks = L.chars.join("").split(" ");
    if (toks.length >= 4 && toks.every((t) => /^[\p{L}\p{N}&]{1,3}$/u.test(t)) && toks.filter((t) => t.length === 1).length >= 0.7 * toks.length) {
      const gaps = L.gaps.filter((g) => g != null).sort((a, b) => a - b), med = gaps[gaps.length >> 1];
      only(L.chars.map((c, i) => L.gaps[i] == null || L.gaps[i] > med * 1.8));
    }
    const text = L.chars.join("");
    if (text.trim()) {
      const sizes = L.idx.map((i) => Math.hypot(glyphs[i].ux, glyphs[i].uy)).sort((a, b) => a - b);
      const g0 = glyphs[L.idx[0]], gN = glyphs[L.idx[L.idx.length - 1]];
      const boldN = L.idx.filter((i) => glyphs[i].bold && glyphs[i].ch.trim()).length;
      const inkN = L.idx.filter((i) => glyphs[i].ch.trim()).length;
      lines.push({ idx: L.idx, text, gmap: L.gm, size: sizes[sizes.length >> 1], bold: boldN > inkN / 2,
        left: g0.x0, right: gN.x1, base: g0.y0, flat: Math.abs(L.by) < 0.02 && L.bx > 0 });
    }
    L = null;
  };
  glyphs.forEach((g, gi) => {
    const size = Math.hypot(g.ux, g.uy);
    if (g.skip || size < 1) return;
    const bl = Math.hypot(g.x1 - g.x0, g.y1 - g.y0);
    const bx = bl > 1e-6 ? (g.x1 - g.x0) / bl : g.uy / size, by = bl > 1e-6 ? (g.y1 - g.y0) / bl : -g.ux / size;
    if (L) {
      const dx = g.x0 - L.px, dy = g.y0 - L.py;
      const s = dx * L.bx + dy * L.by, t = -dx * L.by + dy * L.bx;
      const sameDir = bx * L.bx + by * L.by > 0.9994; // within 2°
      if (!sameDir || Math.abs(t - L.t) > 0.5 * L.size || s < L.end - 0.5 * L.size) close();
      else {
        const gap = s - L.end;
        const prev = L.chars[L.chars.length - 1];
        if (gap > 2 * L.size && prev !== "\t") { L.chars.push("\t"); L.gm.push(-1); L.gaps.push(null); }
        else if (gap > minGap * L.size && !/\s$/.test(prev) && !/^\s/.test(g.ch)) { L.chars.push(" "); L.gm.push(-1); L.gaps.push(gap); }
      }
    }
    if (!L) L = { idx: [], chars: [], gm: [], gaps: [], px: g.x0, py: g.y0, bx, by, t: 0, size, end: 0 };
    const dx = g.x1 - L.px, dy = g.y1 - L.py;
    L.end = Math.max(L.end, dx * L.bx + dy * L.by);
    L.idx.push(gi);
    g.line = lines.length; // index the line will get when closed
    // by UTF-16 unit, as text offsets count (an emoji is two), or every mark after it lands a letter off
    for (const c of g.ch.split("")) { L.chars.push(c); L.gm.push(gi); L.gaps.push(null); }
  });
  close();
  // drop leading/trailing synthetic whitespace
  for (const ln of lines) {
    let a = 0, b = ln.text.length;
    while (a < b && ln.gmap[a] < 0) a++;
    while (b > a && ln.gmap[b - 1] < 0) b--;
    ln.text = ln.text.slice(a, b);
    ln.gmap = ln.gmap.slice(a, b);
    const k = ln.text.search(/\s/), g = k > 0 ? ln.gmap[k - 1] : -1;
    ln.w1 = g >= 0 ? glyphs[g].x1 - ln.left : ln.right - ln.left; // width of the first word
  }
  return lines;
}

const isHeadingLine = (ln, body) => {
  const t = ln.text.trim(), words = t.split(/\s+/).length;
  if (ln.size >= body * 1.2) return true;
  return words <= 5 && /\p{Lu}.*\p{Lu}/u.test(t) && t === t.toUpperCase() && !/[.,;]$/.test(t) && !BULLET.test(t);
};

/** Lines (all pages) → blocks: { id, text, kind, page, gmap: Int32Array (glyph index or -1), size, bold } */
function toBlocks(pages) {
  const hist = new Map();
  for (const p of pages) for (const ln of p.lines) {
    const k = Math.round(ln.size * 2) / 2;
    hist.set(k, (hist.get(k) || 0) + ln.text.length);
  }
  const body = [...hist].sort((a, b) => b[1] - a[1])[0]?.[0] || 10;
  const blocks = [];
  pages.forEach((p, pi) => {
    let B = null;
    const flush = () => { if (B) blocks.push(B); B = null; };
    // a graphic bullet sits just left of the line, around x-height
    const dotted = (ln) => ln.flat && p.dots.some((d) => d.s >= 0.12 * ln.size && d.s <= 0.65 * ln.size &&
      d.x1 <= ln.left - 0.1 * ln.size && d.x1 >= ln.left - 2.2 * ln.size && d.cy > ln.base && d.cy < ln.base + 0.8 * ln.size);
    for (const ln of p.lines) {
      const head = isHeadingLine(ln, body), dot = !BULLET.test(ln.text) && dotted(ln), bullet = dot || BULLET.test(ln.text);
      const P = B?.last, drop = P && P.base - ln.base;
      const joinable = B && P.flat && ln.flat && !head && !B.head && !bullet && !LABEL.test(ln.text) && !/\t/.test(P.text + ln.text) &&
        Math.abs(ln.size - P.size) <= 0.15 * P.size && ln.bold === P.bold && drop > 0 && drop <= 1.6 * P.size &&
        (B.drop == null || drop <= B.drop * 1.1 + 0.3) && // a bigger gap than the paragraph's own line pitch starts a new one
        // the previous line ended short although this line's first word would have fitted: it ended a paragraph
        P.right + 0.3 * P.size + ln.w1 > Math.max(B.right, ln.right) - 0.5 * P.size &&
        (B.n === 1 ? ln.left - P.left >= -2.5 * P.size && ln.left - P.left <= 3 * P.size : Math.abs(ln.left - P.left) <= 0.6 * P.size);
      if (!joinable) {
        flush();
        B = { id: `p${pi + 1}-${blocks.length}`, text: dot ? "• " : "", gm: dot ? [-1, -1] : [], kind: bullet ? "bullet" : head ? "heading" : "para",
          page: pi, size: ln.size, bold: ln.bold, head, n: 0, last: ln, right: ln.right, drop: null };
      } else if (/\p{Ll}-$/u.test(B.text) && /^\p{Ll}/u.test(ln.text)) {
        B.text = B.text.slice(0, -1); B.gm.pop(); // soft line-break hyphen: "migra-" + "tion"
      } else { B.text += " "; B.gm.push(-1); }
      const t = B.n === 0 && /^[-]/u.test(ln.text) ? "•" + ln.text.slice(1) : ln.text;
      B.text += t;
      B.gm.push(...ln.gmap);
      if (B.n === 1) B.drop = drop;
      B.n++;
      B.last = ln;
      B.right = Math.max(B.right, ln.right);
    }
    flush();
  });
  return blocks.map(({ id, text, gm, kind, page, size, bold }) => ({ id, text, kind, page, size, bold, gmap: Int32Array.from(gm) }));
}

// A link's areas (one per line when it wraps, else its rectangle), in the page space the glyphs are in. pdf.js gives
// the address only for web, mail, phone and ftp links; the rebuild allows fewer (convert.js).
const linkAreas = (annots) => annots.filter((a) => a.subtype === "Link" && a.url).map((a) => {
  const q = a.quadPoints, boxes = [];
  for (let i = 0; q && i + 7 < q.length; i += 8) boxes.push([q[i], q[i + 5], q[i + 2], q[i + 1]]); // normalised: minX, maxY, maxX, maxY, minX, minY, …
  return { url: a.url, boxes: boxes.length ? boxes : [a.rect] };
});

/** A block's links as [start, end, address]: the characters whose glyph sits inside a link's area (spaces between two of them join). */
function linkSpans(b, page) {
  const out = [];
  if (!page.links.length) return out;
  for (let i = 0; i < b.text.length; i++) {
    const G = b.gmap[i] >= 0 && page.glyphs[b.gmap[i]];
    if (!G || !b.text[i].trim()) continue;
    const x = (G.x0 + G.x1) / 2 + 0.3 * G.ux, y = (G.y0 + G.y1) / 2 + 0.3 * G.uy; // mid-glyph, 0.3 em above the baseline
    const u = page.links.find((l) => l.boxes.some(([x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1))?.url;
    if (!u) continue;
    const last = out[out.length - 1];
    if (last && last[2] === u && !b.text.slice(last[1], i).trim()) last[1] = i + 1;
    else out.push([i, i + 1, u]);
  }
  return out;
}

/** readPdf(ArrayBuffer) → { kind:'pdf', bytes, blocks, pages: [{ glyphs, ops, view }] } */
export async function readPdf(buf) {
  const bytes = new Uint8Array(buf.slice(0));
  const pdf = await openPdf(bytes, false);
  try {
    if (pdf.numPages > LIMITS.pages) throw new InputError(`This PDF has ${pdf.numPages} pages; CVs up to ${LIMITS.pages} pages are supported.`);
    const pages = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const { fnArray, argsArray } = await page.getOperatorList({ annotationMode: AnnotationMode.DISABLE });
      const { glyphs, ops, dots } = replay(fnArray, argsArray, await fontsOf(page, fnArray, argsArray));
      pages.push({ glyphs, ops, view: page.view, lines: toLines(glyphs), dots, links: linkAreas(await page.getAnnotations().catch(() => [])) }); // a broken link never stops the read
      page.cleanup();
    }
    const blocks = toBlocks(pages);
    if (!blocks.some((b) => /\p{L}{2}/u.test(b.text))) {
      throw new InputError("This PDF has no selectable text, so it is probably a scan or an image. Export your CV from Word or Google Docs as PDF or .docx and add that instead. If you only have a scan, retype it or run it through a text-recognition (OCR) tool first.");
    }
    for (const b of blocks) b.links = linkSpans(b, pages[b.page]);
    for (const p of pages) { delete p.lines; delete p.dots; delete p.links; }
    return { kind: "pdf", bytes, blocks, pages };
  } finally {
    pdf.loadingTask.destroy();
  }
}
