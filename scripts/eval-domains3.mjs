// Six more job types (nurse, virtual assistant, civil engineer, field sales, graphic designer, IT support), scored:
// what the CV must have marked, what must show as missing, which terms must exist whole, and what must not become a term.
// Not checked: "nursing care plans" ("plans" reads as a verb, and "nursing" is marked twice elsewhere first);
// "key accounts" (customers in sales, ledgers in finance: left to the language model's line ranking).
// Usage: node scripts/eval-domains3.mjs [-v: print each case's terms, marks and missing] → "N checks, M BUG" (exit 1 on a BUG)
import { analyzeJob } from "../src/lib/jd.js";
import { matchCV } from "../src/lib/match.js";
const H = (text) => ({ text, kind: "heading" }), B = (text) => ({ text, kind: "bullet" }), P = (text) => ({ text, kind: "para" });

const cases = {
  nurse: {
    job: `Staff Nurse - Medical-Surgical Ward
Our tertiary hospital in Quezon City is hiring Staff Nurses.
Qualifications:
- Graduate of BS Nursing
- Licensed Nurse with a valid PRC license
- With BLS and ACLS certification
- At least 1 year of hospital experience, preferably in Medical-Surgical or ER
- IV Therapy trained
Responsibilities:
- Assess patients and develop nursing care plans
- Administer medications and IV fluids
- Monitor vital signs and document patient care in the EMR
- Coordinate with physicians and the healthcare team
Benefits:
- HMO coverage from day 1
- Free meals and shuttle service`,
    cv: [H("Professional Experience"), P("Staff Nurse, Medical-Surgical Ward, Metro General Hospital, 2021–present"),
      B("Assessed 8 to 10 patients per shift and wrote nursing care plans"), B("Administered medications and IV fluids; IV Therapy trained"),
      B("Monitored vital signs and charted in the EMR"), H("Licenses and Certifications"), B("Registered Nurse, PRC License No. 0123456"),
      B("Basic Life Support (BLS), 2024"), H("Education"), P("Bachelor of Science in Nursing, 2020")],
    marked: ["PRC License", "IV fluids", "vital signs", "EMR", "Basic Life Support", "Medical-Surgical", "Bachelor of Science in Nursing", "IV Therapy"],
    missing: ["ACLS"],
    notTerms: ["Quezon City", "HMO", "meals", "shuttle"],
  },
  va: {
    job: `Virtual Assistant (Remote, US Client)
We are looking for a detail-oriented Virtual Assistant to support a busy real estate team.
What you'll do:
- Manage the email inbox and calendar scheduling
- Update listings and contacts in the CRM (Follow Up Boss)
- Prepare documents in Google Workspace and Microsoft Office
- Handle data entry and basic bookkeeping in QuickBooks
Requirements:
- 2+ years of experience as a Virtual Assistant or Executive Assistant
- Excellent written and spoken English
- Experience with Canva and social media scheduling is a plus
- Must be available to work US Eastern hours
Pay: $5–7/hour`,
    cv: [H("Work Experience"), P("Executive Assistant (Remote), Brightpath Realty, 2022–2025"),
      B("Managed the CEO's inbox and calendar, scheduling 30+ meetings a week"), B("Kept 2,000 contacts current in Follow Up Boss CRM"),
      B("Created listing graphics in Canva"), H("Skills"), P("Google Workspace, Microsoft Excel, data entry, QuickBooks Online")],
    marked: ["Executive Assistant", "inbox", "calendar", "Follow Up Boss", "Canva", "Google Workspace", "data entry", "QuickBooks"],
    missing: ["social media"],
    terms: ["Follow Up Boss", "calendar management", "email management"],
    notTerms: ["$5", "hour", "US Client", "busy", "eastern"],
  },
  civil: {
    job: `Site Engineer (Civil)
Requirements:
- Licensed Civil Engineer
- At least 3 years of experience in building construction
- Proficient in AutoCAD and MS Project
- Knowledge of structural design and quantity surveying
- Familiar with DPWH standards and the National Building Code
Duties:
- Supervise construction activities on site
- Prepare bill of quantities (BOQ) and progress reports
- Coordinate with subcontractors and inspect materials`,
    cv: [H("Experience"), P("Site Engineer, ABC Builders Inc., 2020–2025"), B("Supervised the construction of a 5-storey commercial building"),
      B("Prepared bills of quantities and weekly progress reports"), B("Drew as-built plans in AutoCAD"), H("License"), B("Civil Engineer, PRC licensed, 2019")],
    marked: ["AutoCAD", "bills of quantities", "progress reports", "Civil Engineer", "Site Engineer"],
    missing: ["Microsoft Project", "structural design", "DPWH", "National Building Code"],
    notTerms: ["3 years"],
  },
  sales: {
    job: `Sales Representative - FMCG
Responsibilities:
- Achieve monthly sales targets in the assigned territory
- Build relationships with key accounts and store owners
- Conduct product presentations and negotiate orders
- Monitor competitor activity and report market trends
Qualifications:
- Bachelor's degree in Marketing, Business Administration or related field
- At least 1 year of field sales experience, preferably in FMCG
- With own motorcycle and a valid driver's license
- Proficient in MS Excel`,
    cv: [H("Experience"), P("Field Sales Representative, Golden Foods Distribution, 2021–present"),
      B("Exceeded monthly sales targets by 15% across 120 outlets"), B("Managed key accounts including three supermarket chains"),
      B("Negotiated orders and ran product demos for store owners"), H("Education"), P("BS Business Administration, Major in Marketing Management")],
    marked: ["sales targets", "Business Administration", "Field Sales", "Negotiated orders"],
    missing: ["FMCG", "MS Excel"],
    notTerms: ["1 year"],
  },
  designer: {
    job: `Graphic Designer
You will create visuals for social media, print and web.
Must have:
- A strong portfolio
- 2+ years with Adobe Photoshop, Illustrator and InDesign
- Basic video editing (Premiere Pro or After Effects)
- Understanding of typography, color theory and brand guidelines
Nice to have: Figma, motion graphics`,
    cv: [H("Experience"), P("Junior Graphic Designer, Pixel Studio, 2022–present"), B("Designed social media posts and print materials for 12 brands"),
      B("Edited short videos in Premiere Pro"), B("Built a brand style guide in Illustrator"), H("Tools"), P("Photoshop, Illustrator, Figma, Canva")],
    marked: ["Graphic Designer", "social media", "Premiere Pro", "Illustrator", "Photoshop", "Figma"],
    missing: ["InDesign", "After Effects", "typography", "color theory"],
    notTerms: ["2+ years"],
  },
  itsupport: {
    job: `IT Support Specialist
Responsibilities:
- Provide first-level technical support to 200 users by phone, email and a ticketing system (Jira Service Management)
- Troubleshoot Windows 10/11, Microsoft 365 and printer issues
- Set up laptops and manage user accounts in Active Directory
- Maintain the LAN, Wi-Fi and network devices
Qualifications:
- Graduate of BS Information Technology or Computer Science
- CompTIA A+ or CCNA certification is an advantage
- Willing to work on shifting schedules`,
    cv: [H("Experience"), P("IT Support Technician, Metro Logistics Corp., 2021–2025"), B("Resolved 40 tickets a day in Jira Service Management"),
      B("Imaged and deployed 150 Windows 11 laptops"), B("Managed user accounts and group policies in Active Directory"),
      B("Troubleshot network printers and Wi-Fi access points"), H("Education"), P("Bachelor of Science in Information Technology"),
      H("Certifications"), B("CCNA (Cisco Certified Network Associate), 2023")],
    marked: ["Jira Service Management", "Windows 11", "Active Directory", "user accounts", "Wi-Fi", "Information Technology", "CCNA"],
    missing: ["Microsoft Office", "CompTIA A+"],
    terms: ["technical support"],
    notTerms: ["200 users", "shifting"],
  },
};

const low = (s) => s.toLowerCase();
let checks = 0, bugs = 0;
const bug = (name, what) => { bugs++; console.log(`BUG ${name}: ${what}`); };
for (const [name, c] of Object.entries(cases)) {
  const a = analyzeJob(c.job), r = matchCV(c.cv, a);
  const spans = r.marks.filter((m) => m.cat !== "line");
  for (const want of c.marked) {
    checks++;
    const bi = c.cv.findIndex((b) => low(b.text).includes(low(want)));
    if (bi < 0) { bug(name, `fixture: "${want}" is not in the CV`); continue; }
    const s = low(c.cv[bi].text).indexOf(low(want)), e = s + want.length;
    if (!spans.some((m) => m.block === bi && m.start < e && m.end > s)) bug(name, `"${want}" is not marked`);
  }
  const miss = r.missing.map((t) => low(t.label));
  for (const want of c.missing) {
    checks++;
    if (!miss.some((l) => l.includes(low(want)) || low(want).includes(l))) bug(name, `"${want}" is not listed as missing`);
  }
  const labels = a.terms.map((t) => low(t.label));
  for (const want of c.terms || []) {
    checks++;
    if (!labels.some((l) => l.includes(low(want)))) bug(name, `"${want}" is not a term`);
  }
  for (const no of c.notTerms) {
    checks++;
    const hit = labels.find((l) => l.includes(low(no)));
    if (hit) bug(name, `"${hit}" is a term`);
  }
  if (process.argv.includes("-v")) {
    console.log(`== ${name} (${a.title}) terms: ${a.terms.map((t) => `${t.label}[${t.cls}${t.core ? "*" : ""}]`).join(", ")}`);
    console.log(`   marks: ${spans.map((m) => c.cv[m.block].text.slice(m.start, m.end) + (m.cat === "related" ? "~" : "")).join(", ")}`);
    console.log(`   missing: ${r.missing.map((t) => t.label + (t.related ? "≈" : "")).join(", ")}`);
  }
}
console.log(`${checks} checks, ${bugs} BUG`);
process.exit(bugs ? 1 : 0);
