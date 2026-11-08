// Small shared pieces: icons, a step card and a segmented radio group (native radios, so keyboard and screen readers just work).
import { useEffect, useId, useRef, useState } from "react";

const PATHS = {
  file: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5",
  upload: "M12 16V4m0 0-4 4m4-4 4 4M5 20h14",
  lock: "M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z",
  download: "M12 4v12m0 0-4-4m4 4 4-4M5 20h14",
  check: "m5 12 4 4 10-10",
  x: "M6 6l12 12M18 6 6 18",
  plus: "M12 5v14M5 12h14",
  spark: "M12 3v4m0 10v4M3 12h4m10 0h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18",
  info: "M12 8h.01M11 12h1v5h1M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
  warn: "M12 9v4m0 4h.01M10.3 3.9 2.5 18a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  zoomIn: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4M8 11h6M11 8v6",
  zoomOut: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4M8 11h6",
};

export function Icon({ name, className = "size-5", ...rest }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      className={className} aria-hidden="true" focusable="false" {...rest}><path d={PATHS[name]} /></svg>
  );
}

export function Spinner({ className = "size-4" }) {
  return <svg viewBox="0 0 24 24" className={`spin ${className}`} aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="42 100" strokeLinecap="round" /></svg>;
}

// A text that changes as the person types (typing an ad changed it dozens of times): shown at once, but screen readers
// hear it through a live copy once it has stood still for a second
export function Settled({ children, ...rest }) {
  const shown = useRef(null), last = useRef(null), timer = useRef(0);
  const [said, setSaid] = useState("");
  useEffect(() => {
    const now = shown.current.textContent;
    if (last.current === null) last.current = now; // the page's first wording is not news
    else if (now !== last.current) { last.current = now; clearTimeout(timer.current); timer.current = setTimeout(() => setSaid(now), 1000); }
  });
  useEffect(() => () => clearTimeout(timer.current), []);
  return <><p ref={shown} {...rest}>{children}</p><span className="sr-only" aria-live="polite">{said}</span></>;
}

export function StepCard({ n, title, done, aside, children, id, disabled }) {
  return (
    <section className={`card p-4 sm:p-5 ${disabled ? "opacity-60" : ""}`} aria-labelledby={`${id}-h`} id={id}>
      <div className="mb-3 flex items-center gap-3">
        <span className={`step ${done ? "done" : ""}`} aria-hidden="true">{done ? <Icon name="check" className="size-4" /> : n}</span>
        <h2 id={`${id}-h`} className="text-lg font-semibold">{title}</h2>
        {aside && <div className="ml-auto">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

/** Segmented radio group. options: [[value, label]] */
export function Seg({ legend, value, onChange, options, hideLegend, disabled }) {
  const name = useId();
  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className={hideLegend ? "sr-only" : "mb-1.5 text-sm font-medium text-ink-2"}>{legend}</legend>
      <div className="seg">
        {options.map(([v, label]) => (
          <label key={v}>
            <input type="radio" name={name} value={v} checked={value === v} onChange={() => onChange(v)} />
            <span>{label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
