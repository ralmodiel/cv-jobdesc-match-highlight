// Step 5: lines that open weakly ("Responsible for…") and stronger verbs to open them with, picked by meaning by the language model.
// Suggestions only: the CV's own words are the person's to change.
import { useEffect, useMemo, useState } from "react";
import { POWER, verbsFor, weakLines } from "../lib/power.js";
import { closest } from "../lib/semantic.js";
import { Spinner, StepCard } from "./ui.jsx";

const GENERAL = [12, 1]; // without the model: "managed" and "built" verbs, which fit most work

export default function Verbs({ cv }) {
  const weak = useMemo(() => (cv ? weakLines(cv.doc.blocks).slice(0, 8) : []), [cv]);
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
      const v = order ? verbsFor(order[i].order, 4, order[i].scores, seen, w) : verbsFor(GENERAL, 4, undefined, seen, w);
      v.forEach((x) => seen.add(x));
      return v;
    });
  }, [weak, order]);

  return (
    <StepCard n={5} id="step-verbs" title="Stronger openings" aside={<span className="text-sm text-ink-3">Suggestions</span>}>
      {!cv ? <p className="text-sm text-ink-3">Add your CV to see which lines could open with a stronger verb.</p>
        : !weak.length ? <p className="text-sm text-ink-3">Every line opens with what you did. Nothing to suggest.</p>
        : order === undefined ? <p className="flex items-center gap-1.5 text-sm text-ink-3" role="status"><Spinner className="size-4 flex-none" />Choosing verbs that fit each line…</p>
        : <>
          <p className="mb-3 text-sm text-ink-3" role="status">
            {weak.length === 1 ? "One line opens" : `${weak.length} lines open`} with a weak phrase. Starting with a verb that says what you did reads
            stronger; {order ? "these fit each line’s meaning, as the language model reads it" : "the language model could not start, so these are general ones"}.
            Change the words in your own file.
          </p>
          <ul className="space-y-3">
            {weak.map((w, i) => (
              <li key={w.block}>
                <p className="line-clamp-2 text-sm"><strong className="font-semibold text-warn">{w.weak}</strong>{w.rest}</p>
                <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label={`Stronger verbs instead of “${w.weak}”`}>
                  {verbs[i].map((v) => <li key={v} className="chip">{v}</li>)}
                </ul>
              </li>
            ))}
          </ul>
        </>}
    </StepCard>
  );
}
