import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import CvInput from "./components/CvInput.jsx";
import JobInput from "./components/JobInput.jsx";
import Terms from "./components/Terms.jsx";
import Emphasis from "./components/Emphasis.jsx";
import Preview from "./components/Preview.jsx";
import Download from "./components/Download.jsx";
import { Icon } from "./components/ui.jsx";
import { analyzeJob } from "./lib/jd.js";
import { matchCV } from "./lib/match.js";
import { InputError, LIMITS, baseName, checkFile, saveBlob } from "./lib/files.js";
import { SAMPLE_JOB } from "./lib/sample.js";
import { blockSimilarity, model as modelState, onModel, warmUp } from "./lib/semantic.js";

const STYLES = { keyword: "bold", related: "underline", line: "highlight", color: "#fff59d" };
const build = async (doc, marks, styles, format) => (await import("./lib/convert.js")).buildOutput(doc, marks, styles, format);

async function readCv(file) {
  const buf = await file.arrayBuffer();
  const kind = checkFile(file, buf);
  const doc = kind === "pdf" ? await (await import("./lib/pdf-read.js")).readPdf(buf) : await (await import("./lib/docx.js")).readDocx(buf);
  if (!doc.blocks.some((b) => /\p{L}{2}/u.test(b.text))) throw new InputError("No text was found in this document.");
  return doc;
}

export default function App() {
  const [cv, setCv] = useState(null); // { name, doc }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [job, setJob] = useState("");
  const [format, setFormat] = useState("pdf");
  const [styles, setStyles] = useState(STYLES);
  const [density, setDensity] = useState("balanced");
  const [exclude, setExclude] = useState(() => new Set());
  const [extra, setExtra] = useState([]);
  const [out, setOut] = useState(null); // { blob, fallback, rebuilt, format }
  const [outError, setOutError] = useState("");
  const [pending, setPending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(""); // the name of the file just downloaded, said under the button
  const [dragging, setDragging] = useState(false);
  const [sem, setSem] = useState(null); // { doc, s }: per block, how close it comes in meaning to the job's requirements
  const [lm, setLm] = useState(modelState);
  const req = useRef(0);

  const jobText = useDeferredValue(job);
  const analysis = useMemo(() => analyzeJob(jobText.slice(0, LIMITS.jobChars)), [jobText]);
  const own = useMemo(() => extra.filter((t) => !analysis.terms.some((a) => a.key === t.key)), [analysis, extra]);
  const terms = useMemo(() => [...analysis.terms, ...own], [analysis, own]);
  const hasJob = terms.length > 0; // the person's own terms count, so an ad the parser cannot read still gets marked
  // a new ad (cleared, or one with another title) starts with nothing added or switched off
  // shortcut: pasting over an ad with the same title (or none) keeps them, key on the requirements too if that confuses people
  const jobKey = jobText.trim() && `t:${analysis.title}`;
  useEffect(() => { setExtra((x) => (x.length ? [] : x)); setExclude((s) => (s.size ? new Set() : s)); }, [jobKey]);
  const reqs = analysis.requirements;
  // while the job is being edited, the scores for the previous wording stay in use until the new ones arrive
  const semNow = cv && sem?.doc === cv.doc && reqs.length ? sem.s : null;
  const result = useMemo(() => (cv && hasJob ? matchCV(cv.doc.blocks, analysis, { density, exclude, extra: own, sem: semNow }) : null),
    [cv, hasJob, analysis, density, exclude, own, semNow]);
  const marks = result?.marks;
  const counts = useMemo(() => {
    const c = { keyword: 0, related: 0, line: 0 };
    for (const m of marks || []) c[m.cat]++;
    return c;
  }, [marks]);

  const load = useCallback(async (file) => {
    const id = ++req.current;
    setBusy(true);
    setError("");
    try {
      const doc = await readCv(file);
      if (id !== req.current) return;
      setOut(null);
      setCv({ name: file.name, doc });
      setFormat(doc.kind);
    } catch (e) {
      if (id !== req.current) return;
      if (!(e instanceof InputError)) console.error(e);
      setError(e instanceof InputError ? e.message : "This file could not be read. If it opens in Word, save it again as .docx or PDF and add that copy.");
    } finally {
      if (id === req.current) setBusy(false);
    }
  }, []);

  const sample = async () => {
    if (!job.trim()) setJob(SAMPLE_JOB);
    try {
      const res = await fetch(new URL("sample-cv.docx", document.baseURI));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load(new File([await res.blob()], "sample-cv.docx"));
    } catch (e) {
      console.error(e);
      setError("The sample could not be loaded. Reload the page and try again.");
    }
  };

  const clear = () => { req.current++; setBusy(false); setCv(null); setOut(null); setError(""); setOutError(""); };

  useEffect(() => onModel(setLm), []);
  // On one-column screens the preview is below the job: bring it into view when a CV arrives and there is a job to match.
  useEffect(() => {
    if (cv && hasJob && !matchMedia("(min-width: 1024px)").matches)
      document.getElementById("preview")?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [cv]); // eslint-disable-line react-hooks/exhaustive-deps -- only when a CV arrives, not on every edit of the job
  useEffect(() => { if (cv || reqs.length) warmUp(); }, [cv, reqs.length]);
  // The language model runs in a worker; until it answers (or if it cannot run) lines are ranked by keywords alone.
  useEffect(() => {
    if (!cv || !reqs.length) return undefined;
    let live = true;
    const t = setTimeout(() => blockSimilarity(cv.doc.blocks, reqs).then((s) => live && setSem({ doc: cv.doc, s }), (e) => console.warn(e)), 300);
    return () => { live = false; clearTimeout(t); };
  }, [cv, reqs]);

  // Any change of the person's own clears the saved-file line (the ranking arriving later does not: the download was still made)
  useEffect(() => setSaved(""), [cv, job, format, styles, density, exclude, extra]);
  // Rebuild the file shortly after the last change; the preview shows exactly this file.
  useEffect(() => {
    if (!cv) return undefined;
    let live = true;
    setPending(true);
    const t = setTimeout(async () => {
      try {
        const r = await build(cv.doc, marks || [], styles, format);
        if (live) { setOut({ ...r, format }); setOutError(""); }
      } catch (e) {
        if (!(e instanceof InputError)) console.error(e);
        if (live) setOutError(e instanceof InputError ? e.message : "The highlighted file could not be created. Try the other file type, or another export of your CV.");
      } finally {
        if (live) setPending(false);
      }
    }, 120);
    return () => { live = false; clearTimeout(t); };
  }, [cv, marks, styles, format]);

  const download = async () => {
    setSaving(true);
    try {
      // a click right after a change saves the new settings, not the file still being rebuilt
      const blob = pending || out?.format !== format ? (await build(cv.doc, marks || [], styles, format)).blob : out.blob;
      const name = `${baseName(cv.name)}-highlighted.${format}`;
      saveBlob(blob, name);
      setSaved(name);
    } catch (e) {
      if (!(e instanceof InputError)) console.error(e);
      setOutError(e instanceof InputError ? e.message : "The file could not be created. Try the other file type.");
    } finally {
      setSaving(false);
    }
  };

  const toggle = (key) => setExclude((s) => { const n = new Set(s); if (!n.delete(key)) n.add(key); return n; });
  const add = (t) => {
    setExclude((s) => { if (!s.has(t.key)) return s; const n = new Set(s); n.delete(t.key); return n; });
    setExtra((x) => (x.some((e) => e.key === t.key) ? x : [...x, t]));
  };

  // Drop a file anywhere on the page.
  useEffect(() => {
    let depth = 0;
    const files = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
    const on = {
      dragenter: (e) => { if (files(e)) { e.preventDefault(); depth++; setDragging(true); } },
      dragover: (e) => { if (files(e)) e.preventDefault(); },
      dragleave: (e) => { if (files(e) && --depth <= 0) { depth = 0; setDragging(false); } },
      drop: (e) => {
        if (!files(e)) return;
        e.preventDefault();
        depth = 0;
        setDragging(false);
        if (e.dataTransfer.files[0]) load(e.dataTransfer.files[0]);
      },
    };
    for (const [k, f] of Object.entries(on)) window.addEventListener(k, f);
    return () => { for (const [k, f] of Object.entries(on)) window.removeEventListener(k, f); };
  }, [load]);

  return (
    <>
      <a href="#main" className="skip sr-only-focusable">Skip to the tool</a>
      <header className="mx-auto max-w-6xl px-4 pb-7 pt-5 sm:px-6">
        <div className="flex items-center gap-3">
          <img src="favicon.svg" alt="" className="size-8" width="32" height="32" />
          <span className="text-lg font-semibold tracking-tight">CV Highlighter</span>
          <Privacy />
        </div>
        <div className="pt-8 sm:pt-12">
        <h1 className="max-w-3xl text-balance font-serif text-[2.1rem] font-semibold leading-[1.15] tracking-tight sm:text-5xl">
          Show them you’re the <span className="hl hl-sweep">right fit</span>.
        </h1>
        <p className="mt-3 max-w-2xl text-base text-ink-2 sm:text-lg">
          Add your CV and paste the job ad. The skills it asks for are made bold, related ones underlined and your best-fitting
          lines highlighted, in your own file, ready to send as PDF or Word.
        </p>
        </div>
      </header>

      <main id="main" tabIndex={-1} className="layout mx-auto max-w-6xl px-4 pb-16 sm:px-6">
        <CvInput cv={cv} busy={busy} error={error} onFile={load} onSample={sample} onClear={clear} />
        <JobInput job={job} onChange={setJob} analysis={analysis} />
        <div className="preview-col">
          <Preview out={cv ? out : null} pending={pending} error={outError} hasJob={hasJob} hasText={!!jobText.trim()} counts={counts} styles={styles}>
            <Download kind={cv?.doc.kind} format={format} onFormat={setFormat} out={cv ? out : null} saving={saving} saved={saved} onDownload={download} />
          </Preview>
        </div>
        <Terms result={result} terms={terms} exclude={exclude} onToggle={toggle} onAdd={add} lm={reqs.length ? lm : null} ranked={!!semNow}
          hasCv={!!cv} hasText={!!jobText.trim()} />
        <Emphasis styles={styles} onStyles={setStyles} density={density} onDensity={setDensity} />
      </main>

      <footer className="mx-auto max-w-6xl px-4 pb-10 text-sm text-ink-3 sm:px-6">
        CV Highlighter runs entirely in your browser. No account, no uploads, no tracking.
      </footer>

      {dragging && (
        <div className="drag-overlay" aria-hidden="true">
          <div className="card flex items-center gap-3 px-6 py-4 text-lg font-semibold"><Icon name="upload" className="size-6 text-accent" />Drop your CV to add it</div>
        </div>
      )}
    </>
  );
}

function Privacy() {
  const ref = useRef(null);
  useEffect(() => { // close like a menu: Escape, or a press anywhere else
    const el = ref.current;
    const shut = (e) => { if (el.open && (e.type === "keydown" ? e.key === "Escape" : !el.contains(e.target))) el.open = false; };
    document.addEventListener("keydown", shut);
    document.addEventListener("pointerdown", shut);
    return () => { document.removeEventListener("keydown", shut); document.removeEventListener("pointerdown", shut); };
  }, []);
  return (
    <details ref={ref} className="privacy relative ml-auto">
      <summary className="btn btn-ghost btn-sm rounded-full">
        <Icon name="lock" className="size-4 text-ok" /><span>Private<span className="hidden sm:inline">: nothing is uploaded</span></span>
      </summary>
      <div className="card absolute right-0 z-30 mt-2 w-[min(22rem,calc(100vw-2rem))] p-4 text-sm">
        <p className="mb-2 font-semibold">Your CV stays on this device</p>
        <ul className="list-disc space-y-1.5 pl-5 text-ink-2">
          <li>Your file is read and edited by code running in this tab. It is never uploaded.</li>
          <li>A small language model, also running in this tab, ranks your lines by meaning. It comes from this site and stays in your browser's cache for next time.</li>
          <li>The page may only load its own files; its security policy blocks every other site, so nothing can be sent anywhere.</li>
          <li>Your CV is not stored. Close or reload the tab and it is gone.</li>
        </ul>
      </div>
    </details>
  );
}
