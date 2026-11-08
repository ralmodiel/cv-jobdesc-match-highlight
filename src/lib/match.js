// CV ↔ job matching: turns blocks of CV text plus an analysed job into emphasis marks.
import { tokenize } from "./text.js";
import { SKILLS, findSkills, related, stemKey } from "./skills.js";

const HEADINGS = [
  // no "customer"/"user" prefix: "Customer Experience" is a skill, not a section
  ["experience", /^(?:(?:professional|work|relevant|related|career|employment|industry|teaching|clinical|nursing|practicum|research|military|freelance|consulting|other|additional|previous|international|overseas)\s+)?(?:experiences?|employment(?:\s+(?:history|record))?|work\s+history|career\s+history|positions?\s+held)$|^internships?$|^on[- ]the[- ]job\s+training$|^ojt$|^professional\s+background$/i],
  ["education", /^(?:education(?:al\s+(?:attainment|background))?(?:\s*(?:and|&)\s*training)?|academic\s+(?:background|qualifications|history)|qualifications|(?:relevant\s+)?coursework|courses|training)$/i],
  ["skills", /^(?:(?:technical|core|key|professional|relevant|soft|computer|language|other|additional)\s+)?(?:skills?(?:\s*(?:and|&)\s*(?:tools|technologies|abilities|expertise|competencies))?|competencies|core\s+competencies|expertise|areas\s+of\s+expertise|technologies|tools|tech\s+stack|technical\s+proficiencies)$|^(?:key\s+)?strengths$/i],
  ["projects", /^(?:(?:personal|selected|key|academic|side)\s+)?projects?$/i],
  ["certs", /^(?:certifications?|(?:professional\s+)?licen[cs]es?|certifications?\s*(?:and|&)\s*licen[cs]es?|licen[cs]es?\s*(?:and|&)\s*certifications?|accreditations?|(?:civil\s+service\s+)?eligibilit(?:y|ies)|(?:seminars?|trainings?)(?:\s*(?:and|&)\s*(?:seminars?|trainings?|workshops?))?(?:\s+attended)?|professional\s+development)$/i],
  ["summary", /^(?:(?:professional|career|executive)\s+)?(?:summary|profile|objective|overview)$|^about(?:\s+me)?$|^personal\s+statement$|^(?:qualifications\s+summary|summary\s+of\s+qualifications|profile\s+summary)$/i],
  ["other", /^(?:awards?(?:\s*(?:and|&)\s*(?:honou?rs|recognitions?))?|honou?rs(?:\s*(?:and|&)\s*awards?)?|recognitions?|(?:key\s+)?achievements|accomplishments|career\s+highlights|publications|research|volunteer(?:ing|\s+experience|\s+work)?|leadership(?:\s+experience)?|activities|extracurricular(?:\s+activities)?|(?:professional\s+)?(?:affiliations|memberships|organi[sz]ations)|interests|hobbies|languages|(?:character\s+)?references|contact(?:\s+(?:details|information))?|personal\s+(?:details|information|data|background|particulars))$/i],
];
const NOT_HIGHLIGHTED = /^(interests|hobbies|languages)/i; // words may be bold, but no line is highlighted
const UNMARKED = /^(character|references|contact|personal)/i; // other people's titles or private data: nothing is marked

const CONTACT = /[\w.+-]+@[\w-]+\.[\w.]+|(?:\+?\d[\d\s().-]{7,}\d)|https?:\/\/|www\.|linkedin\.com|github\.com/i;

/** Per block: { section, heading, contact } where section is experience|education|skills|projects|certs|summary|other|skip|none|null. */
export function detectSections(blocks) {
  // Text boxes (DOCX) are separate stories: a sidebar's "Languages" heading must not swallow the main column.
  const cur = new Map();
  let seenHeading = false, nonEmpty = 0;
  return blocks.map((b) => {
    const story = b.story || 0;
    const t = b.text.trim().replace(/[:\s]+$/, "");
    const words = t.split(/\s+/).filter(Boolean).length;
    if (words) nonEmpty++;
    // a list item is content: "• Leadership" in a skills list is not the "Leadership" section
    const h = b.kind !== "bullet" && words && words <= 6 && t.length <= 48 && HEADINGS.find(([, re]) => re.test(t.replace(/\s+/g, " ")));
    if (h) {
      cur.set(story, h[0] !== "other" ? h[0] : UNMARKED.test(t) ? "none" : NOT_HIGHLIGHTED.test(t) ? "skip" : "other");
      seenHeading = true;
      return { section: cur.get(story), heading: true, contact: false };
    }
    const contact = CONTACT.test(t) && words <= 14;
    // Before the first heading, the first short block is the person's name.
    const name = !seenHeading && words && nonEmpty <= 2 && words <= 5 && !/[.,;]/.test(t) && !CONTACT.test(t);
    return { section: cur.get(story) ?? cur.get(0) ?? null, heading: b.kind === "heading" && words <= 8, contact: !!(contact || name) };
  });
}

export const DENSITY = {
  light: { perTerm: 1, total: 18, related: 6, lineFrac: 0.12, lineMax: 4 },
  balanced: { perTerm: 2, total: 36, related: 12, lineFrac: 0.22, lineMax: 7 },
  strong: { perTerm: 4, total: 72, related: 24, lineFrac: 0.35, lineMax: 12 },
};
const SEC_RANK = { skills: 0, experience: 1, projects: 2, summary: 3, certs: 4, education: 5, other: 6, skip: 8 };

/**
 * matchCV(blocks, job, opts) → { marks, found, missing, lines }
 *  blocks: [{ text, kind }]; job: analyzeJob() result
 *  opts: { density, exclude:Set<termKey>, extra:[userTerm], sem: number[] per block (0..1) | null }
 *  marks: [{ block, start, end, cat: 'keyword'|'related'|'line', term, label, via? }]
 */
export function matchCV(blocks, job, opts = {}) {
  const d = DENSITY[opts.density] || DENSITY.balanced;
  const exclude = opts.exclude || new Set();
  // Every term is looked for (a switched-off one is still in the CV, so still found); only `terms` are marked.
  const all = [...job.terms, ...(opts.extra || [])];
  const terms = all.filter((t) => !exclude.has(t.key));
  const byKey = new Map(all.map((t) => [t.key, t]));
  const phrases = new Map(all.filter((t) => t.kind === "phrase" && t.stem).flatMap((t) => [t.stem, ...(t.alt || [])].map((k) => [k, t])));
  const maxN = Math.max(1, ...[...phrases.keys()].map((k) => k.split(" ").length));
  const jdSkills = all.filter((t) => t.kind === "skill"); // switched-off ones too: their related words go unmarked, not to another term
  const secs = detectSections(blocks);
  const kw = [];
  const rel = [];
  const blockTerms = blocks.map(() => new Map());
  const seen = new Set();

  blocks.forEach((b, bi) => {
    const sec = secs[bi];
    if (sec.heading || sec.contact || sec.section === "none") return;
    const toks = tokenize(b.text);
    const hits = [];
    for (const h of findSkills(b.text, toks)) {
      const t = byKey.get(h.key);
      if (t) { hits.push({ s: h.s, e: h.e, t, rel: false }); continue; }
      let best = null;
      for (const j of jdSkills) if (related(h.key, j.key) && (!best || j.w > best.w)) best = j;
      if (best) hits.push({ s: h.s, e: h.e, t: best, rel: true, via: SKILLS.get(h.key).name });
    }
    if (phrases.size) {
      const keys = toks.map((t) => t.t);
      const adj = toks.map((t, i) => i + 1 < toks.length && /^[\s-]+$/.test(b.text.slice(t.e, toks[i + 1].s)));
      for (let i = 0; i < toks.length; i++) {
        let n = 1;
        while (n < maxN && i + n < toks.length && adj[i + n - 1]) n++;
        for (; n >= 1; n--) {
          const t = phrases.get(stemKey(keys.slice(i, i + n)));
          if (t) { hits.push({ s: toks[i].s, e: toks[i + n - 1].e, t, rel: false }); if (!exclude.has(t.key)) break; }
        }
      }
    }
    // Longest span wins ("Frontend Engineer" over "Frontend"); an exact term beats a related one of equal length.
    hits.sort((x, y) => (y.e - y.s) - (x.e - x.s) || x.rel - y.rel || x.s - y.s);
    const taken = [];
    for (const h of hits) if (!h.rel) seen.add(h.t.key); // "Frontend" inside "Frontend Engineer" still counts as found
    for (const h of hits) {
      if (exclude.has(h.t.key) || taken.some((o) => h.s < o.e && h.e > o.s)) continue;
      taken.push(h);
      const base = { block: bi, start: h.s, end: h.e, term: h.t.key, label: h.t.label, sec: sec.section };
      if (!h.rel) {
        kw.push({ ...base, cat: "keyword", w: h.t.w });
        blockTerms[bi].set(h.t.key, h.t.w);
      } else {
        rel.push({ ...base, cat: "related", via: h.via, w: h.t.w * 0.5 });
        if (!blockTerms[bi].has(h.t.key)) blockTerms[bi].set("~" + h.via, h.t.w * 0.5);
      }
    }
  });

  const keywords = cap(kw, d.perTerm, d.total);
  const relateds = cap(rel, 1, d.related, (m) => m.via.toLowerCase());

  // Lines: score bullets/paragraphs by the weight of distinct terms they contain (+ semantic similarity when ready).
  const sem = opts.sem;
  const cands = [];
  blocks.forEach((b, i) => {
    const s = secs[i];
    const words = b.text.split(/\s+/).filter(Boolean).length;
    // Skills lists are already bolded term by term; highlight is for evidence (experience, projects, summary).
    if (s.heading || s.contact || ["none", "skip", "education", "skills", "certs"].includes(s.section) || words < 6) return;
    if (words <= 12 && /\b(19|20)\d{2}\b|\bpresent\b/i.test(b.text)) return; // role/date line, not a bullet
    let lex = 0;
    for (const w of blockTerms[i].values()) lex += w;
    cands.push({ i, lex, sem: sem ? sem[i] ?? 0 : null, words });
  });
  const maxLex = Math.max(1e-9, ...cands.map((c) => c.lex));
  for (const c of cands) c.score = c.sem == null ? c.lex / maxLex : 0.6 * (c.lex / maxLex) + 0.4 * c.sem;
  const k = Math.min(d.lineMax, Math.max(1, Math.round(d.lineFrac * cands.length)));
  const picked = cands.filter((c) => c.lex > 0 || (c.sem ?? 0) >= 0.55).sort((a, b) => b.score - a.score).slice(0, k);
  const lines = [];
  for (const c of picked) {
    const text = blocks[c.i].text;
    const start = text.search(/[\p{L}\p{N}]/u);
    const end = text.trimEnd().length;
    if (start >= 0 && end > start) lines.push({ block: c.i, start, end, cat: "line", term: null, label: null, score: +c.score.toFixed(3) });
  }

  const count = new Map();
  for (const m of kw) count.set(m.term, (count.get(m.term) || 0) + 1);
  const found = all.filter((t) => seen.has(t.key)).map((t) => ({ ...t, count: count.get(t.key) || 0 }));
  const relatedTo = new Set(rel.map((m) => m.term));
  // Missing: the job's core terms (jd.js) that are nowhere in the CV.
  const missing = all.filter((t) => !seen.has(t.key) && t.core).map((t) => ({ ...t, related: relatedTo.has(t.key) }));
  const strip = ({ w, sec, ...m }) => m;
  const marks = [...keywords, ...relateds, ...lines].map(strip).sort((a, b) => a.block - b.block || a.start - b.start);
  return { marks, found, missing, lines: picked.map((c) => ({ block: c.i, score: c.score })) };
}

// Keep up to `perTerm` occurrences per term, spread across CV sections (skills list first, then experience), then the
// `total` heaviest overall.
function cap(list, perTerm, total, keyOf = (m) => m.term) {
  const by = new Map();
  for (const m of list) {
    const k = keyOf(m);
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(m);
  }
  const kept = [];
  for (const occ of by.values()) {
    occ.sort((a, b) => (SEC_RANK[a.sec] ?? 7) - (SEC_RANK[b.sec] ?? 7) || a.block - b.block || a.start - b.start);
    const seen = new Set();
    const first = [], rest = [];
    for (const m of occ) (seen.has(m.sec) ? rest : first).push(m), seen.add(m.sec);
    kept.push(...[...first, ...rest].slice(0, perTerm));
  }
  return kept.sort((a, b) => b.w - a.w).slice(0, total);
}
