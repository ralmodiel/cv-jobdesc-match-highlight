// More job-ad shapes: LinkedIn-style marketing, Indeed-style customer service (PH), prose project manager.
// Usage: node scripts/eval-domains2.mjs → per case: title, top terms [class weight core], marks, missing
import { analyzeJob } from "../src/lib/jd.js";
import { matchCV } from "../src/lib/match.js";
const H = (text) => ({ text, kind: "heading" }), B = (text) => ({ text, kind: "bullet" }), P = (text) => ({ text, kind: "para" });
const cases = {
  marketing: [`Digital Marketing Manager
About the job
Lumen Retail is a fast-growing e-commerce brand selling home goods across Southeast Asia.
Responsibilities
• Own the paid media budget across Google Ads, Meta and TikTok, and report on ROAS and CAC
• Plan and run email marketing campaigns in Klaviyo, including segmentation and A/B testing
• Work with the content team on SEO, landing pages and social media calendars
• Build weekly performance dashboards in Google Analytics 4 and Looker Studio
Qualifications
• 5+ years in digital marketing, ideally in e-commerce or retail
• Hands-on experience with Google Ads and Meta Ads Manager
• Strong analytical skills and comfort with Excel or Google Sheets
• Excellent written communication in English
Preferred
• Experience with Shopify and marketing automation
Benefits
• HMO from day one, hybrid work, learning budget
Lumen Retail is an equal opportunity employer.`,
  [P("Ana Cruz"), P("ana.cruz@example.com · Quezon City"), H("Experience"), P("Marketing Specialist, ShopNow PH\t2020 – Present"),
   B("Managed a ₱2M monthly budget for Google Ads and Facebook Ads, improving ROAS from 2.1 to 3.4"),
   B("Ran weekly email campaigns in Mailchimp with A/B tests on subject lines, lifting open rates by 18%"),
   B("Wrote SEO briefs for 60 product pages and grew organic traffic by 45%"),
   B("Built a Looker Studio dashboard for the sales team"),
   H("Skills"), P("Google Analytics, Excel, Canva, Shopify, copywriting")]],
  support: [`Customer Service Representative - Night Shift
Job description
We are hiring Customer Service Representatives for a US healthcare account.
Responsibilities:
- Handle inbound calls and chats from patients about billing and appointments
- Resolve issues on the first contact and document every interaction in the CRM
- Meet targets for CSAT, AHT and quality scores
Qualifications:
- At least 1 year of BPO or call center experience
- Excellent English communication skills
- Willing to work night shift in Makati
Job Types: Full-time, Permanent
Pay: Php18,000.00 - Php24,000.00 per month
Benefits:
Health insurance
Paid training
Schedule:
Night shift
Supplemental pay types:
Night differential
Ability to commute/relocate:
Makati City: Reliably commute or planning to relocate before starting work (Required)
Education:
Bachelor's (Preferred)
Experience:
customer service: 1 year (Required)
Language:
English (Required)
Work Location: In person`,
  [P("Mark Reyes"), P("mark.reyes@example.com · Pasig"), H("Work Experience"), P("Customer Support Associate, Telus International\t2022 – 2024"),
   B("Answered 60+ inbound calls a day for a US telecom client, keeping AHT under 6 minutes"),
   B("Logged every case in Salesforce and kept a 92% CSAT score"),
   B("Trained four new hires on the billing process"),
   H("Education"), P("BS Psychology, Rizal Technological University\t2018 – 2022")]],
  pm: [`Project Manager, Construction
We build mid-rise residential buildings in Cebu and Davao and are looking for a project manager to lead two sites from groundbreaking to handover. You will plan schedules in Primavera P6 or MS Project, manage subcontractors and keep costs within budget, and report progress to the owners every week.
Must have:
- Licensed civil engineer
- 7 years of construction project management
- Knowledge of safety standards (DOLE OSH) and building codes
Nice to have:
- PMP certification
- Experience with BIM`,
  [P("Liza Mendoza"), P("liza@example.com · Cebu City"), H("Experience"), P("Site Engineer, Megawide\t2016 – Present"),
   B("Managed subcontractors for a 12-storey condominium, finishing two weeks ahead of schedule"),
   B("Kept the project 3% under budget with weekly cost reports to the owner"),
   B("Planned the master schedule in MS Project and tracked progress daily"),
   B("Led toolbox talks on safety; zero lost-time incidents in 400,000 hours"),
   H("Licenses"), P("Licensed Civil Engineer (PRC), 2015")]],
};
for (const [name, [job, cv]] of Object.entries(cases)) {
  const a = analyzeJob(job), r = matchCV(cv, a);
  const marks = r.marks.filter((m) => m.cat !== "line").map((m) => `${cv[m.block].text.slice(m.start, m.end)}${m.cat === "related" ? "~" : ""}`);
  console.log(`== ${name} (${a.title}) ${a.terms.length} terms: ${a.terms.slice(0, 26).map((t) => `${t.label}[${t.cls}${t.w.toFixed(2)}${t.core ? "*" : ""}]`).join(", ")}`);
  console.log(`   classes: ${a.lines.map((l) => l.cls[0]).join("")}`);
  console.log(`   marks: ${marks.join(", ")}`);
  console.log(`   lines: ${r.marks.filter((m) => m.cat === "line").map((m) => cv[m.block].text.slice(0, 30)).join(" | ")}`);
  console.log(`   missing: ${r.missing.map((t) => t.label + (t.related ? "≈" : "")).join(", ")}`);
}
