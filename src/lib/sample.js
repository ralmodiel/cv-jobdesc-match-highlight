// Fictional sample data for "Try a sample" and for the checks. Any resemblance to real people or companies is accidental.
export const SAMPLE_JOB = `Senior Frontend Engineer

About us
Brightline Health builds scheduling software used by 2,000 clinics. We are a remote-first team of 80.

What you'll do
• Build and ship accessible, responsive web interfaces in React and TypeScript
• Own our design system together with the product design team
• Improve performance and Core Web Vitals across the patient booking flow
• Write unit and end-to-end tests (Jest, Playwright) and review code
• Mentor two mid-level engineers and collaborate with backend engineers on REST and GraphQL APIs

Requirements
• 5+ years of professional frontend development experience
• Expert knowledge of JavaScript, TypeScript, HTML and CSS
• Experience with React, Redux or a similar state management library
• Familiarity with CI/CD pipelines and cloud platforms (AWS preferred)
• Strong communication skills and experience working in an Agile/Scrum team

Nice to have
• Experience with healthcare products or HIPAA compliance
• Next.js, Node.js

What we offer
Competitive salary, equity, 25 days paid time off, home office stipend.

Brightline Health is an equal opportunity employer. We welcome applicants regardless of background.
To apply, send your CV to the hiring team.`;

export const SAMPLE_CV = {
  name: "Jordan Rivera",
  contact: "jordan.rivera@example.com · +1 555 0100 · Portland, OR · github.com/jrivera-dev",
  summary: "Frontend engineer with 7 years of experience building fast, accessible web applications for healthcare and fintech teams. Comfortable owning features end to end, from design review to production monitoring.",
  experience: [
    {
      role: "Frontend Engineer", org: "Cascadia Clinics Software", where: "Remote", when: "2021 – Present",
      bullets: [
        "Led the migration of the appointment booking app from AngularJS to React and TypeScript, cutting bundle size by 38%",
        "Built a shared component library and design system used by 4 product teams, with WCAG 2.1 AA accessibility",
        "Improved Largest Contentful Paint from 3.9s to 1.7s by code splitting and image optimization",
        "Introduced Playwright end-to-end tests and Jest unit tests in the GitHub Actions pipeline, raising coverage to 82%",
        "Mentored three junior developers through weekly pairing and code reviews",
      ],
    },
    {
      role: "Web Developer", org: "Northwind Payments", where: "Seattle, WA", when: "2018 – 2021",
      bullets: [
        "Developed customer dashboards in Vue.js and Node.js backed by REST APIs and PostgreSQL",
        "Worked in a Scrum team of eight; ran sprint demos for stakeholders",
        "Deployed services on Azure and set up monitoring with Grafana",
        "Organized the company's volunteer day with the local food bank",
      ],
    },
  ],
  skills: [
    "Languages: JavaScript, TypeScript, HTML, CSS, Python",
    "Frameworks: React, Redux, Vue.js, Node.js, Express",
    "Tools: Git, Docker, Figma, Jira, Webpack",
  ],
  education: [{ degree: "B.S. Computer Science", org: "Oregon State University", when: "2014 – 2018" }],
};

/** The sample CV as plain blocks (what the readers produce), for checks that do not need a real file. */
export function sampleBlocks(cv = SAMPLE_CV) {
  const b = [];
  const add = (text, kind = "para") => b.push({ text, kind });
  add(cv.name, "heading");
  add(cv.contact);
  add("Summary", "heading");
  add(cv.summary);
  add("Experience", "heading");
  for (const x of cv.experience) {
    add(`${x.role} — ${x.org}\t${x.when}`);
    for (const t of x.bullets) add(t, "bullet");
  }
  add("Skills", "heading");
  for (const s of cv.skills) add(s, "bullet");
  add("Education", "heading");
  for (const e of cv.education) add(`${e.degree}, ${e.org}\t${e.when}`);
  return b;
}
