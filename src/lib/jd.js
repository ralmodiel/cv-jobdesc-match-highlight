// Job-description analysis: which parts of the posting describe the job, and which terms in them matter.
import { STOP, sentences, stem, tokenize } from "./text.js";
import { SKILLS, findSkills, stemKey } from "./skills.js";

// First match wins, so the most specific classes come first.
const RULES = [
  ["eeo", /\b(equal (employment )?opportunit|eeo\b|affirmative action|without regard to|discriminat|reasonable accommodation|protected (veteran|characteristic)|e-verify)/i],
  ["apply", /\b(how to apply|to apply|apply now|application process|send (us )?(your|a) (cv|resume)|submit (your|a) (cv|resume|application)|interview process|next steps)\b/i],
  ["benefits", /\b(benefits|perks|what we offer|we offer|compensation|salary|pay range|base pay|401\(?k|pto\b|paid time off|health insurance|dental|parental leave|stipend|why you('|’)ll love)/i],
  ["about", /\b(about (us|the company|the team|our)|who we are|our (mission|story|values|culture)|company overview|why (join|work)|life at|we( are|('|’)re) an? |founded in|headquartered)/i],
  ["about", /^[A-Z][\w&.'’-]*(\s[A-Z][\w&.'’-]*){0,3}\s(is|are)\s(a|an|the|one of)\b.{0,80}\b(company|brand|startup|start-up|firm|agency|business|leader|provider|platform|organi[sz]ation|group|retailer|manufacturer|employer|bank|marketplace|studio|school|hospital|university)\b/],
  ["nice", /\b(nice[- ]to[- ]haves?|preferred|bonus points|a plus|desirable|desired|good to have|ideally|would be great|an advantage)/i],
  ["req", /\b(requirements?|qualifications?|what (you('|’)ll|you will|we) (need|bring)|what we('|’)re looking for|who you are|must[- ]haves?|you have|you bring|about you|required|skills|competenc|expertise|experience)/i],
  ["resp", /\b(responsibilit|what you('|’)ll do|what you will do|the role|your role|duties|day[- ]to[- ]day|you will|in this role|key tasks|job description|role overview|the job|the opportunity)/i],
];
export const SECTION_WEIGHT = { title: 1, req: 1, resp: 0.85, other: 0.7, nice: 0.6, about: 0.15, benefits: 0, eeo: 0, apply: 0 };

// EDGE: filler that is trimmed off the ends of a phrase ("strong experience with X" → X).
// LONE: words that can sit inside a phrase ("customer onboarding") but are never a term on their own.
const EDGE = new Set(("experience experienced years year ability able strong excellent good great solid proven " +
  "demonstrated knowledge understanding familiarity skills skill working including include includes plus new using use " +
  "used related relevant similar equivalent minimum preferred required requirement requirements responsibilities " +
  "responsible ensure ensuring help helping within fast-paced paced dynamic passionate highly high level levels based " +
  "well best ideal ideally etc e.g i.e must need needs want wants looking seek seeking hands-on hands deep broad wide " +
  "range variety various multiple other others key core main major successful track record practical professional " +
  "proficiency proficient expert expertise advanced basic background world-class top fun exciting impactful global " +
  "least like way ways thing things someone everyone anyone today one two three four five six seven eight nine ten " +
  "several many few mid-level entry-level senior junior valid busy reputable").split(" "));
const LONE = new Set([...EDGE, ...("work works team teams role position candidate candidates company job opportunity opportunities field areas area people person time times day days part impact growth remote hybrid onsite office full-time part-time contract permanent salary benefits tools tool technologies technology systems system solutions solution products product services service projects project tasks task processes process business clients client customers customer stakeholders quality standards standard practices practice detail details environment degree bachelor bachelors master masters " +
  "engineer engineers developer developers manager managers designer designers analyst analysts specialist specialists " +
  "consultant consultants member members professional professionals staff colleague colleagues partner partners").split(" ")]);
// ORG: who you work with, trimmed off the end of a phrase ("the content team" → "content").
const ORG = new Set("team teams department departments company organization organisation colleagues people members partners stakeholders staff".split(" "));
const VERBS = new Set(("develop build design manage lead drive own deliver create maintain implement collaborate " +
  "partner support write review analyze analyse improve optimize optimise define identify provide prepare coordinate " +
  "communicate monitor track report present conduct perform execute plan establish oversee mentor train research " +
  "evaluate assess test debug troubleshoot resolve handle organize organise participate contribute grow scale shape " +
  "influence translate gather document deploy integrate automate architect coach recruit hire negotiate sell promote " +
  "teach serve operate apply learn understand know make take give get bring thrive love enjoy enable empower " +
  "establish champion foster ship launch run set keep stay achieve meet exceed act work join turn").split(" ").map((w) => stem(w, true)));
const RANK = new Set(["senior", "junior", "mid-level", "entry-level"]); // the seniority words in EDGE
const SENIORITY = /\b(senior|sr|junior|jr|lead|principal|staff|head|chief|associate|intern|entry[- ]level|mid[- ]level|ii|iii|iv|i)\b\.?/gi;
// Job-board fields ("Job Types: Full-time", "Pay: Php18,000", "Schedule:"): never part of the job's requirements.
const FIELD = /^(job types?|pay|supplemental pay( types)?|schedule|shifts?( and schedule)?|work (location|schedule|setup|arrangement)|ability to commute(\/relocate)?|expected start date|application questions?( ?\(s\))?|contract length|salary( range)?|employment type|location)\s*:/i;
// Job boards' catch-all headings: what follows may be anything, from the company blurb to the requirements.
const CONTAINER = /^(about the job|(full )?job description|job (summary|details|overview)|description)\s*:?$/i;
const VALUE = /\((required|preferred)\)$/i; // Indeed's "English (Required)"
// Words section headings are made of: a short line with any other word ("Experience with BIM") is content, not a heading.
const HEAD = new Set(("about you your we our us the a an and & to of for in at on this who what why how are is you'll we're " +
  "will do need needs bring have has haves looking life join apply role job position opportunity team company mission " +
  "values culture overview summary description details responsibilities responsibility duties tasks key main core " +
  "day-to-day day essential primary requirements requirement qualifications qualification skills skill experience " +
  "education knowledge abilities competencies competency expertise required preferred desired desirable minimum basic " +
  "additional technical professional personal ideal candidate profile nice nice-to-have nice-to-haves plus bonus points " +
  "must must-have must-haves good great extra advantage benefits perks compensation salary pay offer rewards package " +
  "information process next steps").split(" "));
const OFFER = /^(we (offer|provide)|you('|’)ll (get(?! to)|enjoy|receive)|in return\b|our (benefits|perks)|(benefits|perks) include)/i;
// Conditions of the job, not something a CV shows: "Willing to work on shifting schedules", "Must be available to work US hours"
const CONDITION = /^((must|should)\s+)?(be\s+)?(willing|amenable|available|availability|residing)\b|^(can|able to)\s+start\b/i;

/** One line of the posting → { text, cls, w, header } */
// A header with its content on the same line ("Senior Welder. Requirements: 5 years MIG welding, …" from an ad pasted as one
// paragraph, or "Qualifications: BS Nursing, …") gets a line of its own, so the content is classed by it
const unfold = (text) => text.replace(/(^|[.!?])[ \t]*(\p{Lu}[\p{L}'’ &/-]{2,40}?):[ \t]+(?=\S)/gmu, (m, end, h) => {
  const rule = RULES.find(([, re]) => re.test(h));
  return rule && ["req", "resp", "nice", "benefits"].includes(rule[0]) && tokenize(h).every((x) => HEAD.has(x.t)) ? `${end && "\n"}${h}:\n` : m;
});

function classify(text) {
  const lines = unfold(text.replace(/\r\n?/g, "\n")).split("\n");
  const out = [];
  let cur = "other";
  let first = true;
  for (const raw of lines) {
    const t = raw.replace(/^[\s•·▪◦‣●■*>-]+/, "").trim();
    if (!t) continue;
    const words = t.split(/\s+/).length;
    const rule = RULES.find(([, re]) => re.test(t));
    const bullet = /^\s*[•·▪◦‣●■*>–-]\s/.test(raw);
    const looksHeader = !bullet && !VALUE.test(t) && t.length <= 70 && words <= 9 && !/[.!?,;]$/.test(t) &&
      (/:$/.test(t) || t === t.toUpperCase() ||
        (rule && (tokenize(t).every((x) => HEAD.has(x.t)) || (["about", "benefits", "eeo", "apply"].includes(rule[0]) && words <= 6))));
    if (first && words <= 10 && !/:$/.test(t) && !rule && !CONTAINER.test(t)) { out.push({ text: t, cls: "title", w: 1, header: true }); first = false; continue; }
    first = false;
    if (CONTAINER.test(t)) { cur = "other"; out.push({ text: t, cls: cur, w: 0, header: true }); continue; }
    if (FIELD.test(t)) { cur = "benefits"; out.push({ text: t, cls: cur, w: 0, header: true }); continue; }
    if (looksHeader && rule) { cur = rule[0]; out.push({ text: t, cls: cur, w: 0, header: true }); continue; }
    if (looksHeader && /:$/.test(t)) { cur = "other"; out.push({ text: t, cls: cur, w: 0, header: true }); continue; }
    // A sentence about benefits/EEO/applying inside any section still carries no weight.
    let cls = cur;
    if (rule && ["eeo", "apply", "benefits", "about"].includes(rule[0]) && !["req", "resp"].includes(cur)) cls = rule[0];
    else if (rule && rule[0] === "eeo") cls = "eeo";
    else if (OFFER.test(t) || CONDITION.test(t)) cls = "benefits"; // "We offer flexible hours…" under "What we need"
    else if (VALUE.test(t) && cur !== "benefits") cls = /required\)$/i.test(t) ? "req" : "nice";
    out.push({ text: t, cls, w: SECTION_WEIGHT[cls], header: false });
  }
  return out;
}

const cut = (title) => { const i = title.search(/\s[-–—|/]\s|,\s|\s\(/); return i < 0 ? title.length : i; };
const specific = (raw) => /[A-Z].*[A-Z]|\d|[+#.]/.test(raw) || /^[A-Z][a-z]+[A-Z]/.test(raw);

/**
 * analyzeJob(text) → { terms, requirements, lines, title }
 *  terms: [{ key, label, w (0..1), kind: 'skill'|'phrase', cls }] sorted by weight, at most 45
 *  requirements: sentences worth comparing CV lines against (for semantic scoring)
 */
export function analyzeJob(text) {
  const lines = classify(text || "");
  const score = new Map(); // key → { key, label, kind, raw, n, cls }
  const bump = (key, label, kind, w, cls, stemk) => {
    if (w <= 0) return;
    const e = score.get(key) || { key, label, kind, raw: 0, n: 0, cls, stem: stemk };
    e.raw += e.n ? w * 0.35 : w; // repeats matter, but less than breadth
    e.n++;
    if (SECTION_WEIGHT[cls] > SECTION_WEIGHT[e.cls]) e.cls = cls;
    score.set(key, e);
  };
  for (const ln of lines) {
    if (ln.w <= 0 && ln.cls !== "title") continue;
    const w = ln.cls === "title" ? 1 : ln.w;
    const toks = tokenize(ln.text);
    const hits = findSkills(ln.text, toks);
    // Title Case lines capitalise every word, so a capital says nothing there
    const long = toks.slice(1).filter((t) => t.t.length > 3);
    const caps = ln.cls === "title" || long.length >= 2 && long.filter((t) => /^\p{Lu}/u.test(t.raw)).length >= long.length * 0.6;
    // a title's qualifier ("- Night Shift", ", Construction") is not a term
    const end = ln.cls === "title" ? cut(ln.text) : Infinity;
    // a capitalised name mid-sentence keeps its filler words ("a Professional Engineer"), not its rank ("a Senior Accountant")
    const named = new Set();
    for (let i = 1; !caps && i < toks.length; i++) {
      let j = i;
      while (j < toks.length && /^\p{Lu}\p{Ll}/u.test(toks[j].raw) && (j === i || /^ +$/.test(ln.text.slice(toks[j - 1].e, toks[j].s)))) j++;
      if (j - i >= 2 && !/[.!?:;•·▪*>–—-]$/.test(ln.text.slice(0, toks[i].s).trimEnd())) toks.slice(i, j).forEach((t) => RANK.has(t.t) || named.add(t));
      i = Math.max(i, j - 1);
    }
    for (const h of hits) bump(h.key, SKILLS.get(h.key).name, "skill", w * SKILLS.get(h.key).w, ln.cls);
    if (w < 0.3) continue;
    // RAKE-style phrases from what the dictionary did not cover
    const covered = (t) => hits.some((h) => t.s < h.e && t.e > h.s);
    let run = [], tail = false;
    const flush = () => {
      while (run.length && (VERBS.has(stem(run[0].t, true)) || (EDGE.has(run[0].t) && !named.has(run[0])))) run.shift();
      while (run.length && ((EDGE.has(run.at(-1).t) && !named.has(run.at(-1))) || ORG.has(run.at(-1).t) || STOP.has(run.at(-1).t)) && run.at(-1).t !== "needs") run.pop(); // "special educational needs"
      if (run.length > 1 && run.at(-1).raw === "City") run = []; // a place ("our hospital in Quezon City"), not a skill
      if (run.length && run.length <= 4) {
        const words = run.map((t) => t.t);
        const key = stemKey(words);
        const label = ln.text.slice(run[0].s, run[run.length - 1].e);
        const one = run.length === 1;
        if ((!one || (words[0].length > 2 && !LONE.has(words[0]))) && !(one && tail)) { // "Looker Studio": the rest of a known name
          const before = ln.text.slice(0, run[0].s).trimEnd();
          const name = one && !caps && /^\p{Lu}\p{Ll}/u.test(run[0].raw) && before && !/[.!?:•]$/.test(before); // "campaigns in Klaviyo"
          const spec = one && (specific(run[0].raw) || name);
          bump("p:" + key, label, "phrase", w * (one ? (spec ? 0.8 : 0.45) : 0.9), ln.cls, key);
          if (spec) Object.assign(score.get("p:" + key), name && !specific(run[0].raw) ? { spec, name } : { spec });
        }
      }
      run = [];
    };
    for (let i = 0; i < toks.length && toks[i].s < end; i++) {
      const t = toks[i];
      const gap = i ? ln.text.slice(toks[i - 1].e, t.s) : "";
      if (i && /[,;:()[\]/|!?]|\.\s|\s[-–—]\s/.test(gap)) flush();
      if (covered(t) && run.length && /^[\s-]+$/.test(gap)) run = []; // "annual external" of "annual external audit": a modifier, not a term
      const inName = run.length && named.has(t) && named.has(toks[i + 1]); // "Follow Up Boss"
      if (covered(t) || (STOP.has(t.t) && !inName) || /^\d/.test(t.t) || t.t.length < 2 || (EDGE.has(t.t) && !run.length && !named.has(t))) { flush(); continue; }
      // a verb starts a new clause ("engineers design", "the role reports"), unless it heads a compound ("structural design")
      const prev = run.at(-1);
      if (VERBS.has(stem(t.t, true)) && prev && (LONE.has(prev.t) || /[^isu]s$/.test(prev.t) || /([^s]s|ed)$/.test(t.t))) flush();
      if (!run.length) tail = i > 0 && covered(toks[i - 1]) && /^\s+$/.test(gap);
      run.push(t);
    }
    flush();
  }
  // "Qualified Teacher Status (QTS)" is one term that a CV may use either name for; the pieces RAKE cut from it go.
  for (const ln of lines) {
    if (ln.w < 0.3) continue;
    const toks = tokenize(ln.text);
    for (const m of ln.text.matchAll(/\(([A-Z][A-Za-z&]{1,7})\)/g)) {
      const acr = m[1].replace(/(?<=[A-Z])s$/, ""); // KPIs → KPI
      const long = longForm(ln.text, toks, m.index, acr);
      if (!long || findSkills(m[1]).length || findSkills(ln.text.slice(long[0].s, m.index)).length) continue; // the dictionary knows it
      const lk = stemKey(long.map((t) => t.t)), ak = stemKey([acr.toLowerCase()]);
      const within = (a, b) => ` ${b} `.includes(` ${a} `);
      const parts = [...score.values()].filter((e) => e.kind === "phrase" &&
        (e.stem === ak || (e.stem.includes(" ") && (within(e.stem, lk) || within(lk, e.stem)))));
      for (const e of parts) score.delete(e.key);
      const cls = [ln.cls, ...parts.map((e) => e.cls)].reduce((a, b) => (SECTION_WEIGHT[b] > SECTION_WEIGHT[a] ? b : a));
      score.set("p:" + lk, { key: "p:" + lk, label: `${ln.text.slice(long[0].s, long.at(-1).e)} (${m[1]})`, kind: "phrase",
        raw: Math.max(ln.w * 0.9, ...parts.map((e) => e.raw)), n: Math.max(1, ...parts.map((e) => e.n)), cls, stem: lk, alt: [ak] });
    }
  }
  // Job title as a phrase (minus seniority words and "(Year 3)"-style notes): CV lines with the same role are relevant.
  const title = lines.find((l) => l.cls === "title")?.text || "";
  const role = title.slice(0, cut(title)).replace(/\([^)]*\)|\[[^\]]*\]/g, " ").replace(SENIORITY, " ").replace(/[^\p{L}\p{N}+#. -]/gu, " ").replace(/\s+/g, " ").trim();
  if (role && role.split(" ").length <= 5) {
    const words = tokenize(role).map((t) => t.t).filter((w) => !STOP.has(w));
    // a title that is itself a known skill ("Registered Nurse", "Graphic Designer") is a term already, under the skill's name
    const known = findSkills(role).some((h) => h.s === 0 && h.e >= role.length);
    if (words.length >= 2 && !known) bump("p:" + stemKey(words), role, "phrase", 0.8, "title", stemKey(words));
  }
  let list = [...score.values()];
  // single generic-looking words only count when the posting repeats them
  list = list.filter((e) => e.kind === "skill" || e.key.includes(" ") || e.n >= 2 || e.raw >= 0.7 || e.spec);
  const max = Math.max(1, ...list.map((e) => e.raw));
  const terms = list
    .map((e) => {
      const w = +(e.raw / max).toFixed(3);
      // core: what the CV is measured against and listed as missing; phrases outside the requirements are too noisy for that
      const core = e.kind === "skill" ? w >= 0.25 : w >= 0.5 && ["req", "title"].includes(e.cls) && !e.name;
      return { key: e.key, label: e.label, kind: e.kind, cls: e.cls, w, stem: e.stem, core, ...(e.alt && { alt: e.alt }) };
    })
    .sort((a, b) => b.w - a.w)
    .slice(0, 45);
  const requirements = lines
    .filter((l) => !l.header && l.w >= 0.6)
    .flatMap((l) => sentences(l.text).map((s) => s.text))
    .filter((s) => s.split(/\s+/).length >= 4)
    .slice(0, 40);
  return { terms, requirements, lines, title };
}

/** The words right before "(ACR)" whose initials spell it ("Software as a Service (SaaS)" may use stop words), or null. */
function longForm(text, toks, at, acr) {
  const a = acr.toLowerCase();
  let end = at, all = "", content = "", last = -1;
  for (let i = toks.length - 1; i >= 0 && content.length < a.length; i--) {
    const t = toks[i];
    if (t.e > at) continue;
    if (!/^[\s-]*$/.test(text.slice(t.e, end))) return null; // one name: nothing but spaces or hyphens up to the "("
    if (last < 0) last = i;
    end = t.s;
    all = t.t[0] + all;
    if (!STOP.has(t.t)) content = t.t[0] + content;
    if (!STOP.has(t.t) && (content === a || all === a)) return toks.slice(i, last + 1);
  }
  return null;
}

/** A term the user typed: dictionary skill when it is one, otherwise a phrase. */
export function userTerm(label) {
  const toks = tokenize(label);
  const hit = findSkills(label, toks).find((h) => h.s === 0 && h.e >= label.trim().length - 1);
  // typed into the box, a skill's name means that skill in any case ("react" → React), though "react" in prose does not
  const sk = SKILLS.get(hit ? hit.key : label.trim().toLowerCase());
  if (sk) return { key: sk.key, label: sk.name, kind: "skill", cls: "user", w: 1 };
  const words = toks.map((t) => t.t);
  if (!words.length) return null;
  const key = stemKey(words);
  return { key: "p:" + key, label: label.trim(), kind: "phrase", cls: "user", w: 1, stem: key };
}
