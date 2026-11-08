// The result, drawn from the exact file the download button saves: pdf.js canvases for PDF, docx-preview for Word.
// Word output is rendered into a shadow root with constructable stylesheets, because the CSP forbids <style> elements.
import { useEffect, useRef, useState } from "react";
import { Icon, Settled, Spinner } from "./ui.jsx";

const DOCX_OPTS = {
  className: "docx", inWrapper: true, breakPages: true, ignoreLastRenderedPageBreak: true, experimental: true, // experimental: only lists the tab stops (placeTabs)
  renderAltChunks: false, renderComments: false, renderChanges: false, useBase64URL: true, ignoreFonts: true, // fonts: embeddedFonts
};
const PX_PER_PT = 96 / 72; // so at 100% a PDF page shows at its printed size, as docx-preview draws a Word page
const DESK = `:host { display: block; line-height: normal; } /* Word's single spacing, not the page's 1.5 */
.docx p { min-height: 1lh; } /* an empty paragraph: one line of its mark's font, not 1em */
:where(.docx) p { font-size: 10pt; } /* Word's size where the file sets none, not the page's 12pt */
.docx-wrapper { background: transparent; padding: 0; }
.docx-wrapper > section.docx { margin: 0 0 16px; box-shadow: 0 1px 3px rgb(0 0 0 / .2), 0 12px 32px -16px rgb(0 0 0 / .35); }
.docx sup, .docx sub { font-size: 65%; }`; // Word draws superscript at about two thirds; the browser's "smaller" is 83%
const NO_HYPHENS = "\n.docx-wrapper > section.docx { hyphens: manual; }"; // docx-preview hyphenates every page; Word only when the file asks

// Word CVs name fonts many devices lack (Avenir Next LT Pro, Aptos), and docx-preview ends no font list with a generic family, so the
// browser showed its default serif. Each list now ends with the kind Word's font table gives the first font (swiss: sans-serif), and
// theme fonts are named outright, as docx-preview defines only two of the eight theme-font variables it writes.
const KIND = { swiss: "sans-serif", roman: "serif", modern: "monospace", script: "cursive" };
function fallbacks(word, generic, own) {
  const table = new Map((word.fontTablePart?.fonts || []).map((f) => [String(f.name).toLowerCase(), KIND[f.family]]));
  const scheme = word.themePart?.theme?.fontScheme;
  const theme = { major: scheme?.majorFont?.latinTypeface, minor: scheme?.minorFont?.latinTypeface };
  const kind = (name) => table.get(name.toLowerCase()) || generic(name);
  return (list) => {
    const named = list.trim().replace(/var\(--docx-(major|minor)\w*-font\)/g, (_, k) => (theme[k] ? `'${theme[k].replace(/['"\\]/g, "")}'` : "sans-serif"));
    const first = named.split(",")[0].trim().replace(/^['"]|['"]$/g, ""), alias = own.get(first.toLowerCase());
    const full = /(^|,)\s*(sans-serif|serif|monospace|cursive|fantasy|system-ui)$/i.test(named) ? named : `${named}, ${kind(first)}`;
    return alias ? `'${alias}', ${full}` : full;
  };
}

// A file can carry its fonts (Google Docs saves Tahoma in), which Word and LibreOffice draw with; docx-preview's @font-face for them
// sits in the shadow root, where browsers ignore it, so a CV in Tahoma showed in another font and ran 9 pages, not 12. They are added
// to the page instead, under names of their own (cv-font-N) so a file's font never restyles the app, and swapped with the preview.
let fontSerial = 0, fontsShown = [];
async function embeddedFonts(word) {
  const own = new Map(), faces = [];
  for (const f of word.fontTablePart?.fonts || []) for (const ref of f.embedFontRefs || []) {
    const key = String(f.name).toLowerCase(), alias = own.get(key) ?? `cv-font-${++fontSerial}`;
    try {
      const url = await word.loadFont(ref.id, ref.key);
      if (!url) continue;
      faces.push(await new FontFace(alias, `url(${url})`, { weight: /bold/i.test(ref.type) ? "bold" : "normal", style: /italic/i.test(ref.type) ? "italic" : "normal" }).load());
      own.set(key, alias);
    } catch { /* a damaged font: its text shows in the fallback */ }
  }
  return { own, faces };
}

// iOS Safari leaves a canvas blank past 16.7 Mpx, or once all canvases pass a quarter of RAM, and old and new pages overlap
// while redrawing; so a long or very tall CV is drawn a little softer instead, and spent canvases give their memory back at once.
const PAGE_PX = 16e6, ALL_PX = 40e6;
const free = (canvases) => { for (const c of canvases) c.width = c.height = 0; };

async function showPdf(blob, box, alive, zoom) {
  const { openPdf } = await import("../lib/pdf-read.js");
  const pdf = await openPdf(new Uint8Array(await blob.arrayBuffer()));
  const pages = [];
  try {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5), fit = box.clientWidth || 640;
    let k = 1;
    for (let n = 1; n <= pdf.numPages && alive(); n++) {
      const page = await pdf.getPage(n);
      const w = page.getViewport({ scale: 1 }).width, css = zoom ? w * PX_PER_PT : fit;
      const s = Math.max(1, (css * dpr) / w), full = page.getViewport({ scale: s }), px = full.width * full.height;
      if (n === 1) k = Math.min(1, Math.sqrt(ALL_PX / (px * pdf.numPages))); // shortcut: budgets by page 1's size; sum every page's if mixed sizes show up
      const vp = page.getViewport({ scale: s * Math.min(k, Math.sqrt(PAGE_PX / px)) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      if (zoom) canvas.style.width = `${css}px`;
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", `Page ${n} of ${pdf.numPages} of your highlighted CV`);
      await page.render({ canvas, viewport: vp }).promise;
      page.cleanup();
      pages.push(canvas);
    }
    if (alive()) { free(box.querySelectorAll("canvas")); box.replaceChildren(...pages); pages.length = 0; }
  } finally {
    free(pages); // a redraw cut short by a newer change
    pdf.loadingTask.destroy();
  }
}

// docx-preview passes VML shape styles as strings, which a style attribute would carry (blocked); CSSOM is allowed.
const cspSafe = (h) => (elem) => {
  if (typeof elem.style !== "string") return h(elem);
  const el = h({ ...elem, style: undefined });
  el.style.cssText = elem.style;
  return el;
};

// Word tab stops (the right-aligned dates of most CVs) have no HTML form. docx-preview lists each tab with its paragraph's
// stops and places them 500 ms after drawing by measuring the page, which our fit-to-width zoom has skewed by then;
// so the list is taken from it and placed here, at zoom 1, before the first paint. Same method: nbsp + word-spacing.
// Word sizes a line by the runs on it, and its "auto" spacing multiplies the font's own line height. CSS gives every line a strut
// in the paragraph's own font (the page's 16px here) and multiplies the font size. So each paragraph takes its mark's size (the
// empty run vite.config.js keeps for it, else what a bare run there gets), never above its smallest run, the font of its longest
// run (an app font strut under Liberation Sans text added 4% a line), and --r, that font's line height per size, which the spacing
// multiplies. Each run keeps the size it had, so none inherits the change.
function fitLines(root) {
  const ps = [...root.querySelectorAll("p")];
  const bare = ps.map((p) => p.querySelector(":scope > span.docx-mark") || p.appendChild(document.createElement("span")));
  const fonts = ps.map((p, i) => {
    const b = getComputedStyle(bare[i]);
    let size = parseFloat(b.fontSize), family = b.fontFamily, most = 0;
    for (const s of p.getElementsByTagName("span")) {
      const text = [...s.childNodes].reduce((n, c) => n + (c.nodeType === Node.TEXT_NODE ? c.length : 0), 0);
      if (s === bare[i] || !text) continue;
      const c = getComputedStyle(s);
      if (!s.style.fontSize) s.style.fontSize = c.fontSize;
      size = Math.min(size, parseFloat(c.fontSize));
      if (text > most) [most, family] = [text, c.fontFamily];
    }
    return { size, family };
  });
  for (const b of bare) b.remove();
  const probes = new Map(fonts.map(({ family }) => [family, null]));
  for (const family of probes.keys()) {
    const d = root.appendChild(document.createElement("div"));
    Object.assign(d.style, { position: "absolute", visibility: "hidden", fontSize: "1000px", lineHeight: "normal", fontFamily: family });
    d.textContent = "x";
    probes.set(family, d);
  }
  const ratio = new Map([...probes].map(([family, d]) => [family, d.offsetHeight / 1000]));
  for (const d of probes.values()) d.remove();
  ps.forEach((p, i) => {
    p.style.fontSize = `${fonts[i].size}px`;
    p.style.fontFamily = fonts[i].family;
    p.style.setProperty("--r", String(ratio.get(fonts[i].family) || 1.15));
    if (/^[\d.]+$/.test(p.style.lineHeight)) p.style.lineHeight = `calc(${p.style.lineHeight} * var(--r))`;
  });
}

function placeTabs(tabs, defaultStop) {
  const px = (pt) => pt / 0.75, step = px(parseFloat(defaultStop) || 36);
  for (const { span, stops } of tabs) {
    const p = span.closest("p");
    if (!p) continue;
    span.textContent = "\u00a0";
    const x0 = p.getBoundingClientRect().left - parseFloat(getComputedStyle(p).marginLeft); // stops count from the column edge
    const s = span.getBoundingClientRect(), at = s.left - x0 + 1;
    const stop = (stops || []).filter((t) => t.style !== "clear").map((t) => ({ ...t, x: px(parseFloat(t.position)) }))
      .sort((a, b) => a.x - b.x).find((t) => t.x > at) || { x: (Math.floor(at / step) + 1) * step }; // else the next default stop
    let to = stop.x;
    if (/^(right|end|center)$/.test(stop.style)) {
      const all = [...p.getElementsByClassName(span.className)], next = all[all.indexOf(span) + 1], r = document.createRange();
      r.setStartAfter(span);
      if (next) r.setEndBefore(next); else r.setEnd(p, p.childNodes.length);
      to -= r.getBoundingClientRect().width * (stop.style === "center" ? 0.5 : 1) + 0.5; // a hair short, or rounding wraps the date
    }
    span.style.wordSpacing = `${Math.max(0, to - (s.right - x0))}px`;
    if (stop.leader && stop.leader !== "none") span.style.textDecoration = /dot/i.test(stop.leader) ? "underline dotted" : "underline";
  }
}

async function showDocx(blob, box, alive, zoom) {
  const [{ parseAsync, renderDocument, defaultOptions }, { previewDocx, generic }] = await Promise.all([import("docx-preview"), import("../lib/docx.js")]);
  const safe = cspSafe(defaultOptions.h);
  let drawer = null; // docx-preview calls h as a method of its renderer, which holds the tab list
  const opts = { ...DOCX_OPTS, h(elem) { drawer = this; return safe(elem); } };
  const word = await parseAsync(await previewDocx(blob), opts);
  const nodes = await renderDocument(word, opts);
  const tabs = drawer?.currentTabs?.splice(0) ?? []; // emptied, so its own late pass has nothing to move
  const { own, faces } = await embeddedFonts(word);
  if (!alive()) return null;
  const font = fallbacks(word, generic, own), sheets = [], body = [];
  for (const n of nodes) {
    if (n.nodeName !== "STYLE") { body.push(n); continue; }
    const s = new CSSStyleSheet();
    // Word puts a character style above paragraph and table styles; docx-preview writes it as span.x, which lost to p.y span
    // (0,1,2) and table.y tr.first-row td span (0,2,4), so a CV's run font and size fell back to the paragraph's
    // The default paragraph style's run rule (and the default table style's cell rule) came out as ".docx p, p.normal span": its
    // first half lacks " span", so the document defaults' ".docx span" won and an unstyled paragraph showed at their size and font.
    // It now also reaches the runs of paragraphs (tables) without a style of their own, as Word applies it; the first half stays,
    // as it sizes each paragraph's own line (the CSS strut).
    s.replaceSync(n.textContent.replace(/font-family:([^;}]+)/g, (_, v) => `font-family: ${font(v)}`).replace(/^span\.(\S+) \{/gm, "span.$1.$1.$1 {")
      .replace(/^\.docx (\w+), \1\.(\S+)( .+) \{(?=\r?$)/gm, '.docx $1, .docx $1:where(:not([class*="docx_"]))$3, $1.$2$3 {')
      // shortcut: "at least" spacing stays docx-preview's font size + N (Word: the larger of N and single); map it if a CV uses it
      .replace(/line-height: (\d*\.?\d+);/g, "line-height: calc($1 * var(--r, 1.15));")); // "auto" spacing: see fitLines
    sheets.push(s);
  }
  const desk = new CSSStyleSheet();
  desk.replaceSync(DESK + (word.settingsPart?.settings?.autoHyphenation ? "" : NO_HYPHENS));
  const host = document.createElement("div");
  const root = host.attachShadow({ mode: "open" });
  root.adoptedStyleSheets = [...sheets, desk];
  root.append(...body);
  // The file is the person's own, but links must not navigate and nothing may load from elsewhere.
  for (const el of root.querySelectorAll("*")) {
    for (const { name, value } of [...el.attributes]) {
      const n = name.toLowerCase();
      if (n.startsWith("on") || (el.localName === "a" && n === "href") ||
        (/^(src|href|xlink:href|srcset|poster)$/.test(n) && !/^(data|blob):/i.test(value.trim()))) el.removeAttribute(name);
    }
    if (el.style?.fontFamily) el.style.fontFamily = font(el.style.fontFamily);
  }
  // Word lays a table out on its grid (the column widths it saved); the browser's automatic layout shares the width out by
  // content instead, so a CV's text column came out 24 pt narrow and its lines wrapped early.
  for (const t of root.querySelectorAll("table")) {
    const cols = [...t.querySelectorAll(":scope > colgroup > col")].map((c) => c.style.width);
    if (!cols.length || !cols.every((w) => /^\d*\.?\d+pt$/.test(w))) continue;
    if (!parseFloat(t.style.width)) t.style.width = `${cols.reduce((sum, w) => sum + parseFloat(w), 0)}pt`;
    t.style.tableLayout = "fixed";
  }
  for (const f of fontsShown) document.fonts.delete(f);
  for (const f of (fontsShown = faces)) document.fonts.add(f);
  box.replaceChildren(host);
  fitLines(root);
  placeTabs(tabs, drawer?.defaultTabSize);
  if (zoom) return null;
  const page = root.querySelector("section.docx");
  const natural = page?.offsetWidth || 816;
  const fit = () => { host.style.zoom = String(Math.min(1, (box.clientWidth || natural) / natural)); };
  fit();
  const ro = new ResizeObserver(fit);
  ro.observe(box);
  return () => ro.disconnect();
}

export default function Preview({ out, pending, error, hasJob, hasText, counts, styles, children }) {
  const box = useRef(null);
  const [drawing, setDrawing] = useState(false);
  const [failed, setFailed] = useState("");
  const [shown, setShown] = useState(false);
  const [zoom, setZoom] = useState(false);

  useEffect(() => {
    if (!out) { box.current.replaceChildren(); setShown(false); return undefined; }
    let live = true, cleanup = null;
    setDrawing(true);
    (out.format === "pdf" ? showPdf : showDocx)(out.blob, box.current, () => live, zoom)
      .then((c) => { if (live) { cleanup = c; setFailed(""); setShown(true); } else c?.(); })
      .catch((e) => { console.error(e); if (live) setFailed("The preview could not be drawn, but the download still works."); })
      .finally(() => live && setDrawing(false));
    return () => { live = false; cleanup?.(); };
  }, [out, zoom]);

  const kinds = [["keyword", "exact"], ["related", "related"], ["line", counts.line === 1 ? "line" : "lines"]].filter(([k]) => counts[k]);
  const legend = kinds.filter(([k]) => styles[k] !== "off");
  return (
    <section className="card scroll-mt-4 overflow-hidden" aria-labelledby="preview-h" id="preview">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-line p-4 sm:px-5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="preview-h" className="flex items-center gap-2 text-lg font-semibold">
              <Icon name="eye" className="size-4 text-ink-3" />Preview
              {(pending || drawing) && out && <Spinner className="size-4 text-ink-3" />}
            </h2>
            {/* worded below lg, where a fitted page is too small to read; the negative margin keeps the row as tall as without it */}
            {shown && (
              <button type="button" className="btn btn-ghost btn-sm -my-1 ml-auto min-w-9 px-2.5 pointer-coarse:-my-2 pointer-coarse:min-w-11" onClick={() => setZoom((z) => !z)}
                title={zoom ? "Fit to screen" : "Zoom in"}><Icon name={zoom ? "zoomOut" : "zoomIn"} className="size-4" /><span className="lg:sr-only">{zoom ? "Fit to screen" : "Zoom in"}</span></button>
            )}
          </div>
          <Settled className="legend text-sm text-ink-3">
            {!out ? "Your highlighted CV appears here."
              : !hasJob ? (hasText ? <>No terms to mark yet. Add some in <a href="#step-terms" className="link">step 3</a>.</> : "Paste the job description to see the matches marked.")
              : legend.length ? legend.map(([k, label], i) => (
                <span key={k}>{i ? " · " : ""}<Sample how={styles[k]} color={styles.color}>{counts[k]} {label}</Sample></span>
              )) : kinds.length ? <>Marking is switched off. Turn it on in <a href="#step-style" className="link">step 4</a>.</>
              : "Nothing in your CV matches this job yet."}
          </Settled>
        </div>
        {children}
      </div>
      {error && <p role="alert" className="alert bad m-4 flex gap-2"><Icon name="warn" className="mt-0.5 size-4 flex-none" />{error}</p>}
      {failed && <p role="status" className="alert warn m-4">{failed}</p>}
      {/* the empty sheet only fills the space beside the steps; in one column it would push them a screen down */}
      <div className={`desk m-0 rounded-none focus-visible:-outline-offset-2 ${zoom ? "overflow-auto" : ""} ${out ? "" : "max-lg:hidden"}`} role="region" aria-label="Pages of your highlighted CV"
        tabIndex={shown ? 0 : undefined}>
        {!shown && <Placeholder />}
        <div ref={box} className={`mx-auto ${zoom ? "w-max" : "max-w-[52rem]"} ${shown && (pending || drawing) ? "stale" : ""}`} />
      </div>
    </section>
  );
}

function Sample({ how, color, children }) {
  if (how === "bold") return <b className="text-ink">{children}</b>;
  if (how === "underline") return <u className="text-ink">{children}</u>;
  return <mark style={{ background: color }}>{children}</mark>;
}

// An empty sheet with a few highlighted lines: shows what the tool does before there is anything to show.
function Placeholder() {
  const rows = [[38, 0], [24, 0], [0, 0], [92, 0], [84, 1], [88, 0], [0, 0], [30, 0], [90, 0], [70, 1], [86, 0], [64, 0]];
  return (
    <div className="mx-auto grid aspect-[1/1.414] max-w-sm content-start gap-2.5 rounded-sm bg-white p-7 shadow-md" aria-hidden="true">
      {rows.map(([w, hl], i) => w
        ? <i key={i} className={`block h-2 rounded-full ${hl ? "bg-[#fff176]" : i < 2 ? "bg-neutral-400" : "bg-neutral-200"}`} style={{ width: `${w}%` }} />
        : <i key={i} className="block h-1" />)}
    </div>
  );
}
