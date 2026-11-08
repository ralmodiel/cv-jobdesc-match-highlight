// CV lines that open weakly ("Responsible for…", "Helped…", "Worked on…") and the action verbs ("power words") that could open
// them instead. Which verbs fit is the language model's call: it compares the line with what each kind of verb describes.
// The descriptions and the order of the verbs were tuned on 175 labelled CV lines from many kinds of jobs.
// `more`: verbs offered only when the line names that action itself ("Responsible for configuring…" → Configured).
import { detectSections } from "./match.js";

export const POWER = [
  { about: "led, directed or supervised other people as their manager", verbs: ["Led", "Supervised", "Directed", "Mentored", "Coached", "Headed", "Recruited", "Hired"], more: ["Delegated", "Chaired", "Motivated"] },
  { about: "built, designed or developed a product, system or service", verbs: ["Built", "Designed", "Developed", "Engineered", "Launched", "Created", "Implemented", "Established"], more: ["Configured", "Deployed", "Integrated", "Prototyped", "Programmed"] },
  { about: "improved, sped up, automated or cut the cost of a process", verbs: ["Streamlined", "Improved", "Reduced", "Optimized", "Automated", "Accelerated", "Simplified", "Modernized"], more: ["Standardized", "Consolidated", "Redesigned", "Refactored", "Eliminated"] },
  { about: "won new business, grew revenue or exceeded a sales target", verbs: ["Delivered", "Grew", "Won", "Secured", "Exceeded", "Sold", "Increased", "Generated"], more: ["Expanded", "Converted", "Prospected", "Retained"] },
  { about: "analysed data, researched or investigated a problem", verbs: ["Analyzed", "Researched", "Evaluated", "Investigated", "Diagnosed", "Assessed", "Measured", "Forecasted"], more: ["Benchmarked", "Debugged", "Examined", "Interpreted", "Modeled", "Quantified", "Synthesized"] },
  { about: "collaborated in a team with colleagues or partners, presented or negotiated", verbs: ["Collaborated", "Presented", "Negotiated", "Partnered", "Liaised", "Consulted", "Facilitated", "Represented"], more: ["Advocated", "Aligned", "Mediated", "Moderated"] },
  { about: "planned, scheduled or coordinated work, events, resources or budgets", verbs: ["Organized", "Coordinated", "Planned", "Prioritized", "Orchestrated", "Scheduled", "Budgeted", "Procured"], more: ["Allocated", "Arranged", "Mobilized"] },
  { about: "cared for, served or supported customers, patients or users", verbs: ["Resolved", "Supported", "Advised", "Served", "Safeguarded", "Counseled", "Triaged", "Treated"], more: ["Guided", "Greeted", "Welcomed"] },
  { about: "taught lessons, trained or tutored learners", verbs: ["Taught", "Instructed", "Tutored", "Trained", "Educated", "Lectured", "Demonstrated", "Onboarded"] },
  { about: "kept records, filed paperwork and processed payments or orders", verbs: ["Processed", "Recorded", "Documented", "Reconciled", "Invoiced", "Compiled", "Filed", "Catalogued"], more: ["Tracked", "Updated"] },
  { about: "guarded, protected or kept people and premises safe and secure", verbs: ["Protected", "Monitored", "Patrolled", "Enforced", "Responded", "Mitigated", "Prevented", "Escorted"] },
  { about: "moved, stored, loaded or delivered goods, or drove vehicles", verbs: ["Transported", "Dispatched", "Stocked", "Shipped", "Piloted", "Loaded", "Drove", "Distributed"] },
  { about: "administered, maintained or ran an existing operation, function or resource", verbs: ["Managed", "Oversaw", "Ran", "Administered", "Operated", "Maintained", "Controlled", "Owned"], more: ["Executed"] },
  { about: "wrote, drafted, edited or produced documents, contracts, copy, films or podcasts", verbs: ["Wrote", "Edited", "Produced", "Published", "Authored", "Drafted", "Translated", "Filmed"], more: ["Curated", "Proofread"] },
  { about: "checked records, practices or results against regulations, rules or standards", verbs: ["Audited", "Verified", "Inspected", "Ensured", "Reviewed", "Tested", "Certified", "Validated"] },
  { about: "marketed or publicised a business, offering or message to win an audience's attention", verbs: ["Promoted", "Marketed", "Advertised", "Showcased", "Branded", "Campaigned", "Pitched", "Merchandised"] },
  { about: "repaired, installed or maintained equipment, machines, vehicles or buildings", verbs: ["Repaired", "Installed", "Serviced", "Maintained", "Restored", "Troubleshot", "Calibrated", "Upgraded"], more: ["Assembled", "Replaced"] },
  { about: "prepared, cooked or served food and drinks", verbs: ["Prepared", "Cooked", "Served", "Catered", "Baked", "Plated", "Sourced", "Hosted"] },
];

// "I", "I'm", "was", "have been"… before the opener are part of what to replace ("I was responsible for"); so is a colon after it ("Main duties:").
// Not "made" or "got": "Made partner", "Got promoted" are achievements. "Used" only before "to" ("Used Python to…"), not a skills list ("Used: Excel"), "Used by 3M people" or "Used car sales".
// "Duties", "Tasks" need "included", "were" or ":" after them: "Duties Manager", "Duties and taxes" are a job title and customs.
// "Responsible in/of", "In-charge", "Incharge": common in Philippine, Indian and French English. "Handles", "Assists": a current job.
// "Exposure to", "Gained experience", "Attended to", "Took care of" say what happened to the person, not what they did.
// Not "Assisted living" (a kind of care home) or "Working at heights" (a safety ticket).
// "Leveraged", "Synergized", "Strategized" are buzzwords that hide what was done; not "Leveraged buyout" (a kind of deal).
const WEAK = /^(?:I(?:['’](?:m|ve))?\s+)?(?:(?:was|were|am|is|are|(?:have|has)\s+been|been)\s+)?(?:responsible\s+(?:for|in|of)|in[\s-]?charge\s+(?:of|for)|tasked\s+(?:with|to)|(?:(?:my|main|key|job|daily|other|day-to-day)\s+)?(?:duties|responsibilities|tasks)(?:\s+(?:includ(?:ed|es?)|were|are|consist(?:ed|s)\s+of)|(?=\s*:))|my\s+(?:main\s+)?(?:role|job|responsibility)\s+(?:was|is|involved|includ(?:ed|es?))(?:\s+to)?|involved\s+(?:in|with)|participat(?:ed|ing)\s+in|took\s+part\s+in|part\s+of|took\s+care\s+of|attended\s+to|expos(?:ure|ed)\s+to|gained\s+(?:\S+\s+)?experience|help(?:s|ed|ing)(?:\s+(?:to|with))?|assist(?:s|ed|ing)?(?!\s+living)(?:\s+(?:in|with))?|work(?:s|ed|ing)(?:\s+(?:closely|directly))?(?!\s+at\s+heights)(?:\s+(?:on|in|as|at|for|alongside)|(?=\s+with\b(?!\s+children\s+check)))|handl(?:es|ed|ing)|deal(?:s|t|ing)\s+with|did|made\s+sure|used\s+to|(?:used|utili[sz]ed)(?!\s+(?:by|cars?)\b)(?=\s[^:]*\bto\s)|leverag(?:e[sd]?|ing)(?!\s+(?:buy-?outs?|financ\w*|loans?|ratios?)\b)|(?:synergi[sz]|strategi[sz])(?:e[sd]|ing)|had)\b(?:\s*:)?/i;

// Before the opener: a bullet or number ("• ", "1."), a list letter ("a)", "ii."), a date ("Jan 2020 – ", "Mar 2017 – Present: ", "Q3 2021: ").
const LEAD = /^(?:[^\p{L}]+|\p{L}{1,3}[.)](?=\s)|(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|q[1-4]|spring|summer|autumn|fall|winter)\b\.?(?=\s*\d)|(?:present|current)\b)+/iu;

/** Lines (blocks, not headings or contact details) that open weakly: [{ block, weak: the opener, rest: the line after it }]. */
export function weakLines(blocks) {
  const secs = detectSections(blocks), out = [];
  blocks.forEach((b, i) => {
    if (secs[i].heading || secs[i].contact) return;
    const text = b.text.replace(LEAD, ""), m = text.match(WEAK);
    // under 30% lowercase words is a title, not a sentence: "Assisted Living Caregiver, …", "Handling Hazardous Substances (COSHH) Level 2";
    // but no title opens "Responsible for" or "In charge of": "RESPONSIBLE FOR PAYROLL" is a bullet in capitals
    const words = text.split(/\s+/), lower = text.match(/(?:^|\s)\p{Ll}/gu)?.length ?? 0;
    if (m && words.length >= 4 && (lower >= 0.3 * words.length || /responsible|charge/i.test(m[0]))) {
      const rest = text.slice(m[0].length);
      out.push({ block: i, weak: m[0], rest, own: ownVerb(rest, m[0].trim()) });
    }
  });
  return out;
}

// The line's own action, when it names one right after the opener: "Involved in the design of…" → Designed, "Responsible for
// managing…" → Managed, "Helped to plan…" → Planned, "Had developed…" → Developed. A noun only before "of"/"and" ("the design of"), not "the design team";
// not an event attended ("Participated in training sessions"). Stems of 4+ letters; the longest stem that fits wins ("servicing": Serviced).
// shortcut: irregular verbs (leading → Led, teaching → Taught) are not matched, the model picks those; add a map if lines need them.
const STEMS = POWER.flatMap((p, k) => [...p.verbs, ...(p.more ?? [])].map((v) => [v.toLowerCase().replace(/ied$/, "y").replace(/e?d$/, "").replace(/([^aeiou])\1$/, "$1"), v, k]))
  .filter(([s]) => s.length >= 4).sort((a, b) => b[0].length - a[0].length);
function ownVerb(rest, opener) {
  const to = /(?:used|utili[sz]ed|leverag\w*)$/i.test(opener) && rest.match(/\bto\s+([a-z].*)$/i);
  if (to) return ownVerb(to[1], "to"); // "Used Excel to automate…" → Automated
  const m = rest.match(/^\s*(?:(?:the|a|an|all)\s+)?([a-z]+)\b(?:\s+(\S+))?/i);
  if (!m) return undefined;
  const [, w, next = ""] = [m[0], m[1].toLowerCase(), m[2]?.toLowerCase()];
  const noun = /^(?:of|and|&|,)/.test(next), gerund = /ing$/.test(w) && !/^(?:sessions?|courses?|programm?es?|workshops?|seminars?|meetings?|on|in)\b/.test(next);
  if (!(noun || gerund || /\bto$/i.test(opener) || (/\bhad$/i.test(opener) && /ed$/.test(w)))) return undefined; // "Had developed", not "Worked on automated tests"
  const hit = STEMS.find(([s]) => w.startsWith(s)) || STEMS.find(([s]) => s.length >= 5 && w.startsWith(s.slice(0, -1)));
  return hit && { verb: hit[1], kind: hit[2] };
}

// Verbs that fit one line of work only: shown when the line, after its opener, has one of their cue words ("Patrolled" for a guard,
// not for SSO; "Responsible for" is no cue for "Responded").
const CUE = Object.fromEntries(Object.entries({
  Recruited: "recruit|hiring|hire|candidate|talent|vacanc", Hired: "recruit|hiring|hire|candidate|talent|vacanc",
  Won: "won|win|contract|tender|bid|deal|award|account", Secured: "contract|tender|fund|grant|deal|sponsor|investment|bid|account",
  Sold: "sell|sold|sale|retail|upsell|quota", Exceeded: "target|quota|exceed|kpi|goal",
  Diagnosed: "diagnos|fault|bug|error|symptom|root cause|troubleshoot|patient|outage", Forecasted: "forecast|budget|demand|projection|trend",
  Negotiated: "negotiat|contract|supplier|vendor|deal|terms|pric|agreement|salar|dispute", Represented: "represent|on behalf|union|committee|board|court|tribunal|council",
  Budgeted: "budget|cost|spend|fund|financ|expens", Procured: "procur|purchas|buy|order|supplier|vendor|sourc|tender",
  Triaged: "triag|ticket|incident|patient|emergenc|case|queue", Treated: "treat|patient|wound|injur|therap|clinic|animal",
  Counseled: "counsel|therap|grief|career|mental|famil", Safeguarded: "safeguard|child|vulnerable|welfare|elderly|young people|resident",
  Lectured: "lectur|universit|college|undergrad|faculty|seminar", Tutored: "tutor|one-to-one|1:1|pupil|homework|exam",
  Onboarded: "onboard|new hire|new staff|new starter|new employee|induction",
  Invoiced: "invoic|billing|receivable", Reconciled: "reconcil|ledger|statement|till|cash|bank|balanc", Catalogued: "catalog|archiv|collection|librar|museum|specimen",
  Patrolled: "patrol|guard|premises|perimeter|grounds", Escorted: "escort|accompan|visitor|vip|convoy|cash-in-transit|prisoner|detainee",
  Piloted: "pilot|aircraft|drone|flight|vessel|helicopter|trial", Drove: "drove|drive|driving|vehicle|van|truck|lorry|forklift|bus|fleet|route",
  Loaded: "load|pallet|truck|lorry|container|cargo|freight", Shipped: "ship|parcel|freight|release|feature",
  Dispatched: "dispatch|parcel|shipment|courier|driver|fleet|consignment", Stocked: "stock|shelf|shelves|replenish|inventor|supplies|pantry",
  Filmed: "film|video|footage|camera|shoot|documentar", Translated: "translat|interpret|languag|bilingual|locali",
  Certified: "certif|accredit|licen|iso", Merchandised: "merchandis|display|shelf|shelves|planogram|window|visual",
  Branded: "brand|logo|identity|packaging", Campaigned: "campaign|advoca|election|petition|awareness", Pitched: "pitch|investor|proposal|prospect|new business",
  Calibrated: "calibrat|instrument|gauge|sensor|meter|scale", Serviced: "servic|boiler|hvac|engine|fleet",
  Cooked: "cook|meal|dish|food|kitchen|menu|grill|chef|breakfast|lunch|dinner", Baked: "bak|bread|pastr|cake|dessert|oven|dough",
  Plated: "plat|dish|fine dining|garnish", Catered: "cater|function|wedding|banquet|buffet", Hosted: "host|guest|webinar|podcast|show|party",
  Processed: "process|payroll|payment|order|application|claim|transaction|refund|return|request|form|booking|enrol|admission|visa|permit|loan|invoice",
  Recorded: "record|log|minutes|track|data|entry|enter|note|chart|register|dose|attendance|incident|reading",
  Documented: "document|record|report|note|log|minutes|procedure|manual|spec|chart|case|incident|process",
  Compiled: "compil|report|data|list|figure|statistic|dossier|summar|survey|reading", Filed: "file|filing|paperwork|claim|tax|record",
  Presented: "present|demo|talk|pitch|stakeholder|board|conference|webinar|brief|meeting|showcase|slide",
  Resolved: "resolv|issue|complaint|problem|ticket|quer|enquir|inquir|dispute|incident|fault|escalat|conflict",
  Served: "serv|customer|guest|client|patron|diner|table|communit|meal|food|drink|coffee|bar|committee|board",
  Advised: "advi|guidance|recommend|consult|client|customer|patient|student|famil|risk|polic|option",
  Installed: "install|fitt|set up|setup|deploy|wiring|rollout|roll-out|roll out|cabl|mount",
  Repaired: "repair|fix|fault|broken|damage|maintenan|breakdown|machin|vehicle|engine|plumb|electric|hvac|roof|equipment",
  Audited: "audit|complian|regulat|inspect|account|financ|record|control|standard",
  Monitored: "monitor|cctv|camera|alarm|watch|observ|track|vital|level|alert|surveil|dashboard|log|metric|perform|progress|complian",
  Responded: "respon|incident|alarm|emergenc|call|ticket|request|complaint|enquir|inquir|alert|quer",
  Enforced: "enforc|rule|polic|law|regulat|complian|bylaw|code|permit|standard|lockout|dress",
  Transported: "transport|haul|carr|goods|cargo|freight|patient|passenger|deliver|vehicle|move|moving",
  Distributed: "distribut|hand out|handed out|handing out|leaflet|flyer|food|parcel|aid|supplies|newsletter|report|deliver",
  Trained: "train|staff|employee|colleague|trainee|volunteer|user|apprentice|new hire|course|workshop",
  Taught: "teach|taught|class|lesson|pupil|student|learner|instruct|course|curricul|school|educat|tutor|workshop|train",
  Instructed: "teach|taught|class|lesson|pupil|student|learner|instruct|course|curricul|school|educat|tutor|workshop|train",
  Educated: "teach|taught|class|lesson|pupil|student|learner|instruct|course|curricul|school|educat|tutor|workshop|train|public|awareness",
  Mentored: "mentor|coach|junior|intern|trainee|new hire|new starter|new staff|apprentice|student|graduate", Coached: "coach|mentor|junior|intern|trainee|player|athlete|team|staff|student",
  Researched: "research|stud|survey|literature|investigat|data|market|trend|source|evidence|paper|interview",
  Verified: "verif|check|data|record|identit|document|account|invoice|accura|complian|ids?\\b|eligib|reference",
  Wrote: "writ|wrote|draft|copy|article|content|report|document|blog|post|letter|proposal|grant|newsletter|spec|press|script|code|test|polic|procedure|update",
  Edited: "edit|copy|article|content|video|film|newsletter|manuscript|proof|publication|magazine|journal|book",
  Marketed: "market|campaign|brand|social|seo|content|launch|product|audience|promot|advert",
  Promoted: "promot|market|campaign|brand|social|event|product|awareness|advert|launch|audience",
  Grew: "grow|growth|increas|revenue|sales|traffic|follower|subscriber|member|income|donat|audience|user|customer|client|base",
  Inspected: "inspect|site|building|equipment|vehicle|goods|premises|machin|quality|safety|stock|deliver|food|hygiene|propert|construct",
  Mitigated: "mitigat|risk|threat|vulnerab|exposure|hazard|impact", Prevented: "prevent|loss|theft|fraud|accident|infection|fall|shrink|injur|outage",
  Sourced: "sourc|supplier|vendor|produce|ingredient|procur|purchas|candidate|talent|material", Restored: "restor|backup|recover|outage|renovat|heritage|furniture|disaster",
  Led: "lead|team|staff|crew|people|report|volunteer|group|department|unit|shift|squad|project|initiative|program|migration|rollout|meeting|workshop|session|effort|campaign|launch|review|investigation|implementation",
  Supervised: "supervis|team|staff|crew|employee|worker|shift|volunteer|student|children|pupil|trainee|intern|contractor|site|operation",
  Directed: "direct|team|staff|department|operation|program|project|production|strateg|campaign", Headed: "head|team|department|unit|division|committee|project",
}).map(([v, c]) => [v, new RegExp(`\\b(?:${c})`, "i")]));
// After "Helped", "Assisted", "Participated in"…, a verb that says the person was in charge claims more than the line does.
const LEADS = new Set(["Led", "Directed", "Headed", "Supervised", "Oversaw", "Owned", "Orchestrated", "Chaired", "Delegated"]);
const SUPPORTING = /help|assist|particip|took part|part of|involved|support|expos|gained/i;
const fits = (v, line) => !line || ((!CUE[v] || CUE[v].test(line.rest)) && !(LEADS.has(v) && SUPPORTING.test(line.weak)));

const MARGIN = 0.02; // a line this much closer (cosine) to one kind than to the next gets that kind's verbs alone

/** Up to n verbs for one line, from the kinds of POWER in `order` (closest in meaning first): the two closest kinds take turns,
 *  or the closest alone when `scores` (sorted like order) put it ahead by more than MARGIN. Verbs in `seen` (shown for
 *  earlier lines) go last, so lines of the same kind get different verbs. */
export function verbsFor(order, n = 4, scores, seen = new Set(), line, ad = new Set()) {
  const own = line?.own && !(LEADS.has(line.own.verb) && SUPPORTING.test(line.weak)) ? line.own : undefined; // "Helped to supervise…" is not Supervised
  if (own) { order = [own.kind, ...order.filter((k) => k !== own.kind)]; scores = [1, 0]; } // the line's own action: its kind alone, its verb first
  const [a, b] = order.map((k) => (own && k === own.kind ? [own.verb, ...POWER[k].verbs] : POWER[k].verbs).filter((v) => v === own?.verb || fits(v, line)));
  const c = order.slice(2, 4).flatMap((k) => POWER[k].verbs.filter((v) => fits(v, line))); // the next kinds fill in when cues leave too few
  const pool = [...new Set([...(scores && scores[0] - scores[1] > MARGIN ? [...a, ...b] : a.flatMap((v, i) => [v, b?.[i]]).filter(Boolean)), ...c])];
  // verbs the ad uses, from the two closest kinds, come next after the line's own: at most two, so the best fits by meaning still show
  const fromAd = pool.filter((v) => v !== own?.verb && ad.has(v) && (a.includes(v) || b?.includes(v))).slice(0, 2);
  const top = [...new Set([...pool.slice(0, own ? 1 : 0), ...fromAd, ...pool])].slice(0, n); // variety only among the best fits: deeper verbs are narrower ("Established", "Diagnosed")
  return [...top.filter((v) => v === own?.verb || !seen.has(v)), ...top.filter((v) => v !== own?.verb && seen.has(v))].slice(0, n);
}

/** The verbs of POWER that the job ad itself uses ("coordinate", "reconciling" → Coordinated, Reconciled): shown first where they fit.
 *  shortcut: stems of 4+ letters, so irregular verbs (lead → Led, build → Built) are not matched; add a map if ads need them. */
export function adVerbs(text) {
  const low = text.toLowerCase();
  return new Set(STEMS.filter(([s]) => new RegExp(`\\b${s}${s.at(-1)}?(?:e|es|ed|ing|s)?\\b`).test(low)).map(([, v]) => v));
}

const OPENERS = new Map(POWER.flatMap((p, k) => [...p.verbs, ...(p.more ?? [])].map((v) => [v.toLowerCase(), [v, k]])).reverse()); // first kind wins

/** Verbs that open `min` or more body lines ("Managed" five times reads like a template), most used first, up to three:
 *  [{ verb, count, alt: up to four verbs of the same kind that fit one of those lines }].
 *  shortcut: alternatives come from the verb's kind, not from each line's meaning; ask the model per line if they read too alike. */
export function repeatedOpeners(blocks, min = 3) {
  const secs = detectSections(blocks), by = new Map();
  blocks.forEach((b, i) => {
    if (secs[i].heading || secs[i].contact) return;
    const text = b.text.replace(LEAD, ""), first = text.match(/^\p{L}+/u)?.[0] ?? "", hit = OPENERS.get(first.toLowerCase());
    const words = text.split(/\s+/), lower = text.match(/(?:^|\s)\p{Ll}/gu)?.length ?? 0;
    if (!hit || words.length < 4 || lower < 0.3 * words.length) return; // a title ("Managed Services Engineer"), not a line
    by.set(hit[0], [...(by.get(hit[0]) ?? []), { k: hit[1], weak: "", rest: text.slice(first.length) }]);
  });
  return [...by].filter(([, l]) => l.length >= min).sort((x, y) => y[1].length - x[1].length).slice(0, 3)
    .map(([verb, l]) => ({ verb, count: l.length, alt: POWER[l[0].k].verbs.filter((v) => v !== verb && l.some((x) => fits(v, x))).slice(0, 4) }));
}
