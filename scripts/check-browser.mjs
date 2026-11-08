// Read → match → write → read-back round trips in a real browser, on two Word layouts (plain, table) and six kinds of PDF (LibreOffice, Chrome, pdf-lib, two columns, Ghostscript, a CV builder's).
// Usage: node scripts/check-browser.mjs   → "N checks, M FAIL" (exit 1 on failure); screenshots in shots/, block dumps in .tmp/.
import { createServer } from "vite";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { PDFDocument, PDFName, StandardFonts, rgb, pushGraphicsState, popGraphicsState, concatTransformationMatrix, drawObject } from "pdf-lib";
import { BorderStyle, Document, ExternalHyperlink, Footer, Header, HeadingLevel, Packer, PageNumber, Paragraph, ShadingType, Tab, TabStopType, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import JSZip from "jszip";
import { launch } from "./lib/browser.mjs";
import { SAMPLE_CV as cv } from "../src/lib/sample.js";

const FIX = ".tmp/fixtures";
mkdirSync("shots", { recursive: true });
mkdirSync(FIX, { recursive: true });
// sample-cv.pdf is public/sample-cv.docx exported by LibreOffice (soffice --headless --convert-to pdf), kept as a file: CI has no LibreOffice
copyFileSync("public/sample-cv.docx", `${FIX}/sample-cv.docx`);
copyFileSync("scripts/fixtures/sample-cv.pdf", `${FIX}/sample-cv.pdf`);
// gs-cv.pdf is a CV set in plain troff (groff -Tps) and converted by Ghostscript's ps2pdf, which writes some kerning as spaces
copyFileSync("scripts/fixtures/gs-cv.pdf", `${FIX}/gs-cv.pdf`);
// builder-cv.pdf is printed by Chrome from a CV-builder-style page: letter-spaced headings and FontAwesome icons (CI has no FontAwesome)
copyFileSync("scripts/fixtures/builder-cv.pdf", `${FIX}/builder-cv.pdf`);
let n = 0, fail = 0;
const check = (ok, name, info = "") => { n++; if (!ok) { fail++; console.log(`FAIL ${name} ${info}`); } };

const html = () => `<!doctype html><html><head><meta charset="utf-8"><style>
  body{font:10.5pt/1.35 Arial,Helvetica,sans-serif;margin:0;color:#222} h1{font-size:20pt;margin:0 0 4pt} h2{font-size:11.5pt;text-transform:uppercase;
  color:#1f4e79;border-bottom:1px solid #9db3cc;margin:14pt 0 5pt} .row{display:flex;justify-content:space-between;margin-top:8pt} ul{margin:3pt 0;padding-left:16pt}
  li{margin:2pt 0} .muted{color:#555}</style></head><body>
  <h1>${cv.name}</h1><div class="muted">${cv.contact}</div><h2>Summary</h2><p>${cv.summary}</p><h2>Experience</h2>
  ${cv.experience.map((x) => `<div class="row"><span><b>${x.role}</b> — ${x.org}</span><span class="muted">${x.when}</span></div>
    <ul>${x.bullets.map((t) => `<li>${t}</li>`).join("")}</ul>`).join("")}
  <h2>Skills</h2><ul>${cv.skills.map((s) => { const [a, b] = s.split(/:\s*/); return `<li><b>${a}:</b> ${b}</li>`; }).join("")}</ul>
  <h2>Education</h2>${cv.education.map((e) => `<div class="row"><span><b>${e.degree}</b>, ${e.org}</span><span class="muted">${e.when}</span></div>`).join("")}
  </body></html>`;

// A sidebar layout (contact, skills, education left; summary and experience right), as many CV templates have.
const twoCol = () => `<!doctype html><html><head><meta charset="utf-8"><style>
  body{font:10pt/1.35 Arial,Helvetica,sans-serif;margin:0;color:#222;display:grid;grid-template-columns:32% 1fr;gap:0 20pt}
  header{grid-column:1/-1} h1{font-size:20pt;margin:0 0 6pt} h2{font-size:11pt;text-transform:uppercase;color:#1f4e79;margin:12pt 0 4pt}
  ul{margin:3pt 0;padding-left:14pt} li{margin:2pt 0} aside{background:#eef3f8;padding:0 10pt 10pt} p{margin:4pt 0}</style></head><body>
  <header><h1>${cv.name}</h1></header>
  <aside><h2>Contact</h2>${cv.contact.split(" · ").map((c) => `<div>${c}</div>`).join("")}
  <h2>Skills</h2><ul>${cv.skills.map((s) => `<li>${s}</li>`).join("")}</ul>
  <h2>Education</h2>${cv.education.map((e) => `<p><b>${e.degree}</b><br>${e.org}<br>${e.when}</p>`).join("")}</aside>
  <main><h2>Summary</h2><p>${cv.summary}</p><h2>Experience</h2>
  ${cv.experience.map((x) => `<p><b>${x.role}</b> — ${x.org}<br>${x.when}</p><ul>${x.bullets.map((t) => `<li>${t}</li>`).join("")}</ul>`).join("")}</main>
  </body></html>`;

// A Word template that lays the CV out in a borderless two-cell table: a shaded sidebar (contact, skills, education) and the main column.
function tableDocx() {
  const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  const h = (text) => new Paragraph({ text, heading: HeadingLevel.HEADING_2 });
  const li = (text) => new Paragraph({ text, bullet: { level: 0 } });
  const side = [h("Contact"), ...cv.contact.split(" · ").map((c) => new Paragraph(c)), h("Skills"), ...cv.skills.map(li),
    h("Education"), ...cv.education.flatMap((e) => [new Paragraph({ children: [new TextRun({ text: e.degree, bold: true })] }), new Paragraph(e.org), new Paragraph(e.when)])];
  const main = [new Paragraph({ text: cv.name, heading: HeadingLevel.TITLE }), h("Summary"), new Paragraph(cv.summary), h("Experience"),
    ...cv.experience.flatMap((x) => [new Paragraph({ children: [new TextRun({ text: x.role, bold: true }), new TextRun(` — ${x.org}`)] }), new Paragraph(x.when), ...x.bullets.map(li)])];
  const cell = (children, w, fill) => new TableCell({ children, width: { size: w, type: WidthType.DXA }, ...(fill && { shading: { fill, type: ShadingType.CLEAR } }) });
  return Packer.toBuffer(new Document({ sections: [{ children: [new Table({
    borders: { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none },
    columnWidths: [3300, 6700], rows: [new TableRow({ children: [cell(side, 3300, "EEF3F8"), cell(main, 6700)] })],
  })] }] }));
}

// a zip bomb that lies about its size: the main part says 8 KB and unpacks to 64 MB
async function lyingDocx() {
  const z = await JSZip.loadAsync(readFileSync("public/sample-cv.docx")), name = Buffer.from("word/document.xml");
  z.file("word/document.xml", " ".repeat(64 << 20));
  const b = await z.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  for (let i = 0; i < b.length - 46; i++) { // the size field of its local header and of its central directory entry
    const [size, len, at] = { [0x04034b50]: [22, 26, 30], [0x02014b50]: [24, 28, 46] }[b.readUInt32LE(i)] || [];
    if (size && b.readUInt16LE(i + len) === name.length && b.subarray(i + at, i + at + name.length).equals(name)) b.writeUInt32LE(8192, i + size);
  }
  return b;
}

// a PDF bomb: the page's only content stream holds a line, then 300 MB of spaces, then a line pdf.js must not reach
// (pdf.js reads two tokens ahead, so the cut also takes the "q Q" before the spaces)
async function bombPdf() {
  const doc = await PDFDocument.create(), page = doc.addPage([612, 792]);
  page.node.setFontDictionary(PDFName.of("F1"), (await doc.embedFont(StandardFonts.Helvetica)).ref);
  const line = (y, s) => Buffer.from(`BT /F1 14 Tf 54 ${y} Td (${s}) Tj ET\n`);
  const ops = deflateSync(Buffer.concat([line(720, "Jane Doe, React developer"), Buffer.from("q Q"), Buffer.alloc(300 << 20, 0x20), line(690, "Hidden past the cap")]));
  page.node.set(PDFName.of("Contents"), doc.context.register(doc.context.stream(ops, { Filter: "FlateDecode" })));
  return Buffer.from(await doc.save());
}

// a TeX-made CV: no space glyphs (TJ kerns place each word, 0.15 em once justified), the hyphen glyph's text is U+00AD (LuaTeX),
// an icon whose text is its glyph name (FontAwesome under LuaTeX), and entry headers with a place and a date on the right
async function texPdf() {
  const doc = await PDFDocument.create(), page = doc.addPage([612, 792]), hex = (t) => t.split("").map((c) => c.charCodeAt(0).toString(16).padStart(4, "0")).join("");
  const font = (code, text) => doc.context.register(doc.context.obj({ Type: "Font", Subtype: "Type1", BaseFont: "Helvetica", Encoding: "WinAnsiEncoding",
    ToUnicode: doc.context.register(doc.context.stream(`/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CMapName /T def /CMapType 2 def
1 begincodespacerange <00> <FF> endcodespacerange 1 beginbfchar <${code}> <${hex(text)}> endbfchar endcmap CMapName currentdict /CMap defineresource pop end end`)) }));
  page.node.setFontDictionary(PDFName.of("F1"), font("2D", "\u00ad"));
  page.node.setFontDictionary(PDFName.of("F2"), font("41", "HOUSE-CHIMNEY"));
  page.node.setFontDictionary(PDFName.of("F3"), font("41", "📱"));
  const at = (x, y, words, size = 10) => `BT /F1 ${size} Tf ${x} ${y} Td [${words.split(" ").map((w) => `(${w})`).join("-150")}] TJ ET\n`;
  const ops = at(54, 740, "Jane Doe", 20) + "BT /F2 10 Tf 54 716 Td (A) Tj /F1 10 Tf [-400(Seoul,)-150(Korea)] TJ ET\n" +
    at(54, 680, "Acme Corp") + at(280, 680, "Berlin") + at(462, 680, "Sep. 2019 - Mar. 2021") + at(54, 667, "Senior Engineer") + at(520, 667, "Remote") +
    at(54, 650, "Built cross-cluster tooling in React and TypeScript.") + "BT /F3 10 Tf 54 630 Td (A) Tj /F1 10 Tf [-250(jane@x.com)] TJ ET\n";
  page.node.set(PDFName.of("Contents"), doc.context.register(doc.context.stream(ops)));
  return Buffer.from(await doc.save());
}

// a CV photo past a phone's canvas limit (4800 × 3600), and a tiny JPEG whose header claims 65500 × 65500 (the PDF says 100 × 100)
async function photoPdf(photo, tiny) {
  const doc = await PDFDocument.create(), page = doc.addPage([612, 792]);
  page.drawText("Jane Doe, React developer", { x: 54, y: 720, size: 12, font: await doc.embedFont(StandardFonts.Helvetica) });
  page.drawImage(await doc.embedJpg(photo), { x: 54, y: 500, width: 144, height: 108 });
  const big = Buffer.from(tiny);
  for (let i = 2; ; i += 2 + big.readUInt16BE(i + 2)) if (big[i + 1] >= 0xc0 && big[i + 1] <= 0xc2) { big.writeUInt16BE(65500, i + 5); big.writeUInt16BE(65500, i + 7); break; }
  page.node.setXObject(PDFName.of("Big"), doc.context.register(doc.context.stream(big, { Type: "XObject", Subtype: "Image", Width: 100, Height: 100, ColorSpace: "DeviceRGB", BitsPerComponent: 8, Filter: "DCTDecode" })));
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(100, 0, 0, 100, 300, 500), drawObject("Big"), popGraphicsState());
  return Buffer.from(await doc.save());
}

async function stdFontPdf() {
  const pdf = await PDFDocument.create();
  const [reg, bold] = await Promise.all([pdf.embedFont(StandardFonts.Helvetica), pdf.embedFont(StandardFonts.HelveticaBold)]);
  let page = pdf.addPage([612, 792]), y = 740;
  const wrap = (t, f, s, w) => t.split(" ").reduce((ls, word) => {
    const l = ls[ls.length - 1];
    if (l && f.widthOfTextAtSize(l + " " + word, s) <= w) ls[ls.length - 1] = l + " " + word; else ls.push(word);
    return ls;
  }, []);
  const line = (t, f = reg, s = 10.5, x = 54, w = 504) => {
    for (const l of wrap(t, f, s, w)) {
      if (y < 60) { page = pdf.addPage([612, 792]); y = 740; }
      page.drawText(l, { x, y, size: s, font: f, color: rgb(0.13, 0.13, 0.13) });
      y -= s * 1.35;
    }
  };
  const head = (t) => { y -= 8; line(t.toUpperCase(), bold, 11.5); y -= 2; };
  line(cv.name, bold, 20); line(cv.contact, reg, 9.5);
  head("Summary"); line(cv.summary);
  head("Experience");
  for (const x of cv.experience) { y -= 4; line(`${x.role} — ${x.org}`.replace("—", "-"), bold, 10.5); for (const t of x.bullets) line("• " + t, reg, 10.5, 66, 490); }
  head("Skills"); for (const s of cv.skills) line("• " + s, reg, 10.5, 66, 490);
  head("Education"); for (const e of cv.education) line(`${e.degree}, ${e.org}  ${e.when}`.replace("–", "-"));
  return pdf.save();
}

// Scan only the harness for deps, so Vite does not reload the page mid-run after discovering one.
const server = await createServer({ server: { port: 0, host: "127.0.0.1" }, logLevel: "error", optimizeDeps: { entries: ["scripts/harness.html"], include: ["docx", "pdf-lib", "@pdf-lib/fontkit"] } }); // the rebuild loads these lazily: pre-bundled, or Vite reloads the page mid-check
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await launch();
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 1300 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  await page.setContent(html());
  writeFileSync(`${FIX}/chrome-cv.pdf`, await page.pdf({ format: "Letter", margin: { top: "0.6in", bottom: "0.6in", left: "0.7in", right: "0.7in" } }));
  writeFileSync(`${FIX}/stdfont-cv.pdf`, await stdFontPdf());
  writeFileSync(`${FIX}/table-cv.docx`, await tableDocx());
  await page.setContent(twoCol());
  writeFileSync(`${FIX}/twocol-cv.pdf`, await page.pdf({ format: "Letter", margin: { top: "0.5in", bottom: "0.5in", left: "0.5in", right: "0.5in" } }));

  // a link behind a word (Chrome writes a link annotation, Word a w:hyperlink) next to a typed address
  await page.setContent(`<h1>Jane Doe</h1><p><a href="https://example.com/work">Portfolio</a> · jane@example.com</p><p>Web developer: React, TypeScript.</p>`);
  writeFileSync(`${FIX}/link-cv.pdf`, await page.pdf({ format: "Letter" }));
  writeFileSync(`${FIX}/link-cv.docx`, await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph("Jane Doe"),
    new Paragraph({ children: [new ExternalHyperlink({ link: "https://example.com/work", children: [new TextRun("Portfolio")] }), new TextRun(" · jane@example.com")] }),
    new Paragraph("Web developer: React, TypeScript.")] }] })));

  // characters the PDF font lacks (pdf.js ships a 669-character Liberation): an emoji, the peso sign, a Chinese name
  writeFileSync(`${FIX}/glyph-cv.docx`, await Packer.toBuffer(new Document({ sections: [{ children:
    ["Jane Doe", "📱 +63 917 000 0000 · ₱5M budget · 张伟", "Web developer: React, TypeScript."].map((t) => new Paragraph(t)) }] })));
  // the name and contact line in the page header and a page number in the footer, as many Word templates have them
  writeFileSync(`${FIX}/header-cv.docx`, await Packer.toBuffer(new Document({ sections: [{
    headers: { default: new Header({ children: [new Paragraph("Jane Doe"), new Paragraph("jane@example.com · Manila")] }) },
    footers: { default: new Footer({ children: [new Paragraph({ children: [new TextRun({ children: ["Page ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES] })] })] }) },
    children: ["Experience", "Web developer: React, TypeScript."].map((t) => new Paragraph(t)) }] })));

  // the name with the contact details beside it on a right tab, as many templates have it
  writeFileSync(`${FIX}/name-cv.docx`, await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph({ tabStops: [{ type: TabStopType.RIGHT, position: 9000 }],
    children: [new TextRun("Jane Doe"), new TextRun({ children: [new Tab(), "jane@example.com · +1 555 0100 · Portland, OR"] })] }), ...["Experience", "Web developer: React, TypeScript."].map((t) => new Paragraph(t))] }] })));

  await page.goto(base + "scripts/harness.html");
  await page.waitForFunction(() => window.ready, null, { timeout: 60000 });
  const cases = [["sample-cv.docx", "docx"], ["table-cv.docx", "docx"], ["sample-cv.pdf", "pdf"], ["chrome-cv.pdf", "pdf"], ["stdfont-cv.pdf", "pdf"], ["twocol-cv.pdf", "pdf"], ["gs-cv.pdf", "pdf"], ["builder-cv.pdf", "pdf"]];
  const rb = await page.evaluate(([a, b, c, d, e]) => Promise.all([window.h.rebuilt(a, "pdf"), window.h.rebuilt(b, "docx"), window.h.rebuilt(c, "docx"), window.h.rebuilt(d, "docx"), window.h.rebuilt(e, "docx")]),
    ["builder-cv.pdf", "sample-cv.docx", "glyph-cv.docx", "header-cv.docx", "name-cv.docx"].map((f) => readFileSync(`${FIX}/${f}`).toString("base64")));
  check(rb[0].tabs >= 3 && !rb[0].rawTabs, "PDF → Word rebuild: dates on Word tab stops", JSON.stringify(rb[0]));
  check(rb[1].roleBold, "Word → PDF rebuild keeps the Word file's bold", JSON.stringify(rb[1].roleBold));
  check(rb[2].pictures === 6 && rb[2].texts.some((t) => t.includes("+63 917 000 0000 · 5M budget ·")),
    "Word → PDF rebuild: what the font lacks (📱, ₱, 张伟) is drawn as pictures (each image + its alpha mask), in line with the text", JSON.stringify(rb[2]));
  check(JSON.stringify(rb[3].texts) === JSON.stringify(["Jane Doe", "jane@example.com · Manila", "Experience", "Web developer: React, TypeScript."]),
    "Word → PDF rebuild: the name and contact line in the page header come first, the page number does not come", JSON.stringify(rb[3].texts));
  check(rb[4].sizes[0][0] === 20 && rb[4].sizes.find((_, i) => rb[4].texts[i].includes("Portland, OR"))?.[1] === 10.5,
    "Word → PDF rebuild: a name with contact details beside it is still the name, the details at body size", JSON.stringify([rb[4].texts, rb[4].sizes]));
  const lk = await page.evaluate((fs) => Promise.all(fs.map(([b, k]) => window.h.links(b, k))),
    [["link-cv.pdf", "pdf"], ["link-cv.docx", "docx"]].map(([f, k]) => [readFileSync(`${FIX}/${f}`).toString("base64"), k]));
  const own = [["Portfolio", "https://example.com/work"]], all = [...own, ["jane@example.com", "mailto:jane@example.com"]];
  check(JSON.stringify(lk) === JSON.stringify([[own, all], [all, own]]), "links survive both downloads: the file's own in place, typed addresses too when rebuilt", JSON.stringify(lk));
  const [tt, tr, ga] = await page.evaluate((b) => Promise.all([window.h.texts(b), window.h.rebuilt(b, "pdf"), window.h.glyphAt(b, "jane@")]), (await texPdf()).toString("base64"));
  check(["Jane Doe", "Seoul, Korea", "Acme Corp\tBerlin\tSep. 2019 - Mar. 2021", "Senior Engineer\tRemote", "Built cross-cluster tooling in React and TypeScript."].every((t) => tt.includes(t)) &&
    tr.texts.some((t) => t.includes("Berlin")), "TeX PDF: words apart without space glyphs, U+00AD hyphens kept, icon names dropped, entry headers apart, the middle column kept when rebuilt",
    JSON.stringify([tt, tr.texts]));
  check(ga?.[0] === 0 && ga[1] === "j" && tr.texts.some((t) => t.startsWith("📱")), "an emoji counts two text units in the glyph map too, so marks after it land on their own letters and a rebuild keeps it whole", JSON.stringify(ga));
  for (const [file, kind] of cases) {
    const b64 = readFileSync(`${FIX}/${file}`).toString("base64");
    let r;
    try { r = await page.evaluate(([b, k]) => window.h.roundTrip(b, k), [b64, kind]); }
    catch (e) { check(false, `${file} round trip`, e.message.split("\n")[0]); continue; }
    writeFileSync(`.tmp/blocks-${file}.txt`, r.preview.join("\n"));
    console.log(`${file}: ${r.blocks} blocks, ${r.marks} marks, ${r.keywords} keywords, bold ${r.boldOk}/${r.boldChars}, fallback ${r.fallback}, read ${r.readMs}ms, write ${r.writeMs}ms`);
    check(r.blocks >= 15, `${file} block count`, r.blocks);
    check(r.sameText, `${file} text survives the write`, JSON.stringify(r.firstDiff));
    check(r.keywords >= 10, `${file} keyword marks`, r.keywords);
    check(r.boldChars > 0 && r.boldOk === r.boldChars, `${file} keywords bold`, `${r.boldOk}/${r.boldChars}`);
    check(r.doubled === 0, `${file} no bold drawn over bold text`, r.doubled);
    if (file === "table-cv.docx") {
      const where = r.lines.map((i) => r.sections[i]);
      check(where.includes("experience") && where.every((x) => x === "experience" || x === "summary"), "table layout: highlighted lines are in the main column", where.join(","));
    }
    if (file === "builder-cv.pdf") {
      check(r.preview.includes("h|education|EDUCATION") && r.preview.some((p) => p.startsWith("p|-|jordan.rivera@")) && !r.texts.some((t) => /[\ue000-\uf8ff]/u.test(t)),
        "CV-builder PDF: letter-spaced heading read, icons dropped", r.preview.filter((p) => /rivera@|E D U|EDUC/.test(p)).join(" | "));
    }
    if (file === "gs-cv.pdf") {
      const has = (w) => r.texts.some((t) => t.includes(w));
      check(has("Web Developer") && has("Organized") && has("fintech") && r.texts.some((t) => t.startsWith("Tools:")), "Ghostscript PDF: words whole (the ﬁ ligature too), label lines apart",
        r.texts.filter((t) => /Dev|Org|Languages/.test(t)).join(" | "));
    }
    if (file === "twocol-cv.pdf") {
      // each sidebar item and each bullet is whole in one block, with nothing from the other column mixed in
      const norm = (t) => t.replace(/\s+/g, " ").trim(), side = cv.skills, main = cv.experience.flatMap((x) => x.bullets);
      const apart = (items, other) => items.filter((t) => !r.texts.some((b) => norm(b).includes(t) && !other.some((o) => norm(b).includes(o.slice(0, 20)))));
      const broken = [...apart(side, main), ...apart(main, side)];
      check(broken.length === 0, "two columns stay apart", `${broken.length} items, e.g. ${broken[0]}`);
    }
    if (r.out) {
      writeFileSync(`.tmp/out-${file}`, Buffer.from(r.out, "base64"));
      await page.evaluate((b) => window.h.showPdf(b, 1), r.out);
      await page.locator("#out canvas").screenshot({ path: `shots/out-${file}.png` });
    }
  }
  const bomb = await page.evaluate(async (b) => {
    const t = performance.now();
    try { await window.h.roundTrip(b, "docx"); return "read"; } catch (e) { return `${e.constructor.name} after ${Math.round(performance.now() - t)} ms: ${e.message}`; }
  }, (await lyingDocx()).toString("base64"));
  check(bomb.startsWith("InputError"), "a Word part that unpacks past its stated size is refused", bomb);
  const pb = await page.evaluate(async (b) => ({ texts: await window.h.texts(b), write: await window.h.roundTrip(b, "pdf").then(() => "written", (e) => `${e.constructor.name}: ${e.message}`) }),
    (await bombPdf()).toString("base64"));
  check(pb.texts.join(" | ") === "Jane Doe, React developer" && /^InputError: Part of this PDF unpacks to more than 256 MB/.test(pb.write),
    "a PDF stream that unpacks past 256 MB is read up to there, and not rebuilt as a PDF", JSON.stringify(pb).slice(0, 300));
  const jpegs = await page.evaluate(() => Promise.all([[4800, 3600, "#c33"], [16, 16, "#33c"]].map(async ([w, h, color]) => {
    const c = new OffscreenCanvas(w, h), g = c.getContext("2d");
    g.fillStyle = color; g.fillRect(0, 0, w, h);
    const b = new Uint8Array(await (await c.convertToBlob({ type: "image/jpeg", quality: 0.9 })).arrayBuffer());
    let s = "";
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
    return btoa(s);
  })));
  const [warned, shown] = await Promise.all([
    page.waitForEvent("console", { predicate: (m) => m.text().includes("over 50 megapixels"), timeout: 30000 }).then(() => true, () => false),
    page.evaluate(async (b) => {
      const texts = await window.h.texts(b);
      await window.h.showPdf(b, 1); // scale 1.5
      const g = document.querySelector("#out canvas").getContext("2d"), px = (x, y) => [...g.getImageData(x * 1.5, (792 - y) * 1.5, 1, 1).data.slice(0, 3)];
      return { texts, photo: px(126, 554), big: px(350, 550) };
    }, (await photoPdf(...jpegs.map((j) => Buffer.from(j, "base64")))).toString("base64")),
  ]);
  check(shown.texts.join(" | ") === "Jane Doe, React developer" && shown.photo[0] > 150 && shown.photo[1] < 100 && shown.photo[2] < 100,
    "a photo past a phone's canvas limit is read past and still drawn in the preview", JSON.stringify(shown));
  check(warned && shown.big.every((v) => v > 240), "an image whose JPEG header claims 65500 × 65500 is left out before it decodes", `${warned} ${shown.big}`);
  check(errors.length === 0, "no page errors", errors.slice(0, 3).join(" | "));
} finally {
  await browser.close();
  await server.close();
}
console.log(`${n} checks, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
