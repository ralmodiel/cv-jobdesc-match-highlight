// End-to-end check of the BUILT app (production CSP): the sample flow, both downloads, a PDF re-upload, no request
// leaving localhost, no CSP violation, no page error, axe in light and dark, no sideways scroll at phone width, a long PDF
// within a phone's canvas memory. BROWSER=firefox|webkit runs it in those engines.
// Usage: npm run build && node scripts/check-e2e.mjs   → "N checks, M FAIL" (exit 1 on failure); screenshots in shots/
import { preview } from "vite";
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { PDFDocument, StandardFonts } from "pdf-lib";
import JSZip from "jszip";
import { launch } from "./lib/browser.mjs";
import { SAMPLE_JOB } from "../src/lib/sample.js";

const AXE = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
let checks = 0, fails = 0;
const check = (ok, what, detail = "") => { checks++; if (!ok) { fails++; console.log(`FAIL ${what}${detail ? `: ${String(detail).slice(0, 400)}` : ""}`); } };
const isLocal = (u) => !/^(https?|wss?):/.test(u) || ["127.0.0.1", "localhost"].includes(new URL(u).hostname);

mkdirSync("shots", { recursive: true });
const server = await preview({ preview: { port: 0, host: "127.0.0.1" }, logLevel: "error" });
const url = server.resolvedUrls.local[0];
const browser = await launch();

async function open(viewport, scheme = "light", extra = {}) {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true, colorScheme: scheme, ...extra });
  const page = await ctx.newPage();
  const bad = { external: [], errors: [] }, gets = {}; // gets: requests per language-model file
  page.on("request", (r) => {
    if (!isLocal(r.url())) bad.external.push(r.url());
    const f = r.url().match(/(model_quantized\.onnx|tokenizer\.json|ort-wasm-simd-threaded\.wasm)$/)?.[1];
    if (f) gets[f] = (gets[f] || 0) + 1;
  });
  page.on("pageerror", (e) => bad.errors.push(String(e)));
  // WebKit applies the page's CSP to the <style> Playwright adds for each screenshot; that code has no source (file "", line 0)
  page.on("console", (m) => { if (m.type() === "error" && !(m.location().lineNumber === 0 && /^Refused to apply a stylesheet/.test(m.text()))) bad.errors.push(m.text()); });
  await page.addInitScript(() => {
    window.__csp = [];
    window.__pct = []; // the language model's progress messages
    const W = window.Worker;
    window.Worker = class extends W { constructor(...a) { super(...a); this.addEventListener("message", (e) => { if (e.data?.type === "progress") window.__pct.push(e.data.pct); }); } };
    document.addEventListener("securitypolicyviolation", (e) => { if (!(e.blockedURI === "inline" && !e.sourceFile)) window.__csp.push(`${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber}`); });
  });
  await page.goto(url);
  return { ctx, page, bad, gets };
}
const drawn = (page) => page.waitForFunction(() => {
  const box = document.querySelector("#preview .desk > div:last-child");
  return box && !box.classList.contains("stale") && (box.querySelector("canvas") || box.firstElementChild?.shadowRoot?.querySelector("section.docx"));
}, null, { timeout: 30000 });
const settle = (page) => page.waitForTimeout(400).then(() => drawn(page));
// each paragraph of the Word preview: [bottom of its last line, right end of its last line (px from the page's corner), its bold spans]
const ends = (page) => page.evaluate(() => {
  const root = document.querySelector("#preview .desk > div:last-child").firstElementChild.shadowRoot, o = root.querySelector("section.docx").getBoundingClientRect();
  return [...root.querySelectorAll("p")].map((p) => {
    const r = document.createRange();
    r.selectNodeContents(p);
    const last = [...r.getClientRects()].filter((x) => x.width).at(-1);
    return [(last?.bottom ?? 0) - o.top, (last?.right ?? 0) - o.left, [...p.querySelectorAll("span")].filter((x) => +getComputedStyle(x).fontWeight >= 600).length];
  });
});
async function download(page, name) {
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /^Download/ }).click()]);
  const bytes = readFileSync(await dl.path());
  return { name: dl.suggestedFilename(), head: bytes.subarray(0, 5).toString("latin1"), path: await dl.path(), size: bytes.length, want: name };
}
async function axe(page, label) {
  await page.evaluate(AXE);
  const v = await page.evaluate(async () => (await window.axe.run({ exclude: [["#preview .desk"]] }, { resultTypes: ["violations"] }))
    .violations.map((x) => `${x.id} (${x.impact}) x${x.nodes.length}: ${x.nodes[0].target.join(" ")}`));
  check(v.length === 0, `axe ${label}`, v.join(" | "));
}

try {
  // Desktop: sample (Word) → highlights in the preview → toggle a term → download Word and PDF → upload that PDF.
  const { ctx, page, bad, gets } = await open({ width: 1280, height: 900 });
  await axe(page, "empty page");
  const privacy = page.locator("details.privacy"), isOpen = () => privacy.evaluate((d) => d.open);
  await privacy.locator("summary").click();
  await page.keyboard.press("Escape");
  const escaped = !(await isOpen());
  await privacy.locator("summary").click();
  await page.mouse.click(8, 500);
  check(escaped && !(await isOpen()), "privacy note closes on Escape and on a click outside it");
  await page.getByRole("button", { name: /sample CV/i }).click();
  await drawn(page);
  const focused = () => page.evaluate(() => document.activeElement?.id || document.activeElement?.getAttribute("aria-label") || document.activeElement?.textContent);
  check(await focused() === "Replace CV", "focus moves to Replace when the CV arrives (the sample button is gone)", await focused());
  const marks = await page.evaluate(() => {
    const root = document.querySelector("#preview .desk > div:last-child").firstElementChild.shadowRoot;
    let bold = 0, hl = 0;
    for (const s of root.querySelectorAll("span")) {
      const cs = getComputedStyle(s);
      if (+cs.fontWeight >= 600) bold++;
      if (cs.backgroundColor !== "rgba(0, 0, 0, 0)" && cs.backgroundColor !== "transparent") hl++;
    }
    // px between the right margin and the end of the text after each tab (the dates, on right tab stops)
    const tabs = [...root.querySelectorAll(".docx-tab-stop")].map((t) => {
      const p = t.closest("p"), r = document.createRange();
      r.setStartAfter(t);
      r.setEnd(p, p.childNodes.length);
      return Math.round(p.getBoundingClientRect().right - r.getBoundingClientRect().right);
    });
    return { bold, hl, tabs };
  });
  check(marks.bold > 5 && marks.hl > 0, "word preview shows bold and highlight", JSON.stringify(marks));
  check(marks.tabs.length >= 3 && marks.tabs.every((g) => g >= 0 && g <= 2), "word preview puts tab-stop dates at the right margin", marks.tabs.join(" "));
  const t0 = Date.now();
  const ranked = await page.getByText(/ranked by meaning, by a language model/).waitFor({ timeout: 90000 }).then(() => true, () => false);
  check(ranked, "language model loads from this site and ranks lines", await page.locator("#step-terms [role=status]").textContent().catch(() => ""));
  console.log(`model ready ${Date.now() - t0} ms after the sample was drawn`);
  const pct = await page.evaluate(() => window.__pct);
  check(pct.length >= 20 && pct.at(-1) === 100 && pct.every((p, i) => !i || p > pct[i - 1]) && Object.keys(gets).length === 3 && Object.values(gets).every((n) => n === 1),
    "the language model downloads once, its progress counting up to 100%", `${pct.length} steps (${pct.slice(0, 3)}…${pct.at(-1)}), ${JSON.stringify(gets)}`);
  const chips = page.locator("#step-terms button.chip");
  check((await chips.count()) >= 8, "matched-term chips", await chips.count());
  await page.screenshot({ path: "shots/e2e-desktop.png" });
  await axe(page, "light, sample loaded");

  const first = chips.first();
  await first.click();
  check((await first.getAttribute("aria-pressed")) === "false", "chip switches off");
  await first.click();
  await settle(page);
  const bolded = await ends(page);
  // bold is wider, so a word made bold is set closer by the difference, in whole twips rounded up (docx.js narrow): each such word
  // is as wide as plain, or up to a twip (0.07 px) a letter narrower, whatever font the device draws instead of the CV's
  const fit = await page.evaluate(() => {
    const root = document.querySelector("#preview .desk > div:last-child").firstElementChild.shadowRoot, off = [];
    let n = 0;
    for (const s of root.querySelectorAll("span")) {
      if (!parseFloat(s.style.letterSpacing) || +getComputedStyle(s).fontWeight < 600 || s.querySelector("span")) continue;
      const shown = s.getBoundingClientRect().width, { letterSpacing, fontWeight } = s.style;
      n++;
      Object.assign(s.style, { letterSpacing: "0px", fontWeight: "400" });
      const d = shown - s.getBoundingClientRect().width;
      Object.assign(s.style, { letterSpacing, fontWeight });
      if (d > 0.5 || d < -(0.07 * s.textContent.length + 0.5)) off.push(`${s.textContent.slice(0, 20)} ${d.toFixed(1)}`);
    }
    return { n, off };
  });
  await page.getByRole("radio", { name: "Underline" }).first().check();
  await settle(page);
  // underlined instead, no paragraph ends later (one may end earlier: a word that just fits once its line is a twip narrower)
  const plain = await ends(page), sum = (a) => a.reduce((n, x) => n + x[2], 0);
  const later = bolded.filter(([y, x], i) => y > plain[i]?.[0] + 2 || (Math.abs(y - plain[i]?.[0]) <= 2 && x > plain[i]?.[1] + 2));
  check(bolded.length === plain.length && sum(bolded) > sum(plain) && !later.length && fit.n >= 5 && !fit.off.length, "bold words take no more room: as wide as plain, no Word preview line ends later",
    `${bolded.length}/${plain.length} paragraphs, ${sum(bolded)}/${sum(plain)} bold spans, ${later.length} end later, ${fit.n} set closer, off: ${fit.off.join(", ")}`);

  const docx = await download(page);
  const named = await page.getByRole("status").filter({ hasText: "Downloaded" }).textContent({ timeout: 3000 }).catch(() => "");
  check(docx.name === "sample-cv-highlighted.docx" && docx.head.startsWith("PK") && named.includes(docx.name), "Word download, and the page names the file it saved", JSON.stringify({ ...docx, named }));
  await page.getByRole("radio", { name: "PDF" }).check();
  await settle(page);
  check(await page.getByRole("status").filter({ hasText: "Downloaded" }).count() === 0, "the saved-file line goes once the output changes");
  check(await page.locator("#preview canvas").count() >= 1, "PDF preview canvases");
  check(await page.getByText(/rebuilt in a clean one-column layout/).isVisible(), "rebuilt-layout note");
  const pdf = await download(page);
  check(pdf.name === "sample-cv-highlighted.pdf" && pdf.head === "%PDF-", "PDF download", JSON.stringify(pdf));
  const info = await PDFDocument.load(readFileSync(pdf.path), { updateMetadata: false });
  check(info.getProducer() === undefined && info.getCreator() === undefined, "the rebuilt PDF names no tool", `${info.getProducer()} / ${info.getCreator()}`);

  await page.locator('input[type="file"]').setInputFiles({ name: "my-cv.pdf", mimeType: "application/pdf", buffer: readFileSync(pdf.path) });
  await page.getByText("my-cv.pdf", { exact: true }).waitFor();
  await drawn(page);
  check(await page.locator("#step-terms button.chip").count() >= 8, "PDF upload matches terms");
  const same = await download(page);
  check(same.name === "my-cv-highlighted.pdf" && same.head === "%PDF-", "PDF in, PDF out", JSON.stringify(same));
  await page.getByRole("radio", { name: "Word" }).check();
  await settle(page);
  const rebuilt = await download(page);
  check(rebuilt.name === "my-cv-highlighted.docx" && rebuilt.head.startsWith("PK"), "PDF in, Word out (rebuilt)", JSON.stringify(rebuilt));
  const core = await (await JSZip.loadAsync(readFileSync(rebuilt.path))).file("docProps/core.xml").async("string");
  check(!/Un-named|CV Highlighter|<dc:creator|lastModifiedBy/.test(core), "the rebuilt Word file names no author or tool", core.slice(0, 400));

  await page.locator('input[type="file"]').setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  check(await page.getByRole("alert").filter({ hasText: /not a PDF or a Word.*current CV is unchanged/ }).waitFor({ timeout: 5000 }).then(() => true, () => false), "rejects a non-CV file");

  // Clear keeps the keyboard in the job box; an ad the parser cannot read is not a dead end; a new ad starts afresh;
  // a too-long paste says what was cut; typing is announced once it stands still, not per keystroke
  const clearJob = page.getByRole("button", { name: "Clear the job description" });
  await clearJob.focus();
  await page.keyboard.press("Enter");
  check(await focused() === "job" && !(await page.locator("#job").inputValue()), "Clear (keyboard) empties the job and keeps focus in it", await focused());
  await page.locator("#job").fill("We are a friendly team in a lovely office. Come and join us for a fun journey together and enjoy lunches every Friday. Everyone here is kind, curious and happy to help, and we would love to meet you soon.");
  const stuck = await page.getByText(/No terms found in this ad/).waitFor({ timeout: 5000 }).then(() => true, () => false);
  check(stuck && await page.getByText(/No terms to mark yet/).isVisible(), "an ad with no terms says so in step 3 and the preview");
  await page.locator("#add-term").fill("forklift");
  await page.keyboard.press("Enter");
  const own = page.locator("#step-terms button.chip", { hasText: "forklift" });
  check(await own.waitFor({ timeout: 5000 }).then(() => true, () => false) && await focused() === "add-term", "a term added to that ad becomes a chip, and focus stays in the box", await focused());
  await page.locator("#job").fill(SAMPLE_JOB); // pasted over the old ad
  await settle(page);
  check(await own.count() === 0 && await page.locator("#step-terms button.chip").count() >= 8, "a new ad starts without the old ad's added terms");
  await page.locator("#job").fill(SAMPLE_JOB.repeat(Math.ceil(41000 / SAMPLE_JOB.length)));
  check(await page.getByText(/Only the first 40,000 characters fit/).waitFor({ timeout: 5000 }).then(() => true, () => false), "a paste over 40,000 characters says it was cut");
  await page.locator("#job").fill(SAMPLE_JOB);
  await settle(page);
  await page.evaluate(() => {
    window.__said = [];
    new MutationObserver((ms) => { for (const m of ms) { const live = (m.target.nodeType === 1 ? m.target : m.target.parentElement).closest("[aria-live],[role=status],[role=alert]"); if (live?.textContent) window.__said.push(live.textContent); } })
      .observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  await page.locator("#job").evaluate((el) => el.setSelectionRange(el.value.length, el.value.length));
  await page.keyboard.type("\nNice to have: Kubernetes, Terraform, GraphQL and Storybook for the design system.", { delay: 15 });
  await page.waitForTimeout(2500);
  const said = await page.evaluate(() => window.__said);
  check(said.length >= 1 && said.length <= 2, "typing in the job is announced once it settles, not per keystroke", `${said.length}: ${said.join(" | ")}`);

  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForTimeout(500); // colour transitions
  await page.screenshot({ path: "shots/e2e-desktop-dark.png" });
  await axe(page, "dark");
  await page.getByRole("button", { name: "Remove CV" }).focus();
  await page.keyboard.press("Enter");
  check(await focused() === "Choose your CV (PDF or Word)", "Remove CV (keyboard) moves focus to the file picker", await focused());
  check((await page.evaluate(() => window.__csp)).length === 0, "no CSP violations", (await page.evaluate(() => window.__csp)).join(" | "));
  check(bad.external.length === 0, "no request leaves localhost", bad.external.join(" "));
  check(bad.errors.length === 0, "no page errors", bad.errors.join(" | "));
  await ctx.close();

  // Phone: same flow, nothing wider than the screen.
  const phone = await open({ width: 360, height: 780 });
  const warm = phone.page.waitForRequest(/model_quantized\.onnx$/, { timeout: 15000 }).then(() => true, () => false);
  await phone.page.locator("textarea").fill(SAMPLE_JOB);
  check(await warm, "the model starts loading once a job is pasted, before any CV");
  await phone.page.getByRole("button", { name: /sample CV/i }).click();
  await drawn(phone.page);
  check(await phone.page.waitForFunction(() => Math.abs(document.getElementById("preview").getBoundingClientRect().top - 16) < 24, null, { timeout: 5000 })
    .then(() => true, () => false), "phone: the preview scrolls into view when the CV arrives", await phone.page.evaluate(() => document.getElementById("preview").getBoundingClientRect().top));
  const wide = await phone.page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  check(wide[0] <= wide[1], "no sideways scroll at 360px", wide.join(" > "));
  await phone.page.screenshot({ path: "shots/e2e-phone.png", fullPage: true });
  await axe(phone.page, "phone");
  check(await phone.page.evaluate(() => !!([...document.querySelectorAll("#preview button")].find((b) => /^Download/.test(b.textContent))
    .compareDocumentPosition(document.querySelector("#step-terms button.chip")) & Node.DOCUMENT_POSITION_FOLLOWING)), "phone: Download comes before the term chips in focus order");
  const rows = await phone.page.evaluate(() => {
    const r = (el) => el.getBoundingClientRect(), mid = (el) => r(el).top + r(el).height / 2, b = [...document.querySelectorAll("#preview button, #step-cv button")];
    const dl = b.find((x) => /^Download/.test(x.textContent)), zoom = b.find((x) => x.textContent === "Zoom in"), rep = b.find((x) => /^Replace/.test(x.textContent));
    return [Math.round(mid(dl) - mid(document.querySelector("#preview .seg"))), Math.round(r(rep).top - r(document.querySelector('#step-cv [title="sample-cv.docx"]')).bottom), zoom ? Math.round(r(zoom).width) : 0];
  });
  check(Math.abs(rows[0]) <= 4 && rows[1] < 0 && rows[2] > 60, "phone: Download sits beside the format, Replace beside the file name, and Zoom in is worded", rows.join(" "));
  await phone.page.getByRole("button", { name: "Zoom in" }).click();
  await settle(phone.page);
  const zoomed = await phone.page.evaluate(() => {
    const desk = document.querySelector("#preview .desk"), box = desk.lastElementChild;
    const sheet = box.querySelector("canvas") || box.firstElementChild.shadowRoot.querySelector("section.docx");
    return [Math.round(sheet.getBoundingClientRect().width), desk.scrollWidth - desk.clientWidth, desk.tabIndex, document.documentElement.scrollWidth - innerWidth];
  });
  check(zoomed[0] >= 600 && zoomed[1] > 0 && zoomed[2] === 0 && zoomed[3] <= 0, "phone: Zoom in shows the page full size in a keyboard-scrollable desk", zoomed.join(" "));
  check(phone.bad.errors.length === 0 && phone.bad.external.length === 0, "phone: no errors or external requests", [...phone.bad.errors, ...phone.bad.external].join(" | "));
  await phone.ctx.close();

  // A long PDF zoomed in on a 3x phone stays within the canvas memory iOS Safari will draw, and a redraw frees the pages it replaces.
  const long = await PDFDocument.create(), font = await long.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 30; i++) long.addPage([612, 792]).drawText(`Page ${i}: built React and TypeScript apps with accessible UI.`, { x: 54, y: 720, size: 11, font });
  const hi = await open({ width: 360, height: 780 }, "light", { deviceScaleFactor: 3 });
  await hi.page.locator("textarea").fill(SAMPLE_JOB);
  await hi.page.locator("#step-cv input[type=file]").setInputFiles({ name: "long-cv.pdf", mimeType: "application/pdf", buffer: Buffer.from(await long.save()) });
  await drawn(hi.page);
  await hi.page.getByRole("button", { name: "Zoom in" }).click();
  await settle(hi.page);
  const px = await hi.page.evaluate(() => [...document.querySelectorAll("#preview canvas")].map((c) => c.width * c.height));
  await hi.page.evaluate(() => { window.__old = [...document.querySelectorAll("#preview canvas")]; document.querySelector("#step-terms button.chip").click(); });
  await hi.page.waitForFunction(() => document.querySelector("#preview canvas") !== window.__old[0], null, { timeout: 30000 });
  const freed = await hi.page.evaluate(() => window.__old.every((c) => c.width === 0));
  const total = px.reduce((a, b) => a + b, 0);
  check(px.length === 30 && total <= 40e6 && Math.max(...px) <= 16e6 && freed, "phone 3x: a 30-page PDF zoomed in stays within iOS Safari's canvas memory, and a redraw frees the old pages",
    `${px.length} pages, ${(total / 1e6).toFixed(1)} Mpx, old freed ${freed}`);
  console.log(`30-page PDF zoomed at 3x: ${(total / 1e6).toFixed(1)} Mpx in canvases`);
  await hi.ctx.close();

  // Word preview fidelity: each addition below was drawn wrong or not at all by docx-preview alone.
  const zip = await JSZip.loadAsync(readFileSync("public/sample-cv.docx")), docPath = "word/document.xml";
  const body = (await zip.file(docPath).async("string")).replace(/<w:sectPr(?![\s\S]*<w:sectPr)/, (end) => `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="dxa"/>
    <w:tblInd w:w="-500" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="5000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="5000" w:type="dxa"/></w:tcPr>
    <w:sdt><w:sdtPr/><w:sdtContent><w:p><w:r><w:t>Kept in a content control</w:t></w:r></w:p></w:sdtContent></w:sdt></w:tc></w:tr></w:tbl>
    <w:p><w:r><w:sym w:font="Wingdings" w:char="F0D8"/></w:r><w:r><w:rPr><w:rFonts w:ascii="Nowhere Grotesk" w:hAnsi="Nowhere Grotesk" w:eastAsia="MS Mincho"/></w:rPr><w:t>Unknown font line</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="CheckBig"/></w:pPr><w:r><w:t>Big paragraph </w:t></w:r><w:r><w:rPr><w:rStyle w:val="CheckSmall"/></w:rPr><w:t>small run</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="CheckRaised"/></w:pPr><w:r><w:t>Raised by its style</w:t></w:r></w:p>${end}`);
  zip.file(docPath, body);
  zip.file("word/styles.xml", (await zip.file("word/styles.xml").async("string")).replace("</w:styles>", `<w:style w:type="paragraph" w:styleId="CheckBig"><w:name w:val="Check Big"/>
    <w:rPr><w:sz w:val="40"/></w:rPr></w:style><w:style w:type="character" w:styleId="CheckSmall"><w:name w:val="Check Small"/><w:rPr><w:sz w:val="16"/></w:rPr></w:style>
    <w:style w:type="paragraph" w:styleId="CheckRaised"><w:name w:val="Check Raised"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style></w:styles>`));
  const wd = await open({ width: 1280, height: 900 });
  await wd.page.locator("textarea").fill(SAMPLE_JOB);
  await wd.page.locator("#step-cv input[type=file]").setInputFiles({ name: "styled-cv.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: await zip.generateAsync({ type: "nodebuffer" }) });
  await drawn(wd.page);
  const look = await wd.page.evaluate(() => {
    const root = document.querySelector("#preview .desk > div:last-child").firstElementChild.shadowRoot, sec = root.querySelector("section.docx");
    const span = (t) => [...root.querySelectorAll("span")].find((s) => !s.firstElementChild && s.textContent.includes(t)), css = (t) => getComputedStyle(span(t));
    const left = (el) => el.getBoundingClientRect().left;
    return { text: sec.textContent, font: css("Unknown font").fontFamily, sizes: [parseFloat(css("small run").fontSize), parseFloat(css("Big paragraph").fontSize)],
      raised: [...root.querySelectorAll("sup")].some((s) => s.textContent.includes("Raised by its style")), hyphens: getComputedStyle(sec).hyphens,
      indent: Math.round(left([...root.querySelectorAll("table")].at(-1)) - left(span("Big paragraph").closest("p"))) };
  });
  check(look.text.includes("Kept in a content control"), "word preview shows a content control's text inside a table cell");
  check(look.text.includes("\u27a2") && !look.text.includes("\uf0d8"), "word preview shows a Wingdings bullet as a plain character");
  check(/sans-serif$/.test(look.font) && !look.font.includes("Mincho"), "word preview ends a missing font with its generic kind, not an East Asian font", look.font);
  check(look.sizes[0] < look.sizes[1], "word preview puts a character style above its paragraph's style", look.sizes.join(" < "));
  check(look.raised, "word preview raises text its style sets as superscript");
  check(look.indent < -10, "word preview pulls a table left by its indent", look.indent);
  check(look.hyphens === "manual", "word preview hyphenates only when the file asks", look.hyphens);
  await wd.ctx.close();
} catch (e) {
  check(false, "flow", e.message.split("\n")[0]);
} finally {
  await browser.close();
  server.httpServer.close();
}
console.log(`${checks} checks, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
