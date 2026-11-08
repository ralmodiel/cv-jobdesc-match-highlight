// DOCX in place. readDocx turns the main document part into plain-text blocks; writeDocx parses the original XML again,
// splits runs at mark edges and adds w:b / w:u / w:shd to the marked pieces. Every other byte of the package is kept.
import JSZip from "jszip";
import { MIME, InputError, checkZip } from "./files.js";
import { effects } from "./fx.js";

const MC = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const XMLNS = "http://www.w3.org/XML/1998/namespace";
const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';
// CT_RPr child order (ECMA-376 §17.3.2.28); new properties must be inserted in sequence or Word calls the file corrupt.
const RPR_ORDER = ["rStyle", "rFonts", "b", "bCs", "i", "iCs", "caps", "smallCaps", "strike", "dstrike", "outline", "shadow",
  "emboss", "imprint", "noProof", "snapToGrid", "vanish", "webHidden", "color", "spacing", "w", "kern", "position", "sz", "szCs",
  "highlight", "u", "effect", "bdr", "shd", "fitText", "vertAlign", "rtl", "cs", "em", "lang", "eastAsianLayout", "specVanish",
  "oMath", "rPrChange"];
const SKIP = new Set(["pPr", "rPr", "sectPr", "sdtPr", "tblPr", "trPr", "tcPr", "tblGrid", "del", "moveFrom"]);
const OFF = new Set(["0", "false", "off"]);

const parse = (s) => {
  if (/<!DOCTYPE/i.test(s.slice(0, 4096))) throw new InputError("This Word file contains a DOCTYPE, which Word never writes. It was not opened.");
  const x = new DOMParser().parseFromString(s, "application/xml");
  if (x.getElementsByTagName("parsererror").length) throw new InputError("This Word file contains invalid XML and could not be read.");
  return x;
};
const kids = (n) => (n ? [...n.children] : []);
const child = (n, ns, name) => kids(n).find((c) => c.namespaceURI === ns && c.localName === name) || null;
const val = (el, W) => el && (el.getAttributeNS(W, "val") ?? el.getAttribute("w:val"));
const on = (el, W) => !!el && !OFF.has(String(val(el, W) ?? "true").toLowerCase());
const choiceOf = (ac) => child(ac, MC, "Choice") || null;
const paraOf = (n, W) => { while (n && !(n.localName === "p" && n.namespaceURI === W)) n = n.parentNode; return n; };
/** The generic family a font falls back to on a device without it, guessed from its name. */
export const generic = (name) => (/mono|courier|consolas/i.test(name) ? "monospace"
  : /^(?!.*sans).*(serif|times|roman|garamond|georgia|cambria|book|palatino|baskerville|caslon|didot|bodoni|century|minion)/i.test(name) ? "serif" : "sans-serif");

async function open(buf, check = false) {
  let zip;
  try { zip = await JSZip.loadAsync(buf); } catch { throw new InputError("This Word file could not be opened. It may be damaged."); }
  if (check) await checkZip(zip); // on reading; each rebuild reopens the same, checked bytes
  let path = null;
  const rels = zip.file("_rels/.rels");
  if (rels) for (const r of parse(await rels.async("string")).getElementsByTagNameNS("*", "Relationship"))
    if (/\/officeDocument$/.test(r.getAttribute("Type") || "")) path = (r.getAttribute("Target") || "").replace(/^\//, "");
  if (!path || !zip.file(path)) path = zip.file("word/document.xml") ? "word/document.xml" : null;
  if (!path) throw new InputError("This zip file is not a Word document.");
  const types = await zip.file("[Content_Types].xml")?.async("string");
  if (types && /macroEnabled/i.test(types)) throw new InputError("Macro-enabled Word files (.docm) are not supported. Save it as Word Document (.docx) first.");
  return { zip, path, text: await zip.file(path).async("string") };
}

async function readStyles(zip, W) {
  const f = zip.file("word/styles.xml");
  const out = new Map();
  if (!f) return out;
  const raw = new Map();
  for (const s of parse(await f.async("string")).getElementsByTagNameNS(W, "style")) {
    if (s.getAttributeNS(W, "type") !== "paragraph" && s.getAttribute("w:type") !== "paragraph") continue;
    const id = s.getAttributeNS(W, "styleId") || s.getAttribute("w:styleId");
    const pPr = child(s, W, "pPr");
    const lvl = val(child(pPr, W, "outlineLvl"), W);
    raw.set(id, {
      name: (val(child(s, W, "name"), W) || "").toLowerCase(),
      based: val(child(s, W, "basedOn"), W),
      heading: lvl != null && +lvl < 9 ? true : null,
      list: child(pPr, W, "numPr") ? true : null,
      jc: val(child(pPr, W, "jc"), W),
    });
  }
  const resolve = (id, depth = 0) => {
    const s = raw.get(id);
    if (!s || depth > 10) return { heading: false, list: false, jc: null };
    const up = resolve(s.based, depth + 1);
    return {
      heading: s.heading ?? (/^(heading \d|title|subtitle)$/.test(s.name) || up.heading),
      list: s.list ?? (/^list (bullet|number)/.test(s.name) || up.list),
      jc: s.jc ?? up.jc,
    };
  };
  for (const id of raw.keys()) out.set(id, resolve(id));
  return out;
}

// Symbol-font bullets live in the private-use area; any of them reads as a bullet.
const symChar = (el, W) => {
  const c = parseInt(el.getAttributeNS(W, "char") || el.getAttribute("w:char") || "", 16);
  return !c || (c >= 0xe000 && c <= 0xf8ff) ? "•" : String.fromCodePoint(c);
};

/** Plain text of one paragraph plus where each piece came from: [{ r, node, start, len, kind: 't'|'x' }]. */
function paraText(p, W) {
  const segs = [];
  let text = "";
  const add = (r, node, s, kind) => { segs.push({ r, node, start: text.length, len: s.length, kind }); text += s; };
  const run = (r) => {
    const rPr = child(r, W, "rPr");
    if (on(child(rPr, W, "vanish"), W) || on(child(rPr, W, "webHidden"), W)) return; // hidden text is not part of the CV
    for (const c of kids(r)) {
      if (c.namespaceURI !== W) continue; // mc:AlternateContent in a run is a drawing or text box: its own blocks
      const n = c.localName;
      if (n === "t") add(r, c, c.textContent, "t");
      else if (n === "tab" || n === "ptab") add(r, c, "\t", "x");
      else if (n === "br" || n === "cr") add(r, c, "\n", "x");
      else if (n === "noBreakHyphen") add(r, c, "-", "x");
      else if (n === "sym") add(r, c, symChar(c, W), "x");
    }
  };
  const walk = (n) => {
    for (const c of kids(n)) {
      if (c.namespaceURI === MC && c.localName === "AlternateContent") { const ch = choiceOf(c); if (ch) walk(ch); }
      else if (c.namespaceURI !== W) walk(c);
      else if (c.localName === "r") run(c);
      else if (!SKIP.has(c.localName)) walk(c);
    }
  };
  walk(p);
  return { text, segs };
}

// Text boxes anchored inside a paragraph (not inside mc:Fallback, not nested in another box).
function boxesIn(p, W) {
  const out = [];
  const dfs = (n) => {
    for (const c of kids(n)) {
      if (c.namespaceURI === W && c.localName === "txbxContent") out.push(c);
      else if (!(c.namespaceURI === MC && c.localName === "Fallback")) dfs(c);
    }
  };
  dfs(p);
  return out;
}

/** Every paragraph in reading order: body, tables, content controls; text boxes get their own story after their anchor. */
function collect(xml) {
  const W = xml.documentElement.namespaceURI;
  const root = xml.documentElement, body = /^(hdr|ftr)$/.test(root.localName) ? root : child(root, W, "body");
  const out = [];
  let stories = 0;
  const visit = (node, story) => {
    for (const c of kids(node)) {
      if (c.namespaceURI === W && c.localName === "p") {
        out.push({ p: c, story, ...paraText(c, W) });
        for (const box of boxesIn(c, W)) {
          const from = out.length;
          visit(box, ++stories);
          mirror(box, out.slice(from), W);
        }
      } else if (c.namespaceURI === MC && c.localName === "AlternateContent") { const ch = choiceOf(c); if (ch) visit(ch, story); }
      else if (!(c.namespaceURI === W && SKIP.has(c.localName))) visit(c, story);
    }
  };
  if (body) visit(body, 0);
  return { W, paras: out };
}

// A text box in mc:Choice usually has a VML twin in mc:Fallback; give it the same marks when its text matches.
function mirror(box, paras, W) {
  let ac = box.parentNode;
  while (ac && !(ac.namespaceURI === MC && ac.localName === "AlternateContent")) ac = ac.parentNode;
  const fb = ac && child(ac, MC, "Fallback");
  const twin = fb && fb.getElementsByTagNameNS(W, "txbxContent")[0];
  if (!twin) return;
  const ps = [...twin.getElementsByTagNameNS(W, "p")];
  if (ps.length !== paras.length) return;
  ps.forEach((p, i) => { const t = paraText(p, W); if (t.text === paras[i].text) paras[i].mirror = { p, ...t }; });
}

// Direct bold (w:b on the run) as [start, end) spans, so a rebuilt PDF keeps it.
// shortcut: bold that comes from a character or paragraph style is not seen; resolve run styles if real CVs need it
const boldSpans = (segs, W) => segs.filter((s) => s.kind === "t" && on(child(child(s.r, W, "rPr"), W, "b"), W)).map((s) => [s.start, s.start + s.len]);

// Links as [start, end, address] spans, so a rebuilt PDF keeps them: a w:hyperlink names its address by r:id in the part's rels.
// shortcut: a HYPERLINK built from field characters (w:fldChar + w:instrText) is not seen; follow the field if real CVs use it
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
async function linkTargets(zip, path, external = true) {
  const f = zip.file(path.replace(/[^/]*$/, (n) => `_rels/${n}.rels`)), out = new Map();
  if (f) for (const r of parse(await f.async("string")).getElementsByTagNameNS("*", "Relationship"))
    if ((r.getAttribute("TargetMode") === "External") === external) out.set(r.getAttribute("Id"), r.getAttribute("Target"));
  return out;
}
function linkSpans(segs, W, rels) {
  const out = [];
  for (const s of segs) {
    let u = null;
    for (let n = s.r.parentNode; n && !u && !(n.namespaceURI === W && n.localName === "p"); n = n.parentNode) {
      if (n.namespaceURI !== W) continue;
      if (n.localName === "hyperlink") u = rels.get(n.getAttributeNS(R, "id") || n.getAttribute("r:id")) || null;
      else if (n.localName === "fldSimple") u = (n.getAttributeNS(W, "instr") || n.getAttribute("w:instr") || "").match(/^\s*HYPERLINK\s+"([^"]+)"/)?.[1] || null;
    }
    if (!u) continue;
    const last = out[out.length - 1];
    if (last && last[2] === u && last[1] === s.start) last[1] = s.start + s.len;
    else out.push([s.start, s.start + s.len, u]);
  }
  return out;
}

// The page header and footer are parts of their own, outside the body, and many Word CVs keep the name and contact line there;
// a rebuild has no header, so it puts page 1's header first and the last page's footer last. They are not matched or marked:
// the in-place download leaves them as they are. A line that is only a page number ("Page 1 of 2", or its field) is left out.
// shortcut: a page number inside a longer header or footer line stays in a rebuild; skip PAGE fields if real CVs show it
const PAGE_ONLY = /^[-–—(\s]*(?:(?:page|pg|p|página|pagina|seite)\.?\s*)?\d*(?:\s*(?:of|de|von|di|sur|\/|\|)\s*\d*)?[-–—)\s]*$/iu;
async function margins(zip, path, xml, W) {
  const secs = xml.getElementsByTagNameNS(W, "sectPr"), parts = await linkTargets(zip, path, false);
  const ref = (sp, tag, type) => {
    for (const r of kids(sp)) if (r.namespaceURI === W && r.localName === tag && (r.getAttributeNS(W, "type") ?? r.getAttribute("w:type") ?? "default") === type)
      return r.getAttributeNS(R, "id") || r.getAttribute("r:id");
    return null;
  };
  const read = async (id) => {
    const t = id && parts.get(id), p = t && (t.startsWith("/") ? t.slice(1) : path.replace(/[^/]*$/, "") + t), f = p && zip.file(p);
    if (!f) return [];
    const { W: w, paras } = collect(parse(await f.async("string"))), rels = await linkTargets(zip, p);
    return paras.filter((q) => !PAGE_ONLY.test(q.text)).map(({ text, segs }) => ({ text, kind: "para", bold: boldSpans(segs, w), links: linkSpans(segs, w, rels) }));
  };
  if (!secs.length) return { head: [], foot: [] };
  const first = secs[0], titled = on(child(first, W, "titlePg"), W); // a different first page: page 1 shows the "first" header
  let foot = null;
  for (let k = secs.length - 1; k >= 0 && !foot; k--) foot = ref(secs[k], "footerReference", "default"); // a section without one inherits the last
  return { head: await read(ref(first, "headerReference", titled ? "first" : "default")), foot: await read(foot || (titled && ref(first, "footerReference", "first"))) };
}

/** readDocx(ArrayBuffer) → { kind: 'docx', bytes, blocks: [{ id, text, kind, story, bold, links, align?, indent? }], head, foot: [{ text, kind, bold, links }], page } */
export async function readDocx(buf) {
  const { zip, path, text } = await open(buf, true);
  const xml = parse(text);
  const { W, paras } = collect(xml);
  if (!W || !/wordprocessingml/.test(W)) throw new InputError("This zip file is not a Word document.");
  const styles = await readStyles(zip, W), rels = await linkTargets(zip, path);
  const blocks = paras.map(({ p, story, text: t, segs }, id) => {
    const pPr = child(p, W, "pPr");
    const st = styles.get(val(child(pPr, W, "pStyle"), W)) || {};
    const lvl = val(child(pPr, W, "outlineLvl"), W);
    const num = child(pPr, W, "numPr");
    const numId = num && val(child(num, W, "numId"), W);
    const kind = st.heading || (lvl != null && +lvl < 9) ? "heading"
      : (num && numId !== "0") || st.list || /^\s*[•·▪◦‣●■◆➢✓*–-]\s/.test(t) ? "bullet" : "para";
    // a right-aligned or centred paragraph (a date, a place, the name) keeps that in a rebuilt PDF
    const align = { right: "right", end: "right", center: "center" }[val(child(pPr, W, "jc"), W) ?? st.jc];
    // and its own left indent (twips → pt), so sub-bullets and indented lines stay apart
    // shortcut: an indent set by the style or the list level is not read; read numbering.xml's lvl ind if such CVs come out flat
    const ind = child(pPr, W, "ind"), at = (n) => ind && (ind.getAttributeNS(W, n) || ind.getAttribute(`w:${n}`));
    const indent = Math.max(0, +(at("left") || at("start") || 0) / 20);
    return { id, text: t, kind, story, bold: boldSpans(segs, W), links: linkSpans(segs, W, rels), ...(align && { align }), ...(indent && { indent }) };
  });
  // page size of the last section (twips → points), for a rebuilt PDF of the same size
  const pg = text.match(/<w:pgSz\b[^>]*>/g)?.pop() || "", dim = (a) => +(pg.match(new RegExp(`w:${a}="(\\d+)"`))?.[1] || 0) / 20;
  return { kind: "docx", bytes: buf, blocks, ...(await margins(zip, path, xml, W)), page: dim("w") > 100 && dim("h") > 100 ? { w: dim("w"), h: dim("h") } : null };
}

/** writeDocx(doc, marks, styles) → Blob. styles: { keyword, related, line: 'bold'|'underline'|'highlight'|'off', color: 'RRGGBB' } */
export async function writeDocx(doc, marks, styles) {
  const { zip, path, text } = await open(doc.bytes);
  const xml = parse(text);
  const { W, paras } = collect(xml);
  const P = xml.documentElement.prefix ? xml.documentElement.prefix + ":" : "";
  const color = (styles.color || "FFF59D").replace(/^#/, "").toUpperCase(), look = await looks(zip, W);
  for (const [bi, eff] of effects(doc.blocks, marks, styles)) {
    const para = paras[bi];
    if (!para || para.text !== doc.blocks[bi].text) continue; // never write into a paragraph we did not read
    applyFx(para.segs, eff, W, P, color, look);
    if (para.mirror) applyFx(para.mirror.segs, eff, W, P, color, look);
  }
  zip.file(path, DECL + new XMLSerializer().serializeToString(xml).replace(/^<\?xml[^>]*\?>\s*/, ""));
  return zip.generateAsync({ type: "blob", mimeType: MIME.docx, compression: "DEFLATE" });
}

function applyFx(segs, eff, W, P, color, look) {
  const runs = new Map();
  for (const s of segs) (runs.get(s.r) || runs.set(s.r, []).get(s.r)).push(s);
  for (const [r, ss] of runs) {
    if (!ss.some((s) => eff.subarray(s.start, s.start + s.len).some(Boolean))) continue;
    const segOf = new Map(ss.map((s) => [s.node, s]));
    const groups = [];
    let loose = []; // nodes with no text (field chars, drawings, bookmarks): they stay where they were
    const put = (e, node) => {
      const g = groups[groups.length - 1];
      if (g && g.e === e) g.nodes.push(node);
      else { groups.push({ e, nodes: [...loose, node] }); loose = []; }
    };
    for (const c of kids(r)) {
      if (c.namespaceURI === W && c.localName === "rPr") continue;
      const s = segOf.get(c);
      if (!s || !s.len) { if (groups.length) groups[groups.length - 1].nodes.push(c); else loose.push(c); continue; }
      if (s.kind === "x") { put(eff[s.start], c); continue; }
      const full = c.textContent;
      for (let a = 0; a < s.len;) {
        let b = a + 1;
        while (b < s.len && eff[s.start + b] === eff[s.start + a]) b++;
        const t = c.cloneNode(false);
        t.textContent = full.slice(a, b);
        t.setAttributeNS(XMLNS, "xml:space", "preserve");
        put(eff[s.start + a], t);
        a = b;
      }
    }
    if (loose.length && groups.length) groups[groups.length - 1].nodes.push(...loose);
    const rPr0 = child(r, W, "rPr"), lk = groups.some((g) => g.e & 1) ? look(r) : null;
    for (const g of groups) {
      const nr = r.cloneNode(false);
      if (rPr0 || g.e) {
        const rp = rPr0 ? rPr0.cloneNode(true) : r.ownerDocument.createElementNS(W, P + "rPr");
        if (g.e & 1) {
          setProp(rp, "b", {}, W, P); setProp(rp, "bCs", {}, W, P);
          const sp = narrow(lk, g.nodes.filter((n) => n.namespaceURI === W && n.localName === "t").map((n) => n.textContent).join(""));
          if (sp != null) setProp(rp, "spacing", { val: String(sp) }, W, P);
        }
        if (g.e & 2) setProp(rp, "u", { val: "single" }, W, P);
        if (g.e & 4) setProp(rp, "shd", { val: "clear", color: "auto", fill: color }, W, P);
        nr.append(rp);
      }
      for (const n of g.nodes) nr.append(n);
      r.parentNode.insertBefore(nr, r);
    }
    r.remove();
  }
}

function setProp(rPr, name, attrs, W, P) {
  for (const c of kids(rPr)) if (c.namespaceURI === W && c.localName === name) c.remove();
  const el = rPr.ownerDocument.createElementNS(W, P + name);
  for (const [k, v] of Object.entries(attrs)) el.setAttributeNS(W, P + k, v);
  const at = RPR_ORDER.indexOf(name);
  const before = kids(rPr).find((c) => c.namespaceURI !== W || RPR_ORDER.indexOf(c.localName) > at) || null;
  rPr.insertBefore(el, before);
}

// looks(zip, W) → (run) → { font, size (half-points), bold, caps, spacing (twentieths of a point) } as Word works them out: the run,
// its character style, its paragraph's style (or the default one), the document defaults; theme fonts read from the theme.
// shortcut: table styles and toggled bold (a bold character style on a bold paragraph style) are not weighed; add them if a CV needs it
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
async function looks(zip, W) {
  const read = async (n) => (zip.file(n) ? parse(await zip.file(n).async("string")) : null);
  const st = await read("word/styles.xml"), th = await read(Object.keys(zip.files).find((n) => /^word\/theme\/theme\d*\.xml$/.test(n)) || "");
  const face = (k) => th?.getElementsByTagNameNS(A, k)[0]?.getElementsByTagNameNS(A, "latin")[0]?.getAttribute("typeface") || undefined;
  const theme = { major: face("majorFont"), minor: face("minorFont") };
  const own = (rPr) => {
    if (!rPr) return {};
    const f = child(rPr, W, "rFonts"), at = (n) => (f && (f.getAttributeNS(W, n) ?? f.getAttribute(`w:${n}`))) || undefined;
    const flag = (n) => { const e = child(rPr, W, n); return e ? on(e, W) : undefined; };
    const num = (n) => { const v = parseInt(val(child(rPr, W, n), W), 10); return Number.isFinite(v) ? v : undefined; };
    return { font: at("asciiTheme") ? theme[/^major/i.test(at("asciiTheme")) ? "major" : "minor"] : at("ascii"), size: num("sz"), bold: flag("b"), caps: flag("caps"), spacing: num("spacing") };
  };
  const styles = new Map();
  let normal = null;
  for (const s of st ? st.getElementsByTagNameNS(W, "style") : []) {
    const id = s.getAttributeNS(W, "styleId") || s.getAttribute("w:styleId");
    styles.set(id, [own(child(s, W, "rPr")), val(child(s, W, "basedOn"), W)]);
    if ((s.getAttributeNS(W, "type") || s.getAttribute("w:type")) === "paragraph" && /^(1|true|on)$/.test(s.getAttributeNS(W, "default") || s.getAttribute("w:default") || "")) normal = id;
  }
  const base = own(child(st?.getElementsByTagNameNS(W, "rPrDefault")[0], W, "rPr"));
  const chain = (id, n = 0) => { const s = styles.get(id); return !s || n > 20 ? [] : [s[0], ...chain(s[1], n + 1)]; };
  return (r) => {
    const rPr = child(r, W, "rPr"), ps = val(child(child(paraOf(r, W), W, "pPr"), W, "pStyle"), W), look = {};
    for (const o of [own(rPr), ...chain(val(child(rPr, W, "rStyle"), W)), ...chain(styles.has(ps) ? ps : normal), base]) for (const k in o) look[k] ??= o[k];
    return look;
  };
}

// Bold is wider (Arial by about a tenth, Calibri by 2%), so a line that just fit wrapped once a word in it turned bold, and every line
// below moved down. A run made bold is set that much closer (w:spacing, after each character), so lines break where they did.
// shortcut: measured in the device's copy of the font, else in its generic family; exact only where the CV's fonts are installed
let ruler;
function narrow(look, text) {
  const s = look?.caps ? text.toUpperCase() : text, n = [...s].length;
  ruler ??= typeof OffscreenCanvas === "function" ? new OffscreenCanvas(1, 1).getContext("2d") : null;
  if (!look || look.bold || !n || !ruler) return null;
  const name = (look.font || "Times New Roman").replace(/["\\\n\r\f]/g, ""), pt = (look.size ?? 20) / 2;
  const width = (weight) => { ruler.font = `${weight} 100px "${name}", ${generic(name)}`; return ruler.measureText(s).width; };
  const cut = Math.min(Math.ceil(((width("bold") - width("normal")) * pt * 20) / (100 * n)), Math.ceil(pt * 1.6)); // at most 0.08 em
  return cut > 0 ? (look.spacing ?? 0) - cut : null;
}

// Symbol and Wingdings bullets by their code (also seen as U+F0xx) in plain Unicode, as most devices have neither font.
// shortcut: other characters of those fonts (Symbol's Greek letters) show as •; map more of them if real CVs use them
const SYMBOLS = { 0xb7: "•", 0xa7: "▪", 0xd8: "➢", 0xfc: "✓", 0x76: "❖", 0x6e: "■", 0x6c: "●", 0x71: "❑", 0x75: "◆", 0xa8: "◻" };
const SYMBOL_FONT = /^(symbol|wingdings( [23])?|webdings)$/i;
const plainSymbol = (c) => SYMBOLS[c & 0xff] || "•";
const isSymbol = (c, font) => (c >= 0xf000 && c <= 0xf0ff) || (SYMBOL_FONT.test(font || "") && c < 0x100);
const setVal = (el, W, v) => { const a = el.getAttributeNodeNS(W, "val") || el.getAttributeNode("w:val"); if (a) a.value = v; };

/** previewDocx(Blob) → Blob: a copy for docx-preview only, never saved. It drops content controls inside tables (most Word templates
 *  keep their text in them), and reads an East Asian font as the font of Latin text; so controls are unwrapped, East Asian fonts
 *  left out (CJK text then shows in the device's own CJK font) and symbol-font bullets turned into plain characters. */
export async function previewDocx(blob) {
  const { zip, path } = await open(await blob.arrayBuffer());
  const names = ["word/styles.xml", path, "word/numbering.xml", "word/settings.xml", ...Object.keys(zip.files).filter((n) => /^word\/(header|footer)\d*\.xml$/.test(n))];
  const styles = new Map(); // style id → [its own w:vertAlign, the style it is based on]; styles.xml goes first to fill it
  const shift = (id, n = 0) => { const s = styles.get(id); return !s || n > 20 ? null : s[0] ?? shift(s[1], n + 1); };
  for (const name of new Set(names)) {
    const f = zip.file(name);
    if (!f) continue;
    const xml = parse(await f.async("string")), W = xml.documentElement.namespaceURI, all = (tag) => [...xml.getElementsByTagNameNS(W, tag)];
    for (const sdt of all("sdt")) { // document order, so an outer control goes first and the inner ones follow it out
      const content = child(sdt, W, "sdtContent");
      if (content) sdt.before(...content.childNodes);
      sdt.remove();
    }
    for (const rf of all("rFonts")) rf.removeAttributeNS(W, "eastAsia");
    for (const el of all("autoHyphenation")) if (on(el, W)) el.setAttributeNS(W, el.prefix ? `${el.prefix}:val` : "val", "true"); // it reads a bare one as off
    for (const sym of all("sym")) {
      const c = parseInt(sym.getAttributeNS(W, "char") || sym.getAttribute("w:char") || "", 16) || 0;
      const t = xml.createElementNS(W, sym.prefix ? `${sym.prefix}:t` : "t");
      t.textContent = isSymbol(c, sym.getAttributeNS(W, "font") || sym.getAttribute("w:font")) || !c ? plainSymbol(c) : String.fromCodePoint(c);
      sym.replaceWith(t);
    }
    // Word lets the spaces that end a paragraph hang past its margin; the browser counts them, so a right-aligned date or place
    // padded with spaces sat up to 87 pt short of the margin, and a centred line half that. They go from the copy.
    for (const p of all("p")) {
      const content = [...p.getElementsByTagNameNS(W, "r")].filter((r) => paraOf(r, W) === p).flatMap(kids)
        .filter((c) => !/^(rPr|lastRenderedPageBreak|fldChar|instrText|bookmarkStart|bookmarkEnd)$/.test(c.localName));
      for (const c of content.reverse()) {
        if (c.localName !== "t") break;
        c.textContent = c.textContent.replace(/ +$/, "");
        if (c.textContent) break;
      }
    }
    for (const lvl of all("lvl")) {
      const text = child(lvl, W, "lvlText"), fonts = child(child(lvl, W, "rPr"), W, "rFonts"), v = val(text, W) || "";
      const c = v.codePointAt(0);
      if (!c || [...v].length !== 1 || !isSymbol(c, fonts && (fonts.getAttributeNS(W, "ascii") || fonts.getAttributeNS(W, "hAnsi")))) continue;
      setVal(text, W, plainSymbol(c));
      fonts?.remove();
    }
    // it reads an indent off w:left, but a table's is in w:w, so a CV table pulled into the left margin overran the page's right edge
    // shortcut: a table style's indent stays unread (it would indent every cell there), add it if a CV shows one
    if (name !== "word/styles.xml") for (const ind of all("tblInd")) if (/^(dxa)?$/.test(ind.getAttributeNS(W, "type") ?? ind.getAttribute("w:type") ?? ""))
      ind.setAttributeNS(W, ind.prefix ? `${ind.prefix}:left` : "left", ind.getAttributeNS(W, "w") ?? ind.getAttribute("w:w") ?? "0");
    for (const st of all("style")) styles.set(st.getAttributeNS(W, "styleId") || st.getAttribute("w:styleId"), [val(child(child(st, W, "rPr"), W, "vertAlign"), W), val(child(st, W, "basedOn"), W)]);
    // it reads superscript only off a run, not off its styles, so a contact line set as 16 pt superscript by its style showed at 16 pt
    for (const r of all("r")) {
      let rPr = child(r, W, "rPr");
      const v = child(rPr, W, "vertAlign") ? null : shift(val(child(rPr, W, "rStyle"), W)) ?? shift(val(child(child(paraOf(r, W), W, "pPr"), W, "pStyle"), W));
      if (v !== "superscript" && v !== "subscript") continue;
      const tag = (t) => xml.createElementNS(W, r.prefix ? `${r.prefix}:${t}` : t), el = tag("vertAlign");
      el.setAttributeNS(W, r.prefix ? `${r.prefix}:val` : "val", v);
      if (!rPr) r.prepend((rPr = tag("rPr")));
      rPr.append(el);
    }
    zip.file(name, new XMLSerializer().serializeToString(xml));
  }
  return zip.generateAsync({ type: "blob" });
}
