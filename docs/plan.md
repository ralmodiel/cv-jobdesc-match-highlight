# CV Highlighter: plan

The app is static and UI-only, deployable to any static host. A person drops in a CV (PDF or DOCX) and pastes a job
description. The app then bolds, underlines and highlights the parts of the CV that matter for that job, and the person
downloads the CV as DOCX or PDF. Everything runs in the browser and nothing is uploaded. The model and the WASM runtime
are self-hosted, CSP blocks every third-party request, and nothing but the model files is cached.

## Architecture

```
index.html            build-time meta CSP (scripts/vite csp plugin), no inline script/style
src/main.jsx          React root
src/App.jsx           state machine: cv → job → review → download; layout (2 columns ≥ lg, tabs on phones)
src/components/       Dropzone, JobInput, Review (marks list + style per category), Preview, ModelChip, Download
src/lib/text.js       normalize, tokenize (with offsets), stem, stopwords
src/lib/skills.js     curated skills/aliases (canonical → variants), related groups (ontology), domain stopwords
src/lib/jd.js         analyzeJob(text) → { terms[], requirements[] }  (segments, section cues, RAKE + dictionary)
src/lib/match.js      matchCV(blocks, job, opts) → { marks[], found[], missing[], scores[] }
src/lib/embed*.js     transformers.js worker, Xenova/bge-small-en-v1.5 q8, wasm single-thread; semantic refine
src/lib/docx.js       readDocx(buf) → doc;  writeDocx(doc, marks, styles) → Blob   (in-place XML edit)
src/lib/pdf-read.js   readPdf(buf) → doc   (pdf.js operator list interpreted → glyph boxes → lines/blocks)
src/lib/pdf-write.js  writePdf(doc, marks, styles) → Blob (pdf-lib: content-stream bold rewrite, rect highlight, lines)
src/lib/convert.js    pdf → docx (reconstruct paragraphs/bullets/tab stops), docx → pdf (rendered DOM → pdf-lib)
src/lib/files.js      type sniffing (magic bytes), size/zip limits
```

### Shared shapes
- `Doc = { kind: 'docx'|'pdf', blocks: Block[], ... private source maps }`
- `Block = { id, text, kind: 'heading'|'bullet'|'para', section }`. The text is plain, with `\t` and `\n` kept.
  Format modules map each char back to its source: DOCX uses w:t node + offset, PDF uses glyph index.
- `Mark = { block, start, end, cat: 'keyword'|'related'|'line', term, source }`. Offsets index `block.text`.
- `Styles = { keyword: 'bold', related: 'underline', line: 'highlight' }`. Each value is one of
  `bold|underline|highlight|off`, plus a highlight colour.

### Emphasis rules
- **keyword** (bold by default): a JD skill or term that appears in the CV as an exact match, an alias or the same stem.
  Up to 3 occurrences per term, ~40 marks in all.
- **related** (underline by default): a CV term that is not in the JD but means the same thing. Found through the
  ontology (JD "cloud" → CV "AWS") and through embeddings once the model has loaded.
- **line** (highlight by default): the CV bullets and lines most relevant to the JD. They are scored lexically
  (term weights) plus semantically (bullet ↔ JD requirement sentences). Top ~25% of bullets, capped at 8.

### Format strategies
- **DOCX to DOCX:** DOMParser over word/document.xml. Walk w:p, including tables, sdt, hyperlinks and text boxes; take
  mc:Choice, mirror it into mc:Fallback, and skip instrText and delText. Split runs at mark edges and insert w:b/w:bCs,
  w:u and w:shd in CT_RPr order. Re-zip with JSZip. Fidelity is exact.
- **PDF to PDF:** the operator list gives glyph positions. A content-stream tokenizer is correlated with the pdf.js
  showText ops by order and glyph counts.
  - Bold means splitting the Tj/TJ and rendering the bold part with `2 Tr` (fill+stroke) in the fill colour, then
    restoring Tr, w and the stroke colour.
  - Highlight is a multiply-blend rectangle. Underline is a line.
  - Pages that can't be correlated fall back to underline instead of bold. The UI says so.
- **PDF to DOCX:** rebuilt with the docx library: headings by size and weight, bullets, right-tab dates. Layout is
  simplified, and the UI says so.
- **DOCX to PDF:** render with docx-preview, using bundled metric-compatible fonts. Lay out text, backgrounds and lines
  through pdf-lib with the same fonts, so the text stays real and selectable.

## Security
- Production CSP: `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data: blob:;
  font-src 'self' data: blob:; connect-src 'self' blob: data:; worker-src 'self' blob:; object-src 'none'; base-uri 'none';
  form-action 'none'; frame-src 'none'`.
- docx-preview HTML is rendered into a detached node and then moved into a shadow root. Its styles become constructable
  sheets, and its hrefs and on* attributes are stripped.
- pdf.js runs with isEvalSupported:false and no XFA or annotations.
- Limits: 15 MB per file, 2000 zip entries, 60 MB total uncompressed, 40 pages.

## Checks (each prints `N checks, M FAIL` and exits non-zero on failure)
- `npm run check:unit`: Node checks of text, jd and match.
- `npm run check:browser`: Playwright drives a harness page that reads and writes DOCX/PDF fixtures, then reads them back.
- `npm run check:e2e`: the built app under its CSP. It runs the sample flow, the model load and all four download paths,
  then axe in light and dark and the 360px overflow check. It needs zero CSP violations and zero non-localhost requests.
- `npm run check:deps`: exact pins, permissive licences on the bundled packages, and `npm audit` on the production tree.

## Rounds
Each round is one change and one check, logged as one line in docs/rounds.md. The areas rotate:

- Correctness: the eval set, multi-column PDFs, ligatures, hyphenation, tables, text boxes, Type0 fonts.
- UI/UX: empty states, a sample, the review panel, keyboard use, explaining why something was marked.
- Aesthetics: type scale, colour, motion, the preview frame.
- Speed: lazy chunks, the worker, cached embeddings, debounced re-render.
- Security: CSP, sanitising, limits, deps, provenance.
