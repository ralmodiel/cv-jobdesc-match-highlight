// In-browser half of check-browser.mjs (served by the Vite dev server): read → match → write → read back.
import JSZip from "jszip";
import { readPdf, openPdf } from "/src/lib/pdf-read.js";
import { writePdf } from "/src/lib/pdf-write.js";
import { readDocx, writeDocx } from "/src/lib/docx.js";
import { analyzeJob } from "/src/lib/jd.js";
import { matchCV, detectSections } from "/src/lib/match.js";
import { SAMPLE_JOB } from "/src/lib/sample.js";
import { buildOutput } from "/src/lib/convert.js";

const STYLES = { keyword: "bold", related: "underline", line: "highlight", color: "#fff59d" };

/** Bold flags per character of each paragraph, body and table cells in document order (no text boxes). */
async function docxBold(blob) {
  const zip = await JSZip.loadAsync(blob);
  const xml = new DOMParser().parseFromString(await zip.file("word/document.xml").async("string"), "application/xml");
  const W = xml.documentElement.namespaceURI ? xml.documentElement.lookupNamespaceURI("w") : null;
  const body = xml.getElementsByTagNameNS(W, "body")[0];
  return [...body.getElementsByTagNameNS(W, "p")].map((p) => {
    const flags = [];
    for (const r of p.getElementsByTagNameNS(W, "r")) {
      const b = !!r.getElementsByTagNameNS(W, "rPr")[0]?.getElementsByTagNameNS(W, "b")[0];
      for (const t of r.childNodes) {
        if (t.localName === "t") for (const _ of t.textContent) flags.push(b);
        else if (t.localName === "tab") flags.push(b);
      }
    }
    return flags;
  });
}

export async function roundTrip(b64, kind, jobText = SAMPLE_JOB) {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const read = kind === "pdf" ? readPdf : readDocx;
  let t = performance.now();
  const doc = await read(bytes.buffer);
  const readMs = performance.now() - t;
  const { marks } = matchCV(doc.blocks, analyzeJob(jobText));
  t = performance.now();
  const res = kind === "pdf" ? await writePdf(doc, marks, STYLES) : { blob: await writeDocx(doc, marks, STYLES), fallback: 0 };
  const writeMs = performance.now() - t;
  const out = await read(await res.blob.arrayBuffer());
  const diff = out.blocks.findIndex((b, i) => b.text !== doc.blocks[i]?.text);
  const kw = marks.filter((m) => m.cat === "keyword");
  let boldChars = 0, boldOk = 0;
  if (kind === "pdf") {
    for (const m of kw) {
      const b = doc.blocks[m.block];
      for (let i = m.start; i < m.end; i++) {
        const g = b.gmap[i];
        if (g < 0 || !b.text[i].trim()) continue;
        boldChars++;
        const og = out.pages[b.page].glyphs[g];
        if (og.mode === 2 || og.bold) boldOk++; // re-rendered bold, or already in a bold font
      }
    }
  } else {
    const flags = await docxBold(res.blob);
    for (const m of kw) for (let i = m.start; i < m.end; i++) if (doc.blocks[m.block].text[i].trim()) { boldChars++; if (flags[m.block]?.[i]) boldOk++; }
  }
  return {
    blocks: doc.blocks.length, marks: marks.length, keywords: kw.length, sameText: diff < 0 && out.blocks.length === doc.blocks.length,
    firstDiff: diff < 0 ? null : [doc.blocks[diff]?.text, out.blocks[diff]?.text], boldChars, boldOk, fallback: res.fallback,
    doubled: kind === "pdf" ? out.pages.flatMap((p) => p.glyphs).filter((g) => g.bold && g.mode === 2).length : 0,
    readMs: Math.round(readMs), writeMs: Math.round(writeMs),
    texts: doc.blocks.map((b) => b.text),
    sections: detectSections(doc.blocks).map((x) => x.section), lines: marks.filter((m) => m.cat === "line").map((m) => m.block),
    preview: doc.blocks.slice(0, 40).map((b, i, a) => `${b.kind[0]}|${(a.sec ||= detectSections(doc.blocks))[i].section ?? "-"}|${b.text.slice(0, 90)}`),
    out: kind === "pdf" ? await blobB64(res.blob) : null,
  };
}

/** The block texts of a PDF (base64), as read. */
export async function texts(b64) {
  return (await readPdf(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer)).blocks.map((b) => b.text);
}

/** The block holding `needle`: [glyph-map length minus text length, the letter its first character maps to]; [0, needle[0]] when aligned. */
export async function glyphAt(b64, needle) {
  const doc = await readPdf(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer), b = doc.blocks.find((x) => x.text.includes(needle));
  return b ? [b.gmap.length - b.text.length, doc.pages[b.page].glyphs[b.gmap[b.text.indexOf(needle)]]?.ch] : null;
}

/** The other format: a rebuilt Word file puts dates on real tab elements (texts: what it reads back as); a rebuilt PDF keeps the Word file's own bold
 * and draws what its font lacks as pictures. */
export async function rebuilt(b64, kind) {
  const doc = await (kind === "pdf" ? readPdf : readDocx)(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer);
  const { marks } = matchCV(doc.blocks, analyzeJob(SAMPLE_JOB));
  const { blob } = await buildOutput(doc, marks, STYLES, kind === "pdf" ? "docx" : "pdf");
  if (kind === "pdf") {
    const xml = await (await JSZip.loadAsync(blob)).file("word/document.xml").async("string");
    return { tabs: (xml.match(/<w:tab\/>/g) || []).length, rawTabs: /<w:t[ >][^<]*\t/.test(xml), texts: (await readDocx(await blob.arrayBuffer())).blocks.map((b) => b.text) };
  }
  const buf = await blob.arrayBuffer(), out = await readPdf(buf.slice(0)), b = out.blocks.find((x) => x.text.startsWith("Web Developer"));
  const ts = (x, i) => +(out.pages[x.page].glyphs[x.gmap[i]]?.ts ?? 0).toFixed(1);
  return { roleBold: !!b && [..."Web Developer"].every((ch, i) => ch === " " || out.pages[b.page].glyphs[b.gmap[i]]?.bold),
    texts: out.blocks.map((x) => x.text), pictures: (new TextDecoder("latin1").decode(buf).match(/\/Subtype \/Image/g) || []).length,
    sizes: out.blocks.map((x) => [ts(x, 0), ts(x, x.text.length - 1)]) }; // each block's first and last letter, in points
}

/** The links read back from both downloads of a CV (base64): [PDF, Word], each as [text, address] pairs. */
export async function links(b64, kind) {
  const read = (k, buf) => (k === "pdf" ? readPdf : readDocx)(buf);
  const doc = await read(kind, Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer);
  const { marks } = matchCV(doc.blocks, analyzeJob(SAMPLE_JOB));
  return Promise.all(["pdf", "docx"].map(async (f) => (await read(f, await (await buildOutput(doc, marks, STYLES, f)).blob.arrayBuffer()))
    .blocks.flatMap((b) => b.links.map(([s, e, u]) => [b.text.slice(s, e), u]))));
}

async function blobB64(blob) {
  const b = new Uint8Array(await blob.arrayBuffer());
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Render page n of a PDF (base64) into a canvas in #out, for screenshots. */
export async function showPdf(b64, n = 1, scale = 1.5) {
  const pdf = await openPdf(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
  const page = await pdf.getPage(n);
  const vp = page.getViewport({ scale });
  const c = document.createElement("canvas");
  c.width = vp.width; c.height = vp.height;
  document.getElementById("out").replaceChildren(c);
  await page.render({ canvas: c, viewport: vp }).promise;
  return [c.width, c.height];
}

/** Raw cosine (closest requirement) per block, for calibrating the semantic score. */
export async function semRaw(b64, kind, jobText = SAMPLE_JOB) {
  const { embed } = await import("/src/lib/semantic.js");
  const buf = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
  const doc = kind === "pdf" ? await readPdf(buf) : await readDocx(buf);
  const reqs = analyzeJob(jobText).requirements;
  const blocks = doc.blocks.filter((b) => b.text.trim().split(/\s+/).length >= 4);
  const t0 = performance.now();
  const R = await embed(reqs);
  const t1 = performance.now();
  const L = await embed(blocks.map((b) => b.text.trim()));
  const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
  return { reqs: reqs.length, firstMs: Math.round(t1 - t0), linesMs: Math.round(performance.now() - t1),
    rows: blocks.map((b, k) => [+Math.max(...R.map((r) => dot(L[k], r))).toFixed(3), b.text.trim().slice(0, 70)]).sort((a, b) => b[0] - a[0]) };
}
