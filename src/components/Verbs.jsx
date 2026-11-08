// Step 5: lines that open weakly ("Responsible for…") and stronger verbs to open them with, picked by meaning by the language model.
// Suggestions only: the CV's own words are the person's to change.
import { useEffect, useMemo, useState } from "react";
import { POWER, adVerbs, repeatedOpeners, verbsFor, weakLines } from "../lib/power.js";
import { closest } from "../lib/semantic.js";
import { Spinner, StepCard } from "./ui.jsx";

const GENERAL = [12, 1]; // without the model: "managed" and "built" verbs, which fit most work

export default function Verbs({ cv, job }) {
  const weak = useMemo(() => (cv ? weakLines(cv.doc.blocks).slice(0, 8) : []), [cv]);
  const repeats = useMemo(() => (cv ? repeatedOpeners(cv.doc.blocks) : []), [cv]);
  const ad = useMemo(() => adVerbs(job), [job]);
  const [ranked, setRanked] = useState(null); // { weak, order: per line, { order, scores } of POWER's kinds (null: no model) }
  useEffect(() => {
    if (!weak.length) return undefined;
    let live = true;
    closest(weak.map((w) => w.weak + w.rest), POWER.map((p) => p.about))
      .then((order) => live && setRanked({ weak, order }), () => live && setRanked({ weak, order: null }));
    return () => { live = false; };
  }, [weak]);
  const order = ranked?.weak === weak ? ranked.order : undefined;
  const verbs = useMemo(() => {
    const seen = new Set(); // lines of the same kind get the next verbs, not the same four again
    return weak.map((w, i) => {
      const v = order ? verbsFor(order[i].order, 4, order[i].scores, seen, w, ad) : verbsFor(GENERAL, 4, undefined, seen, w, ad);
      v.forEach((x) => seen.add(x));
      return v;
    });
  }, [weak, order, ad]);
  const chip = (v) => <li key={v} className="chip">{v}{ad.has(v) && <> <span className="n">in ad</span></>}</li>;

  return (
    <StepCard n={5} id="step-verbs" title="Stronger openings" aside={<span className="text-sm text-ink-3">Suggestions</span>}>
      {!cv ? <p className="text-sm text-ink-3">Add your CV to see which lines could open with a stronger verb.</p>
        : !weak.length && !repeats.length ? <p className="text-sm text-ink-3">Every line opens with what you did, and no verb opens many lines. Nothing to suggest.</p>
        : <>
          {weak.length > 0 && (order === undefined ? <p className="flex items-center gap-1.5 text-sm text-ink-3" role="status"><Spinner className="size-4 flex-none" />Choosing verbs that fit each line…</p>
            : <>
              <p className="mb-3 text-sm text-ink-3" role="status">
                {weak.length === 1 ? "One line opens" : `${weak.length} lines open`} with a weak phrase. Starting with a verb that says what you did reads
                stronger; {order ? "these fit each line’s meaning, as the language model reads it" : "the language model could not start, so these are general ones"}.
                {verbs.flat().some((v) => ad.has(v)) && " Verbs marked “in ad” are words the job ad uses."}
              </p>
              <ul className="space-y-3">
                {weak.map((w, i) => (
                  <li key={w.block}>
                    <p className="line-clamp-2 text-sm"><strong className="font-semibold text-warn">{w.weak}</strong>{w.rest}</p>
                    <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label={`Stronger verbs instead of “${w.weak}”`}>{verbs[i].map(chip)}</ul>
                  </li>
                ))}
              </ul>
            </>)}
          {repeats.length > 0 && <ul className={`space-y-3${weak.length ? " mt-4 border-t border-line pt-4" : ""}`}>
            {repeats.map((r) => (
              <li key={r.verb}>
                <p className="text-sm">“<strong className="font-semibold text-warn">{r.verb}</strong>” opens {r.count} lines, which reads like a template. Where another verb says it more exactly, use it:</p>
                {r.alt.length > 0 && <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label={`Other verbs instead of “${r.verb}”`}>{r.alt.map(chip)}</ul>}
              </li>
            ))}
          </ul>}
          <p className="mt-4 text-sm text-ink-3">
            A strong line goes: verb, what you did, how, and what changed (time saved, errors cut, customers served), with a number you could
            explain in an interview. Pick the verb that matches your part: if you helped, say “Supported” or “Coordinated”, not “Led”. Change the
            words in your own file.
          </p>
        </>}
    </StepCard>
  );
}
