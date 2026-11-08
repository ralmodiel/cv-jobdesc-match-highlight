// Job ads outside tech (accountant, teacher, analyst) against matching CVs, read by eye: no pass/fail.
// Usage: node scripts/eval-domains.mjs → per case: title, terms, requirements, marks, missing
import { analyzeJob } from "../src/lib/jd.js";
import { matchCV } from "../src/lib/match.js";
const H = (text) => ({ text, kind: "heading" }), B = (text) => ({ text, kind: "bullet" }), P = (text) => ({ text, kind: "para" });
const cases = {
  accountant: [`Senior Accountant
About the role
We are looking for a detail-oriented Senior Accountant to join our finance team.
What you will do
- Prepare monthly financial statements and lead the month-end close
- Perform account reconciliations and variance analysis
- Support the annual external audit and tax filings
What we need
- CPA or progress toward CPA
- 4+ years in public accounting or corporate accounting
- Advanced Excel (pivot tables, VLOOKUP) and experience with NetSuite or SAP
- Strong knowledge of GAAP
We offer flexible hours, a pension plan and a friendly team.`,
  [P("Maria Santos"), P("maria@example.com · Manila"), H("Experience"), P("Staff Accountant, Ayala Corp\t2019 – Present"),
   B("Prepared monthly financial statements and closed the books within five working days"),
   B("Reconciled 40 bank and intercompany accounts each month in SAP"),
   B("Built Excel models with pivot tables to explain budget variances to managers"),
   B("Organised the office holiday party for 120 people"),
   H("Education"), P("BS Accountancy, University of Santo Tomas\t2015 – 2019"), H("Skills"), P("SAP, Excel, IFRS, Power BI")]],
  teacher: [`Primary School Teacher (Year 3)
Responsibilities:
Plan and deliver engaging lessons in line with the national curriculum.
Differentiate instruction for pupils with special educational needs.
Assess pupil progress and communicate with parents.
Requirements:
Qualified Teacher Status (QTS).
Experience with classroom management and behaviour policies.
Safeguarding training.`,
  [P("Tom Reyes"), H("Teaching experience"), P("Class Teacher, Greenfield Primary\t2018 – 2024"),
   B("Planned and taught lessons for a Year 4 class of 28 pupils following the national curriculum"),
   B("Adapted materials for pupils with SEN and worked with the SENCO on individual plans"),
   B("Ran parent evenings and wrote termly progress reports"),
   B("Coached the school football team"), H("Qualifications"), P("PGCE with QTS, University of Leeds")]],
  analyst: [`Data Analyst
You will turn data into insight for our marketing team.
Requirements
• Strong SQL and Python (pandas)
• Experience building dashboards in Tableau or Looker
• A/B testing and statistics
• Communicate findings to non-technical stakeholders`,
  [P("Ana Cruz"), H("Experience"), P("Marketing Analyst, ShopCo\t2021 – Present"),
   B("Wrote SQL queries in BigQuery to report weekly campaign performance"),
   B("Automated reporting in Python with pandas, saving 6 hours a week"),
   B("Built Power BI dashboards used by the marketing leadership"),
   B("Designed and analysed A/B tests on email subject lines"), H("Skills"), P("SQL, Python, Power BI, Excel, R")]],
};
for (const [name, [job, cv]] of Object.entries(cases)) {
  const a = analyzeJob(job);
  const r = matchCV(cv, a, { density: "balanced" });
  const marks = r.marks.map((m) => `${m.cat[0]}:${m.cat === "line" ? "#" + m.block : cv[m.block].text.slice(m.start, m.end)}${m.via ? "~" + m.via : ""}`);
  console.log(`== ${name} (${a.title}) terms: ${a.terms.slice(0, 20).map((t) => `${t.label}[${t.cls}${t.w.toFixed(2)}]`).join(", ")}`);
  console.log(`   reqs ${a.requirements.length}: ${a.requirements.map((s) => s.slice(0, 40)).join(" | ")}`);
  console.log(`   marks: ${marks.join(", ")}`);
  console.log(`   missing: ${r.missing.map((t) => t.label + (t.related ? "≈" : "")).join(", ")}`);
}
