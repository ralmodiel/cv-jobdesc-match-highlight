# CV Highlighter

Add a CV (PDF or Word) and paste a job ad. CV Highlighter marks the parts of the CV that matter for that job:

- the skills and terms the ad asks for (exact words, common aliases, same word stem),
- related skills (the ad says "cloud", the CV says "AWS"),
- the lines that fit the job best, ranked by keyword weight and by meaning.

All three are highlighted in green by default. Step 4 turns any of them into bold or underline, and changes the colour.
Words that every CV in a field has ("software development", "networking") and acronyms with more than one meaning
(GCP: Google Cloud or Good Clinical Practice) are not marked unless you add them yourself. What the ad says is not
needed ("AWS and GraphQL are not required", "Neither AWS nor GraphQL is required", "No degree needed", "AWS
(optional)") is never listed as missing; "not required, but a plus"
counts as a nice-to-have.

You download the result as PDF or Word. With the same format as the upload, your own file is edited in place, so the
design stays exactly yours. The other format is rebuilt in a clean one-column layout.

It also lists the lines that open weakly ("Responsible for…", "Helped…", "Leveraged…") with action verbs that fit each
one: the line's own action first ("Involved in the design of…" → Designed), then verbs the job ad itself uses (marked
"in ad"), then verbs the language model picks by meaning. A verb that fits one trade only ("Patrolled") is offered only
when the line mentions that trade, and a line that says you helped is not offered "Led". A verb that opens three or
more lines ("Managed") is flagged with others of its kind. These are suggestions: the words in your file are yours to
change.

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
`.github/workflows/pages.yml` checks the dependencies, builds and deploys to GitHub Pages on every push to `main`.

## Checks

Each check prints `N checks, M FAIL` and exits non-zero on a failure. The scripts in `scripts/` are kept on the
development machine, not in the repository, and run before each push; `check:deps` (in `tools/`) also runs in CI.

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
| `src/lib/power.js` | lines that open weakly, and the kinds of action verbs the language model picks for each |
| `src/components/` | the five steps, the live preview and the download controls |

## Limits

- Scanned PDFs (images of text) have no text to read. The app says so, and OCR is not included.
- The language model is English-only, and keyword matching works best on English job ads.
- Bold in a PDF needs a bold-capable font in the file. Where none exists the letters are underlined instead, and the app
  shows how many letters that affected.
