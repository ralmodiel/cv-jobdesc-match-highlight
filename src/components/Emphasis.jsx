// Step 4: how matches are marked. Each option is drawn in its own style, so the choice explains itself.
import { useId } from "react";
import { Seg, StepCard } from "./ui.jsx";

const ROWS = [
  ["keyword", "Exact matches", "skills and phrases the job names"],
  ["related", "Related skills", "e.g. Vue for a React job"],
  ["line", "Best lines", "your bullets that fit the job most"],
];
export const COLORS = [["#fff59d", "Yellow"], ["#c6f0c2", "Green"], ["#cfe3ff", "Blue"], ["#ffd6e6", "Pink"], ["#ffdfb0", "Orange"]];
const DENSITY = [["light", "Light"], ["balanced", "Balanced"], ["strong", "Strong"]];
const DENSITY_HINT = { light: "Only the strongest matches.", balanced: "The main matches in every section.", strong: "Every match, and more lines." };

export default function Emphasis({ styles, onStyles, density, onDensity }) {
  const colorName = useId();
  const marks = [
    ["bold", <b key="b">Bold</b>],
    ["underline", <u key="u" className="underline-offset-2">Underline</u>],
    ["highlight", <span key="h" className="rounded-sm px-1 text-[#1c1b1f]" style={{ background: styles.color }}>Highlight</span>],
    ["off", "Off"],
  ];
  return (
    <StepCard n={4} id="step-style" title="How to mark it" aside={<span className="text-sm text-ink-3">Optional</span>}>
      <div className="grid gap-4">
        {ROWS.map(([k, label, hint]) => (
          <Seg key={k} legend={<>{label} <span className="font-normal text-ink-3">· {hint}</span></>} value={styles[k]}
            onChange={(v) => onStyles({ ...styles, [k]: v })} options={marks} />
        ))}
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-ink-2">Highlight colour</legend>
          <div className="flex flex-wrap gap-2.5">
            {COLORS.map(([c, name]) => (
              <label key={c} className="swatch" title={name}>
                <input type="radio" name={colorName} value={c} checked={styles.color === c} aria-label={name}
                  onChange={() => onStyles({ ...styles, color: c })} />
                <span style={{ background: c }} />
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <Seg legend="How much to mark" value={density} onChange={onDensity} options={DENSITY} />
          <p className="mt-1.5 text-sm text-ink-3">{DENSITY_HINT[density]}</p>
        </div>
      </div>
      {/* on one-column screens the preview is above this card */}
      <a href="#preview" className="link mt-2 inline-flex min-h-11 items-center text-sm lg:hidden">See it in the preview<span aria-hidden="true">&nbsp;↑</span></a>
    </StepCard>
  );
}
