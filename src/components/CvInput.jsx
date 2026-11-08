// Step 1: the CV. A real <input type=file> inside a large drop target; the file is read here, in the tab, never uploaded.
import { useEffect, useRef } from "react";
import { Icon, Spinner, StepCard } from "./ui.jsx";

export default function CvInput({ cv, busy, error, onFile, onSample, onClear }) {
  const input = useRef(null), replace = useRef(null), seen = useRef(cv);
  // adding or removing the CV swaps these controls; the keyboard moves to the new one instead of falling to the top of the page
  // (the controls stay enabled while a file is read: a second pick or a Remove simply supersedes the first read)
  useEffect(() => {
    if (seen.current === cv) return;
    seen.current = cv;
    if (document.activeElement === document.body) (cv ? replace : input).current?.focus({ preventScroll: true });
  }, [cv]);
  const pick = (files) => files?.[0] && onFile(files[0]);
  const summary = cv && (cv.doc.kind === "pdf" ? `PDF · ${cv.doc.pages.length} page${cv.doc.pages.length > 1 ? "s" : ""}` : "Word document");

  return (
    <StepCard n={1} id="step-cv" title="Your CV" done={!!cv}>
      {cv ? (
        <div className="flex items-center gap-3 rounded-xl bg-surface-2 p-3">
          <Icon name="file" className="size-8 flex-none text-ink-3 max-sm:hidden" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium" title={cv.name}>{cv.name}</p>
            <p className="flex items-center gap-1.5 text-sm text-ink-3">{busy ? <><Spinner />Reading the new file…</> : summary}</p>
          </div>
          <div className="flex flex-none gap-2">
          <button ref={replace} type="button" className="btn btn-ghost btn-sm" onClick={() => input.current?.click()}>Replace<span className="sr-only"> CV</span></button>
          <button type="button" className="btn btn-ghost btn-sm min-w-9 px-2 pointer-coarse:min-w-11" onClick={onClear} aria-label="Remove CV" title="Remove CV"><Icon name="x" className="size-4" /></button>
          </div>
        </div>
      ) : (
        <div className="drop relative grid place-items-center gap-2 px-4 py-7 text-center">
          {busy ? <Spinner className="size-7 text-accent" /> : <Icon name="upload" className="size-7 text-accent" />}
          <p className="font-medium">{busy ? "Reading your CV…" : <>Drop your CV here or <span className="text-accent underline underline-offset-2">choose a file</span></>}</p>
          <p className="text-sm text-ink-3">PDF or Word (.docx), up to 15 MB</p>
          {/* the whole box is the click target and the input is the accessible control; drops are handled page-wide in App */}
          <input ref={input} type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="absolute inset-0 cursor-pointer opacity-0" aria-label="Choose your CV (PDF or Word)"
            onChange={(e) => { pick(e.target.files); e.target.value = ""; }} />
        </div>
      )}
      {cv && <input ref={input} type="file" hidden accept=".pdf,.docx" onChange={(e) => { pick(e.target.files); e.target.value = ""; }} />}
      <p className="sr-only" aria-live="polite">{cv ? `Added ${cv.name}: ${summary}.` : ""}</p>
      {error && <p role="alert" className="alert bad mt-3 flex gap-2"><Icon name="warn" className="mt-0.5 size-4 flex-none" /><span>{error}{cv && " Your current CV is unchanged."}</span></p>}
      {!cv && !busy && (
        <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-ink-3">
          No CV handy?
          <button type="button" className="btn btn-ghost btn-sm" onClick={onSample}><Icon name="file" className="size-4" />Try a sample CV and job</button>
        </p>
      )}
    </StepCard>
  );
}
