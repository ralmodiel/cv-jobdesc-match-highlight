// Emphasis written into the original PDF. Highlights and underlines are drawn over the page. Bold re-renders the
// matched glyphs with fill + stroke (text render mode 2) inside the page's own content stream, so text stays text.
// The stream is only rewritten where its show-text operators line up exactly with what pdf.js read (same count,
// same character codes); anywhere else bold falls back to an underline and the caller is told how often.
import { PDFDocument, PDFName, PDFArray, PDFNumber, PDFRawStream, PDFRef, EncryptedPDFError, decodePDFRawStream } from "pdf-lib";
import { InputError, MIME } from "./files.js";
import { effects } from "./fx.js";

const WS = new Uint8Array(256), DELIM = new Uint8Array(256);
for (const c of [0, 9, 10, 12, 13, 32]) WS[c] = 1;
for (const c of "()<>[]{}/%") DELIM[c.charCodeAt(0)] = 1;
const latin1 = (s, a, b) => { let o = ""; for (let i = a; i < b; i++) o += String.fromCharCode(s[i]); return o; };
const NUM = /^[+-]?(\d+\.?\d*|\.\d+)$/;
const num = (v) => (Math.abs(v) < 1e-4 ? "0" : String(+v.toFixed(4)));

function litString(s, i) {
  const out = [];
  let depth = 1;
  i++;
  while (i < s.length) {
    let c = s[i++];
    if (c === 92) {
      c = s[i++];
      if (c === 110) out.push(10); else if (c === 114) out.push(13); else if (c === 116) out.push(9);
      else if (c === 98) out.push(8); else if (c === 102) out.push(12);
      else if (c === 13) { if (s[i] === 10) i++; } else if (c === 10) { /* line continuation */ }
      else if (c >= 48 && c <= 55) {
        let v = c - 48;
        for (let k = 0; k < 2 && s[i] >= 48 && s[i] <= 55; k++) v = v * 8 + s[i++] - 48;
        out.push(v & 255);
      } else if (c !== undefined) out.push(c);
      continue;
    }
    if (c === 40) depth++;
    else if (c === 41 && --depth === 0) break;
    out.push(c);
  }
  return [Uint8Array.from(out), i];
}

function skipInlineImage(s, i) {
  let j = i;
  while (j < s.length - 1 && !(s[j] === 73 && s[j + 1] === 68 && WS[s[j - 1]] && (WS[s[j + 2]] || j + 2 >= s.length))) j++;
  for (j += 3; j < s.length - 1; j++) if (s[j] === 69 && s[j + 1] === 73 && WS[s[j - 1]] && (j + 2 >= s.length || WS[s[j + 2]])) return j + 2;
  return s.length;
}

/** Content stream bytes → [{ op, args, start, end }]. Strings are { str: Uint8Array }, names { name }, arrays []. */
export function lex(s) {
  const ops = [], stack = [];
  let args = [], start = -1, i = 0;
  const push = (v, at) => {
    if (stack.length) stack[stack.length - 1].push(v);
    else { if (start < 0) start = at; args.push(v); }
  };
  while (i < s.length) {
    const c = s[i], at = i;
    if (WS[c]) { i++; continue; }
    if (c === 37) { while (i < s.length && s[i] !== 10 && s[i] !== 13) i++; continue; }
    if (c === 40) { const [str, j] = litString(s, i); i = j; push({ str }, at); continue; }
    if (c === 60 && s[i + 1] === 60) { stack.push(Object.assign([], { at })); i += 2; continue; }
    if (c === 60) {
      let j = i + 1, hex = "";
      for (; j < s.length && s[j] !== 62; j++) if (!WS[s[j]]) hex += String.fromCharCode(s[j]);
      i = j + 1;
      if (hex.length % 2) hex += "0";
      const str = new Uint8Array(hex.length / 2);
      for (let k = 0; k < str.length; k++) str[k] = parseInt(hex.substr(2 * k, 2), 16) || 0;
      push({ str }, at);
      continue;
    }
    if (c === 91) { stack.push(Object.assign([], { at })); i++; continue; }
    if (c === 93 || (c === 62 && s[i + 1] === 62)) { i += c === 93 ? 1 : 2; const a = stack.pop(); if (a) push(a, a.at); continue; }
    if (c === 47) {
      let j = i + 1;
      while (j < s.length && !WS[s[j]] && !DELIM[s[j]]) j++;
      push({ name: latin1(s, i + 1, j) }, at);
      i = j;
      continue;
    }
    if (DELIM[c]) { i++; continue; } // stray ) > { }
    let j = i;
    while (j < s.length && !WS[s[j]] && !DELIM[s[j]]) j++;
    const tok = latin1(s, i, j);
    i = j;
    if (NUM.test(tok)) { push(+tok, at); continue; }
    if (tok === "true" || tok === "false" || tok === "null") { push(tok, at); continue; }
    stack.length = 0;
    if (tok === "BI") { i = skipInlineImage(s, i); ops.push({ op: "BI", args: [], start: at, end: i }); }
    else ops.push({ op: tok, args, start: start < 0 ? at : start, end: j });
    args = [];
    start = -1;
  }
  return ops;
}

const ARGS = { Tj: 1, TJ: 1, "'": 1, '"': 3 };
const fmt = (v) => (typeof v === "number" ? num(v) : v?.name != null ? "/" + v.name : Array.isArray(v) ? `[${v.map(fmt).join(" ")}]` : "");
const hex = (b) => "<" + Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("") + ">";

function extGState(page, name) {
  try {
    const gs = page.node.normalizedEntries().Resources.lookup(PDFName.of("ExtGState"))?.lookup(PDFName.of(name));
    const get = (k) => gs?.lookup(PDFName.of(k));
    const lw = get("LW"), lj = get("LJ"), d = get("D");
    return {
      w: lw instanceof PDFNumber ? num(lw.asNumber()) : null,
      j: lj instanceof PDFNumber ? num(lj.asNumber()) : null,
      d: d instanceof PDFArray ? d.toString().replace(/\s+/g, " ") + " d" : null,
    };
  } catch { return {}; }
}

/**
 * Rewrite one page's content so the glyphs flagged in `bold` (Set of glyph indices) render bold.
 * → { bytes, done: Set of glyph indices that were bolded, depth: unclosed q count } | null when the stream does not
 *   line up with pdf.js's reading.
 */
function boldPage(src, page, pg, bold) {
  const ops = lex(src);
  // stroke colour (scs = colour-space op, sc = colour op) and the fill colour rewritten as stroke operators (fcs, fc)
  let st = { tr: "0", w: "1", j: "0", d: "[] 0 d", scs: "", sc: "0 G", fcs: "", fc: "0 G", pattern: false, font: false };
  const stack = [], shows = [];
  let depth = 0;
  for (const o of ops) {
    const a = o.args, last = a[a.length - 1];
    switch (o.op) {
      case "q": stack.push({ ...st }); depth++; break;
      case "Q": if (stack.length) st = stack.pop(); depth = Math.max(0, depth - 1); break;
      case "Tr": st.tr = fmt(last); break;
      case "w": st.w = fmt(last); break;
      case "j": st.j = fmt(last); break;
      case "d": if (a.length >= 2) st.d = `${fmt(a[a.length - 2])} ${fmt(last)} d`; break;
      case "gs": if (last?.name) { const g = extGState(page, last.name); st.w = g.w ?? st.w; st.j = g.j ?? st.j; st.d = g.d ?? st.d; } break;
      case "Tf": if (a.length >= 2) st.font = true; break;
      case "G": case "RG": case "K": st.scs = ""; st.sc = `${a.map(fmt).join(" ")} ${o.op}`; break;
      case "CS": st.scs = `${fmt(last)} CS`; st.sc = ""; break;
      case "SC": case "SCN": st.sc = `${a.map(fmt).join(" ")} ${o.op}`; break;
      case "g": case "rg": case "k": st.fcs = ""; st.fc = `${a.map(fmt).join(" ")} ${o.op.toUpperCase()}`; st.pattern = false; break;
      case "cs": st.fcs = `${fmt(last)} CS`; st.fc = ""; st.pattern = last?.name === "Pattern"; break;
      case "sc": case "scn": st.fc = `${a.map(fmt).join(" ")} ${o.op.toUpperCase()}`; st.pattern ||= last?.name != null; break;
      default:
        if (ARGS[o.op] && a.length >= ARGS[o.op] && st.font) shows.push({ o, st: { ...st } });
    }
  }
  const done = new Set();
  if (shows.length !== pg.ops.length) return { bytes: src, done, depth };

  const patches = [];
  shows.forEach(({ o, st }, k) => {
    const { codes, first } = pg.ops[k];
    const a = o.args.slice(-ARGS[o.op]);
    const items = o.op === "TJ" ? (Array.isArray(a[0]) ? a[0] : []) : [a[a.length - 1]];
    const bytes = items.filter((v) => v?.str).map((v) => v.str);
    const total = bytes.reduce((n, b) => n + b.length, 0);
    const L = total === codes.length ? 1 : total === 2 * codes.length ? 2 : 0;
    if (!L) return;
    let ci = 0;
    for (const b of bytes) for (let i = 0; i < b.length; i += L) if ((L === 1 ? b[i] : (b[i] << 8) | b[i + 1]) !== codes[ci++]) return;
    let any = false;
    for (let gi = 0; gi < codes.length; gi++) if (bold.has(first + gi)) any = true;
    if (!any || st.pattern || st.tr !== "0") return;
    // split into runs of equal boldness; a kerning number travels with the code after it
    const runs = [];
    let pend = [];
    ci = 0;
    for (const v of items) {
      if (typeof v === "number") { pend.push(num(v)); continue; }
      if (!v?.str) continue;
      for (let i = 0; i < v.str.length; i += L) {
        const gi = first + ci++, b = bold.has(gi);
        if (!runs.length || runs[runs.length - 1].b !== b) runs.push({ b, parts: [], g: gi });
        runs[runs.length - 1].parts.push(...pend, hex(v.str.subarray(i, i + L)));
        pend = [];
        if (b) done.add(gi);
      }
    }
    if (pend.length && runs.length) runs[runs.length - 1].parts.push(...pend);
    const ts = pg.glyphs[runs.find((r) => r.b).g].ts || 10;
    const on = `2 Tr ${num(Math.max(0.1, ts * 0.035))} w 1 j [] 0 d ${st.fcs} ${st.fc}`;
    const off = `${st.tr} Tr ${st.w} w ${st.j} j ${st.d} ${st.scs} ${st.sc}`;
    let out = o.op === "'" ? "T* " : o.op === '"' ? `${fmt(a[0])} Tw ${fmt(a[1])} Tc T* ` : "";
    for (const r of runs) out += r.b ? ` ${on} [${r.parts.join(" ")}] TJ ${off} ` : ` [${r.parts.join(" ")}] TJ `;
    patches.push([o.start, o.end, out]);
  });
  if (!patches.length) return { bytes: src, done, depth };
  const enc = new TextEncoder(), chunks = [];
  let at = 0;
  for (const [s, e, t] of patches) { chunks.push(src.subarray(at, s), enc.encode(t)); at = e; }
  chunks.push(src.subarray(at));
  const outBytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let p = 0;
  for (const c of chunks) { outBytes.set(c, p); p += c.length; }
  return { bytes: outBytes, done, depth };
}

/** The page's /Contents entries as written (refs, or direct objects in an array). */
function contentRefs(ctx, page) {
  const raw = page.node.get(PDFName.of("Contents"));
  const v = raw instanceof PDFRef ? ctx.lookup(raw) : raw;
  return v instanceof PDFArray ? v.asArray() : raw ? [raw] : [];
}

function contentBytes(doc, page) {
  const parts = contentRefs(doc.context, page).map((r) => {
    const s = doc.context.lookup(r);
    if (!(s instanceof PDFRawStream)) throw new Error("unsupported content stream");
    return decodePDFRawStream(s).decode();
  });
  const out = new Uint8Array(parts.reduce((n, b) => n + b.length + 1, 0));
  let p = 0;
  for (const b of parts) { out.set(b, p); p += b.length; out[p++] = 10; }
  return out;
}

const rgb = (h) => (/^#?[0-9a-f]{6}$/i.test(h || "") ? [1, 3, 5].map((i) => num(parseInt(h.replace("#", "").padStart(7, "#").slice(i, i + 2), 16) / 255)).join(" ") : "0 0 0");

/** Rectangles along runs of glyphs on one line: [{ m: cm matrix, x, y, w, h, g }] in default user space */
function runs(glyphs, flag, bit) {
  const out = [];
  let cur = null;
  glyphs.forEach((g, i) => {
    const on = flag[i] & bit && !g.skip;
    if (cur && (!on || g.line !== cur.line)) { out.push(cur); cur = null; }
    if (!on) return;
    if (!cur) {
      const size = Math.hypot(g.ux, g.uy) || 1, bl = Math.hypot(g.x1 - g.x0, g.y1 - g.y0);
      const u = bl > 1e-6 ? [(g.x1 - g.x0) / bl, (g.y1 - g.y0) / bl] : [g.uy / size, -g.ux / size];
      cur = { line: g.line, g, size, u, v: [g.ux / size, g.uy / size], s0: Infinity, s1: -Infinity };
    }
    for (const [x, y] of [[g.x0, g.y0], [g.x1, g.y1]]) {
      const s = (x - cur.g.x0) * cur.u[0] + (y - cur.g.y0) * cur.u[1];
      cur.s0 = Math.min(cur.s0, s);
      cur.s1 = Math.max(cur.s1, s);
    }
  });
  if (cur) out.push(cur);
  return out.filter((r) => r.s1 > r.s0);
}

/**
 * writePdf(doc, marks, styles) → { blob, fallback } where fallback counts bold glyphs drawn as underline instead
 * (text inside form objects, Type 3 fonts, unusual render modes or streams that could not be lined up).
 */
// pdf-lib stops unpacking a stream at 256 MB (vite.config.js); pdf.js would then drop the whole stream from the rebuilt page.
const TOO_BIG = /^A stream in this PDF unpacks to more than/;
const tooBig = () => new InputError("Part of this PDF unpacks to more than 256 MB, so it can't be marked up as a PDF. Choose Word (.docx) as the download format instead.");

export async function writePdf(doc, marks, styles) {
  let pdf;
  try { pdf = await PDFDocument.load(doc.bytes, { updateMetadata: false }); }
  catch (e) {
    if (e instanceof EncryptedPDFError) throw new InputError("This PDF is protected against editing, so it can't be marked up as a PDF. Choose Word (.docx) as the download format instead.");
    if (TOO_BIG.test(e?.message)) throw tooBig();
    throw e;
  }
  const pages = pdf.getPages();
  const flags = doc.pages.map((p) => new Uint8Array(p.glyphs.length));
  for (const [bi, eff] of effects(doc.blocks, marks, styles)) {
    const b = doc.blocks[bi], f = flags[b.page];
    for (let i = 0; i < eff.length; i++) if (eff[i] && b.gmap[i] >= 0) f[b.gmap[i]] |= eff[i];
  }
  const multiply = pdf.context.register(pdf.context.obj({ Type: "ExtGState", BM: "Multiply" }));
  const color = rgb(styles.color || "#fff59d");
  let fallback = 0;
  for (let pi = 0; pi < pages.length && pi < doc.pages.length; pi++) {
    const page = pages[pi], pg = doc.pages[pi], flag = flags[pi];
    // text already set in a bold font stays as it is: no double weight, no underline fallback
    flag.forEach((f, i) => { if (f & 1 && pg.glyphs[i].bold) flag[i] = f & ~1; });
    if (!flag.some((f) => f)) continue;
    const bold = new Set();
    flag.forEach((f, i) => { if (f & 1 && pg.glyphs[i].op >= 0 && !pg.glyphs[i].type3 && pg.glyphs[i].mode === 0) bold.add(i); });
    let res = null; // also tells how many q the page leaves open, so the overlay starts from a clean state
    try { res = boldPage(contentBytes(pdf, page), page, pg, bold); } catch (e) { if (TOO_BIG.test(e?.message)) throw tooBig(); res = null; }
    flag.forEach((f, i) => {
      if (f & 1 && !res?.done.has(i)) { flag[i] = (f & ~1) | 2; if (pg.glyphs[i].ch.trim()) fallback++; }
    });
    let over = "";
    const hl = runs(pg.glyphs, flag, 4), ul = runs(pg.glyphs, flag, 2);
    if (hl.length) {
      const key = page.node.newExtGState("GS", multiply).asString();
      over += `q ${key} gs ${color} rg\n`;
      for (const r of hl) {
        const g = r.g, asc = Math.min(1, Math.max(0.7, g.asc)), desc = Math.min(-0.15, Math.max(-0.3, g.desc)), pad = 0.06 * r.size;
        over += `q ${[...r.u, ...r.v, g.x0, g.y0].map(num).join(" ")} cm ${num(r.s0 - pad)} ${num(desc * r.size)} ${num(r.s1 - r.s0 + 2 * pad)} ${num((asc - desc) * r.size)} re f Q\n`;
      }
      over += "Q\n";
    }
    for (const r of ul) {
      const g = r.g, th = Math.max(0.5, 0.06 * r.size);
      over += `q ${rgb(g.fill)} rg ${[...r.u, ...r.v, g.x0, g.y0].map(num).join(" ")} cm ${num(r.s0)} ${num(-0.13 * r.size - th / 2)} ${num(r.s1 - r.s0)} ${num(th)} re f Q\n`;
    }
    const ctx = pdf.context, enc = new TextEncoder();
    const head = ctx.register(ctx.stream("q\n"));
    const tail = ctx.register(ctx.flateStream(enc.encode("\n" + "Q\n".repeat(1 + (res?.depth || 0)) + over)));
    const body = res?.done.size ? [ctx.register(ctx.flateStream(res.bytes))] : contentRefs(ctx, page);
    page.node.set(PDFName.of("Contents"), ctx.obj([head, ...body, tail]));
  }
  const out = await pdf.save();
  return { blob: new Blob([out], { type: MIME.pdf }), fallback };
}
