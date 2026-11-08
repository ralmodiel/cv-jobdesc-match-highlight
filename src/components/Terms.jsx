// Step 3: what was matched. Every chip is a toggle (aria-pressed), so a wrong match is one click away from gone.
import { useState } from "react";
import { userTerm } from "../lib/jd.js";
import { Icon, Spinner, StepCard } from "./ui.jsx";

export default function Terms({ result, terms, exclude, onToggle, onAdd, lm, ranked, hasCv, hasText }) {
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState("");
  const found = new Map(result?.found.map((t) => [t.key, t]));
  // marked terms, the person's own additions (even with 0 hits) and switched-off found terms, in the job's order of weight;
  // a term found only inside a longer one ("Frontend" in "Frontend Engineer") has nothing of its own to switch off
  const chips = terms.filter((t) => found.get(t.key)?.count > 0 || t.cls === "user" || (exclude.has(t.key) && found.has(t.key)))
    .map((t) => found.get(t.key) || { ...t, count: 0 });
  const missing = result?.missing || [];
  const have = result ? result.found.filter((t) => t.core).length : 0;
  const total = have + missing.length; // the same core terms JobInput counts
  const pct = total ? Math.round((100 * have) / total) : 0;

  const add = (e) => {
    e.preventDefault();
    const label = draft.trim().slice(0, 60);
    const t = label && userTerm(label);
    if (!t) return setNote("Type a skill or a short phrase first.");
    if (terms.some((x) => x.key === t.key && !exclude.has(x.key))) setNote(`“${t.label}” is already in the list.`);
    else { onAdd(t); setNote(`Added “${t.label}”.`); }
    setDraft("");
  };

  // one tree whatever the state, so the add box keeps focus when the first added term turns "nothing to match" into a result
  return (
    <StepCard n={3} id="step-terms" title="What matched">
      {!result ? (
        <p className={`text-sm text-ink-3 ${hasText ? "mb-3" : ""}`}>
          {!hasText ? (hasCv ? "Paste the job ad to see which of its key terms your CV already has." : "Add your CV and paste the job ad to see which of the job’s key terms your CV already has.")
            : !terms.length ? "No terms found in this ad to match. Add the skills it asks for yourself, or paste a fuller ad."
            : "Add your CV to see which of the job’s key terms it already has."}
        </p>
      ) : <>
      <div className="mb-4">
        {total ? <>
        <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
          <span className="font-medium"><strong className="text-2xl font-semibold tabular-nums">{have}</strong> of {total} key terms are in your CV</span>
          <span className="tabular-nums text-ink-3">{pct}%</span>
        </div>
        <div className="meter" role="img" aria-label={`${pct}% of the job's key terms appear in your CV`}><i style={{ width: `${pct}%` }} /></div>
        </> : <p className="text-sm text-ink-3">This ad names no clear requirements, so there is no score.</p>}
        {lm && lm.status !== "idle" && (
          <p className="mt-2 flex min-h-10 items-start gap-1.5 text-sm text-ink-3" role="status">
            {lm.status === "loading" ? <><Spinner className="mt-0.5 size-4 flex-none" /><span>Loading the language model that ranks your lines by meaning… {lm.pct > 0 && lm.pct < 100 && <span aria-hidden="true">{lm.pct}%</span>}</span></>
              : lm.status === "ready" && !ranked ? <><Spinner className="mt-0.5 size-4 flex-none" /><span>Ranking your lines by meaning…</span></>
              : lm.status === "ready" ? <><Icon name="spark" className="mt-0.5 size-4 flex-none text-accent" /><span>Best lines are also ranked by meaning, by a language model running on this device.</span></>
              : <><Icon name="warn" className="mt-0.5 size-4 flex-none" /><span>The language model could not start in this browser, so lines are ranked by keywords only.</span></>}
          </p>
        )}
      </div>

      {chips.length > 0 && (
        <>
          <h3 className="mb-2 text-sm font-medium text-ink-2">Marked in your CV <span className="font-normal text-ink-3">· click to switch one off</span></h3>
          <ul className="mb-4 flex flex-wrap gap-1.5" aria-label="Matched terms">
            {chips.map((t) => {
              const on = !exclude.has(t.key);
              return (
                <li key={t.key}>
                  <button type="button" className="chip" aria-pressed={on} onClick={() => onToggle(t.key)}
                    title={on ? `Stop marking “${t.label}”` : `Mark “${t.label}” again`}>
                    {t.label}{on && (t.count > 0 ? <span className="n"><span aria-hidden="true">{t.count}</span><span className="sr-only">, marked {t.count} time{t.count === 1 ? "" : "s"}</span></span>
                      : <span className="n">{found.has(t.key) ? "not marked" : "not in CV"}</span>)}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {missing.length > 0 && (
        <>
          <h3 className="mb-1 text-sm font-medium text-ink-2">Asked for, but not found</h3>
          <p className="mb-2 text-sm text-ink-3">If you have these, name them in your CV in the job’s own words.
            {missing.some((t) => t.related) && " For those marked ≈ related, something related in your CV is marked instead; click one to stop."}</p>
          <ul className="mb-4 flex flex-wrap gap-1.5" aria-label="Terms not found in your CV">
            {missing.slice(0, 24).map((t) => {
              const on = !exclude.has(t.key);
              // a related match is a mark like any other, so it switches off here (the term itself is still not in the CV)
              return (
                <li key={t.key}>
                  {t.related || !on ? (
                    <button type="button" className="chip missing" aria-pressed={on} onClick={() => onToggle(t.key)}
                      title={on ? `Stop underlining what is related to “${t.label}”` : `Underline what is related to “${t.label}” again`}>
                      {t.label}{on && <span className="text-xs"><span aria-hidden="true">≈ related</span><span className="sr-only">, something related is marked</span></span>}
                    </button>
                  ) : <span className="chip missing">{t.label}</span>}
                </li>
              );
            })}
          </ul>
        </>
      )}

      </>}

      {(result || hasText) && <form onSubmit={add} className="flex gap-2">
        <label htmlFor="add-term" className="sr-only">Add a term to mark</label>
        <input id="add-term" className="field min-h-11 py-2" value={draft} maxLength={60} autoComplete="off"
          placeholder="Add a term, e.g. SQL" onChange={(e) => { setDraft(e.target.value); setNote(""); }} />
        <button type="submit" className="btn btn-ghost flex-none"><Icon name="plus" className="size-4" />Add</button>
      </form>}
      <p className={`text-sm text-ink-3 ${note ? "mt-1.5" : ""}`} aria-live="polite">{note}</p>
    </StepCard>
  );
}
