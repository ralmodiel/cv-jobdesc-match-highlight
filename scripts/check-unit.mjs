// Node checks for the matching engine: node scripts/check-unit.mjs → "N checks, M FAIL", exit 1 on any FAIL.
import { tokenize, stem, sentences } from "../src/lib/text.js";
import { findSkills } from "../src/lib/skills.js";
import { analyzeJob, userTerm } from "../src/lib/jd.js";
import { matchCV, detectSections } from "../src/lib/match.js";
import { SAMPLE_JOB, sampleBlocks } from "../src/lib/sample.js";
import { urlsOf, furniture } from "../src/lib/convert.js";
import { effects, FX } from "../src/lib/fx.js";

let n = 0, bad = 0;
const check = (ok, msg) => { n++; if (!ok) { bad++; console.log("FAIL " + msg); } };
const eq = (a, b, msg) => check(JSON.stringify(a) === JSON.stringify(b), `${msg}: got ${JSON.stringify(a)}`);
const skills = (s) => findSkills(s, tokenize(s)).map((h) => s.slice(h.s, h.e));

// text
eq(tokenize("C++/C# and Node.js.").map((t) => t.t), ["c++", "c#", "and", "node.js"], "tokenize tech words");
check(stem("managing") === stem("management"), "full stem folds managing/management");
check(stem("community", true) !== stem("communication", true), "light stem keeps community ≠ communication");
eq(sentences("Built APIs in Node.js and Go. Led a team; shipped v2").map((s) => s.text), ["Built APIs in Node.js and Go.", "Led a team;", "shipped v2"], "sentences keep Node.js");

// skills dictionary
eq(skills("Experience with CI/CD, k8s and C# on AWS"), ["CI/CD", "k8s", "C#", "AWS"], "skills: symbols and aliases");
eq(skills("R&D lead, C-level hires, Dr. R. Smith"), [], "skills: no single-letter false positives");
eq(skills("React Native and React"), ["React Native", "React"], "skills: longest first");

// job analysis
const job = analyzeJob(SAMPLE_JOB);
const cls = (frag) => job.lines.find((l) => l.text.includes(frag))?.cls;
eq([cls("Brightline Health builds"), cls("Competitive salary"), cls("equal opportunity"), cls("Expert knowledge"), cls("Mentor two")],
  ["about", "benefits", "eeo", "req", "resp"], "jd: section classes");
eq(job.title, "Senior Frontend Engineer", "jd: title");
const labels = job.terms.map((t) => t.label.toLowerCase());
for (const t of ["react", "typescript", "graphql", "jest"]) check(labels.includes(t), `jd: term ${t} found`);
for (const t of ["competitive salary", "equity", "two mid-level engineers", "engineer", "clinics"]) check(!labels.includes(t), `jd: no junk term "${t}"`);

// matching on the sample CV
const blocks = sampleBlocks();
const r = matchCV(blocks, job);
const at = (frag) => blocks.findIndex((b) => b.text.includes(frag));
const marked = (frag, cat) => r.marks.some((m) => m.block === at(frag) && m.cat === cat);
const text = (m) => blocks[m.block].text.slice(m.start, m.end);
check(r.marks.some((m) => m.cat === "keyword" && text(m) === "React" && m.block === at("Led the migration")), "match: React bolded in experience");
check(r.marks.some((m) => m.cat === "related" && text(m) === "AngularJS"), "match: AngularJS related to React");
check(!r.marks.some((m) => m.block === at("volunteer day")), "match: nothing on the unrelated bullet");
check(!r.marks.some((m) => m.block === at("@example.com")), "match: contact line untouched");
check(!marked("Languages:", "line") && !marked("B.S. Computer Science", "line"), "match: no line highlight on skills/education");
check(marked("Led the migration", "line"), "match: most relevant bullet highlighted");
check(r.missing.some((t) => t.label === "GraphQL") && !r.missing.some((t) => t.label.toLowerCase() === "frontend"), "match: missing list");
check(r.marks.every((m) => m.end > m.start && m.end <= blocks[m.block].text.length), "match: offsets inside blocks");
const spans = r.marks.filter((m) => m.cat !== "line").sort((a, b) => a.block - b.block || a.start - b.start);
check(spans.every((m, i) => !i || spans[i - 1].block !== m.block || spans[i - 1].end <= m.start), "match: term marks do not overlap");
const count = (d) => matchCV(blocks, job, { density: d }).marks.length;
check(count("light") < count("balanced") && count("balanced") <= count("strong"), "match: density orders mark counts");
const reactKey = job.terms.find((t) => t.label === "React").key;
check(!matchCV(blocks, job, { exclude: new Set([reactKey]) }).marks.some((m) => m.term === reactKey), "match: excluded term not marked");
const extra = userTerm("food bank");
check(extra?.kind === "phrase" && matchCV(blocks, job, { extra: [extra] }).marks.some((m) => m.term === extra.key), "match: user phrase marked");
// the language model's scores reach the marks: a line sharing no term is picked on meaning alone, above the bar only
const vol = at("volunteer day"), byMeaning = (v) => matchCV(blocks, job, { density: "strong", sem: blocks.map((_, i) => (i === vol ? v : 0)) })
  .marks.some((m) => m.block === vol && m.cat === "line");
check(byMeaning(1) && !byMeaning(0.5), "match: a line with no terms is picked on its meaning score alone, above the bar only");
const tabbed = effects([{ text: "Lead engineer\tMay 2023" }], [{ block: 0, start: 0, end: 22, cat: "line" }], { line: "highlight" }).get(0);
check(tabbed[13] === 0 && tabbed[0] === FX.highlight && tabbed[14] === FX.highlight, "fx: a marked line leaves its tab gap unshaded");
eq(userTerm("kubernetes")?.label, "Kubernetes", "userTerm: dictionary skill");
eq(userTerm("react")?.key, reactKey, "userTerm: a skill's name in another case is that skill (no second 'react' chip)");
const feOff = matchCV(blocks, job, { exclude: new Set([job.terms.find((t) => t.label === "frontend").key]) });
check(!feOff.marks.some((m) => text(m) === "AngularJS"), "match: a switched-off term's related words stay unmarked, not passed to another term");

// a non-tech posting: the engine must not depend on the tech dictionary
const nurseJob = analyzeJob(`Registered Nurse – Medical Surgical Unit
Responsibilities
• Deliver patient care for 5-6 patients per shift, including medication administration and wound care
• Document assessments in the electronic health record (Epic)
Requirements
• Active RN license and BLS certification
• 2+ years of acute care experience`);
const nurseCv = [
  { text: "Experience", kind: "heading" },
  { text: "Staff Nurse, St. Mary Hospital\t2020 – Present", kind: "para" },
  { text: "Provided patient care on a 30-bed surgical unit, handling medication administration for up to six patients", kind: "bullet" },
  { text: "Charted assessments and care plans in Epic EHR", kind: "bullet" },
  { text: "Certifications", kind: "heading" },
  { text: "BLS, ACLS", kind: "bullet" },
];
const nr = matchCV(nurseCv, nurseJob);
const nt = nr.marks.filter((m) => m.cat !== "line").map((m) => nurseCv[m.block].text.slice(m.start, m.end).toLowerCase());
for (const t of ["patient care", "medication administration", "epic", "bls"]) check(nt.some((x) => x.includes(t)), `nurse: "${t}" marked`);

// other domains (fuller cases in scripts/eval-domains.mjs): acronyms, "(Year 3)" titles, offers, skill modifiers, variants
const acc = analyzeJob(`Senior Accountant
What you will do
- Support the annual external audit and tax filings
What we need
- CPA or progress toward CPA
We offer flexible hours, a pension plan and a friendly team.`);
const accCls = (frag) => acc.lines.find((l) => l.text.includes(frag))?.cls;
eq([accCls("CPA or"), accCls("We offer")], ["req", "benefits"], "jd: 'What we need' is requirements, 'We offer' is benefits anywhere");
eq(acc.terms.map((t) => t.label).filter((l) => /annual external|progress toward|flexible|friendly/i.test(l)), [], "jd: no modifier or offer phrases");
const qts = analyzeJob("Primary School Teacher (Year 3)\nRequirements:\nQualified Teacher Status (QTS).\nSafeguarding training.");
eq(qts.terms.filter((t) => /QTS|Qualified|Year|\s{2}/.test(t.label)).map((t) => t.label), ["Qualified Teacher Status (QTS)"], "jd: one term per acronym, title without '(Year 3)'");
const qr = matchCV([{ text: "PGCE with QTS, University of Leeds", kind: "para" }], qts);
check(qr.found.some((t) => t.label.startsWith("Qualified")) && !qr.missing.some((t) => t.label.startsWith("Qualified")), "match: acronym alone finds the long-form term");
eq(skills("Ran A/B tests, reconciled key accounts"), ["A/B tests", "reconciled"], "skills: variants, and accounts ≠ accounting");
const r1 = matchCV(blocks, job), off = r1.found.find((t) => t.count > 0).key, r2 = matchCV(blocks, job, { exclude: new Set([off]) });
check(job.terms.filter((t) => t.core).length === r1.found.filter((t) => t.core).length + r1.missing.length, "match: job's core terms = found core + missing (one total everywhere)");
check(r2.found.length === r1.found.length && r2.missing.length === r1.missing.length && !r2.marks.some((m) => m.term === off), "match: a switched-off term stays found but unmarked");

// job-board shapes (fuller cases in scripts/eval-domains2.mjs): LinkedIn's "About the job", Indeed's fields, title qualifiers, names
const jb = analyzeJob(`Customer Service Representative - Night Shift
About the job
Lumen Retail is a fast-growing e-commerce brand.
Responsibilities
• Run email campaigns in Klaviyo and report on AHT in Looker Studio
Nice to have:
- Experience with BIM
Job Types: Full-time, Permanent
Pay: Php18,000.00 - Php24,000.00 per month
Language:
English (Required)`);
const jbCls = (frag) => jb.lines.find((l) => l.text.includes(frag))?.cls;
eq([jbCls("Lumen"), jbCls("BIM"), jbCls("Job Types"), jbCls("Pay:"), jbCls("English")], ["about", "nice", "benefits", "benefits", "req"], "jd: company blurb, short bullet, job-board fields, (Required)");
const jbT = (l) => jb.terms.find((t) => t.label === l);
eq(jb.terms.map((t) => t.label).filter((l) => /night|php|types|studio|brand/i.test(l)), [], "jd: no title qualifier, field or half-name terms");
check(jbT("AHT")?.core && jbT("Klaviyo") && !jbT("Klaviyo").core && jbT("BIM") && !jbT("BIM").core, "jd: single acronyms and names kept; names and nice-to-haves not core");

// CV headings, Philippine ones too (the section decides what may be marked); fuller list in the round-14 notes
const hs = ["Teaching Experience", "On-the-Job Training", "Educational Attainment", "Seminars Attended", "Character References", "Personal Data", "Languages", "Customer Experience"];
eq(hs.map((h) => detectSections([{ text: "Skills", kind: "heading" }, { text: h, kind: "para" }, { text: "x", kind: "para" }])[2].section),
  ["experience", "experience", "education", "certs", "none", "none", "skip", "skills"], "sections: CV headings ('Customer Experience' is not one)");
check(detectSections([{ text: "Skills", kind: "heading" }, { text: "Leadership", kind: "bullet" }])[1].section === "skills", "sections: a one-word list item is not a heading");
const refs = matchCV([{ text: "Character References", kind: "heading" }, { text: "Project Manager, ABC Builders Inc.", kind: "para" }],
  analyzeJob("Project Manager\nRequirements\n• 5 years as a project manager"));
check(refs.marks.length === 0, "match: nothing marked in references (a referee's title is not the candidate's)");

// names mid-sentence keep their filler words but not their rank; "LET passer" and "LPT" are one licence
const nm = analyzeJob("Site Engineer\nRequirements\n• Must be a Professional Engineer with 3 years on site\n• Work closely with the Senior Accountant on budgets, payroll and monthly reports\n• LET passer");
const nmL = nm.terms.map((t) => t.label);
check(nmL.includes("Professional Engineer") && nmL.includes("Accountant") && !nmL.some((l) => /^Senior/.test(l)), `jd: names keep filler words, not rank: ${nmL.join(", ")}`);
check(matchCV([{ text: "Licensed Professional Teacher (LPT), 2019", kind: "para" }], nm).found.some((t) => t.label === "Licensed Professional Teacher"), "match: 'LET passer' found as LPT");

// job conditions, places and fillers are not terms; compounds with a verb-like head and names with stop words stay whole
// (fuller cases in scripts/eval-domains3.mjs)
const cd = analyzeJob("Staff Nurse\nRequirements:\n- Willing to work on shifting schedules\n- Knowledge of structural design and the National Building Code\n- CRM (Follow Up Boss) and first-level technical support\n- A valid PRC license\nOur busy hospital in Quezon City is hiring");
eq(cd.terms.map((t) => t.label).filter((l) => l !== "nursing"), ["CRM", "structural design", "National Building Code", "Follow Up Boss", "first-level technical support", "PRC license"], "jd: conditions, places, fillers dropped; compounds and names whole");
const ad = "Planned the content calendar; managed the CEO inbox and calendar; bookkeeping";
eq(findSkills(ad, tokenize(ad)).map((h) => h.key), ["content marketing", "email management", "calendar management", "bookkeeping"], "skills: admin words, and the longer alias wins");
// an ad pasted as one paragraph: a header inside it still classes what follows it
const one = analyzeJob("Senior Welder. Requirements: 5 years MIG and TIG welding, reading blueprints. Benefits: free meals and a uniform allowance.");
eq([one.title, one.terms.filter((t) => t.core).map((t) => t.label)], ["Senior Welder", ["TIG welding", "reading blueprints", "MIG"]], "jd: headers inside a one-paragraph ad");
const rn = analyzeJob("Registered Nurse\nRequirements:\n- Bachelor of Science in Nursing\n- BLS certification");
eq(rn.terms.map((t) => t.label), ["registered nurse", "BLS", "Bachelor's degree", "nursing"], "jd: a title that is a skill is one term; a degree's full name leaves no stray word");
// a rebuilt file links typed addresses as PDF viewers do, never a tool name with a dot or a script address from the file
const typed = urlsOf({ text: "Node.js, ASP.NET, Vue.js · jane@x.com · linkedin.com/in/jane. Ph.D.", links: [[0, 7, "javascript:alert(1)"]] });
eq([...new Set(typed.filter(Boolean))], ["mailto:jane@x.com", "https://linkedin.com/in/jane"], "convert: typed addresses are links, tool names and unsafe links are not");
// a rebuild drops a PDF's page numbers and keeps a running header once (first) and a footer once (last); lines seen once stay,
// even near the edge, and a year is not taken for a page number
const fdoc = { kind: "pdf", pages: [0, 1, 2].map(() => ({ view: [0, 0, 612, 792], glyphs: [] })), blocks: [] };
for (const [page, y, size, text] of [[0, 770, 8, "Jane Doe — CV"], [0, 700, 12, "Experience"], [0, 30, 8, "Page 1 of 3"], [1, 770, 8, "Jane Doe — CV"],
  [1, 760, 10, "2019 Winner\tManila"], [1, 30, 8, "Page 2 of 3"], [1, 20, 8, "jane@x.com · Manila"], [2, 770, 8, "Jane Doe — CV"],
  [2, 760, 10, "2020 Winner\tManila"], [2, 30, 8, "- 3 -"], [2, 20, 8, "jane@x.com · Manila"]]) {
  fdoc.blocks.push({ text, page, size, gmap: Int32Array.of(fdoc.pages[page].glyphs.push({ y0: y }) - 1) });
}
eq([...furniture(fdoc)].sort((a, b) => a - b), [2, 3, 5, 6, 7, 9], "convert: page numbers and repeated running headers and footers are left out of a rebuild");

// speed: warm analyse + match well under a frame budget on the sample
const t0 = performance.now();
for (let i = 0; i < 10; i++) matchCV(blocks, analyzeJob(SAMPLE_JOB));
const ms = (performance.now() - t0) / 10;
check(ms < 50, `speed: analyse+match ${ms.toFixed(1)} ms`);

console.log(`${n} checks, ${bad} FAIL`);
process.exit(bad ? 1 : 0);
