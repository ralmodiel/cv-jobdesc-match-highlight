# CV Highlighter

Add a CV (PDF or Word) and paste a job ad. CV Highlighter marks the parts of the CV that matter for that job:

- **bold** for the skills and terms the ad asks for (exact words, common aliases, same word stem),
- underline for related skills (the ad says "cloud", the CV says "AWS"),
- highlight for the lines that fit the job best, ranked by keyword weight and by meaning.

You download the result as PDF or Word. With the same format as the upload, your own file is edited in place, so the
design stays exactly yours. The other format is rebuilt in a clean one-column layout.

## Privacy

Everything runs in the browser tab. There is no server-side code, no account and no analytics.

- The CV is read, matched and edited in the tab and is never uploaded or stored. Reload the tab and it is gone.
- The language model (bge-small-en-v1.5, int8, 34 MB) and its WebAssembly runtime are served by this site and run in a
  web worker. Remote model downloads are switched off. The browser caches the model files (only the model, never the
  CV) so the next visit starts faster.
- The production build carries a Content-Security-Policy that only allows this site's own files
  (`connect-src 'self' blob: data:`), so the browser itself would refuse to send the CV anywhere else.
- The Word preview is rendered into a shadow root with event handlers and external links removed. pdf.js runs without
  eval. Files are checked by their first bytes and capped at 15 MB, 40 pages and 60 MB unzipped.

## Run it

Needs Node 20+ and, for the checks, Chrome or Chromium.

```sh
npm ci
npm run assets     # model (pinned revision, hash-checked), ONNX runtime and pdf.js data into public/
npm run dev        # http://localhost:5173
npm run build      # static site in dist/, deployable to any static host (relative base, works in a subfolder)
npm run preview    # serve dist/ on http://localhost:4196
```

The host must serve `.wasm` as `application/wasm`, as GitHub Pages, Netlify and nginx do by default.
`.github/workflows/pages.yml` runs the checks and deploys to GitHub Pages on every push to `main`.

## Checks

Each check prints `N checks, M FAIL` and exits non-zero on a failure.

| Command | What it covers |
| --- | --- |
| `npm run check:unit` | job-ad analysis and matching, in Node |
| `npm run check:browser` | read → mark → write → read back on two Word layouts and six kinds of PDF (LibreOffice, Chrome, pdf-lib, two columns, Ghostscript, a CV builder's), in Chrome |
| `npm run check:e2e` | the built app under its real CSP: sample flow, model load, all four download paths, a non-CV file, axe in light, dark and at 360 px, no sideways scroll, no CSP violation, no request leaving the machine |
| `npm run check:deps` | exact version pins, permissive licences on everything bundled, no high or critical advisory |
| `npm run check` | unit, browser and e2e |

## How it works

| File | Role |
| --- | --- |
| `src/lib/docx.js` | reads `word/document.xml` into text blocks and writes bold, underline and shading back into the runs |
| `src/lib/pdf-read.js` | pdf.js operator lists → glyph boxes → lines and blocks |
| `src/lib/pdf-write.js` | pdf-lib: bold by rewriting the content stream, highlight and underline drawn as shapes |
| `src/lib/convert.js` | the download: edit in place, or rebuild in the other format |
| `src/lib/jd.js`, `skills.js` | key terms and requirement sentences from the job ad |
| `src/lib/match.js` | which spans are marked, and how many (Light, Balanced, Strong) |
| `src/lib/semantic.js`, `embed-worker.js` | the language model in a worker: how close each CV line comes in meaning to the job's requirements |
| `src/components/` | the four steps, the live preview and the download controls |

Design notes are in `docs/plan.md`, and the log of improvement rounds is in `docs/rounds.md`.

## Limits

- Scanned PDFs (images of text) have no text to read. The app says so, and OCR is not included.
- The language model is English-only, and keyword matching works best on English job ads.
- Bold in a PDF needs a bold-capable font in the file. Where none exists the letters are underlined instead, and the app
  shows how many letters that affected.
