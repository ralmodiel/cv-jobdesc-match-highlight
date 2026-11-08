// Step 2: the job description, pasted as text. Analysed as the person types (deferred), so there is no "analyse" button.
import { useRef } from "react";
import { LIMITS } from "../lib/files.js";
import { Settled, StepCard } from "./ui.jsx";

export default function JobInput({ job, onChange, analysis }) {
  const area = useRef(null);
  const n = analysis.terms.filter((t) => t.core).length; // the same total as the meter in step 3
  const short = job.trim() && job.trim().split(/\s+/).length < 25;
  return (
    <StepCard n={2} id="step-job" title="The job description" done={n > 0 && !short}
      aside={job && <button type="button" className="link px-1 py-1 text-sm pointer-coarse:-my-2 pointer-coarse:px-2 pointer-coarse:py-3"
        onClick={() => { onChange(""); area.current.focus(); }}>Clear<span className="sr-only"> the job description</span></button>}>
      <label htmlFor="job" className="sr-only">Job description</label>
      <textarea ref={area} id="job" className="field" rows={8} value={job} maxLength={LIMITS.jobChars} spellCheck={false}
        placeholder="Paste the whole job ad here: title, responsibilities and requirements."
        aria-describedby="job-hint" onChange={(e) => onChange(e.target.value)} />
      <Settled id="job-hint" className="mt-2 text-sm text-ink-3">
        {!job.trim() ? "Tip: include the requirements section; that is where the keywords are."
          : short ? "That looks short. Paste the full ad for better matches."
          : n ? <>Found <strong className="text-ink">{n} key terms</strong>{analysis.title ? <> for <em className="not-italic text-ink">{analysis.title.slice(0, 60)}</em></> : null}.</>
          : `${analysis.terms.length ? "Found a few terms but no clear requirements." : "No skills or requirements recognised."} Ads in English with a requirements section work best.`}
        {job.length >= LIMITS.jobChars && ` Only the first ${LIMITS.jobChars.toLocaleString("en-US")} characters fit; if the requirements come later, paste just that part.`}
      </Settled>
    </StepCard>
  );
}
