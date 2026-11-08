// Curated skills dictionary. Each line is one group: `key[|flags]: Name=alias,alias; Name2; ...`.
// Members of one group count as related to each other (JD asks for AWS, CV has Azure → underline), unless the group
// is flagged `norel`. A trailing `!` on a name or alias makes that variant case-sensitive (Go, R, REST, Excel).
// Flags: norel (no sibling relation), w<number> (weight, default 1).
import { escapeRe, stem, tokenize } from "./text.js";

const RAW = `
lang-web: JavaScript=JS!,ECMAScript,ES6; TypeScript; HTML=HTML5; CSS=CSS3; Sass=SCSS; WebAssembly=wasm
lang-script: Python; Ruby!; PHP; Perl; Bash=shell scripting,shell script; PowerShell; Lua
lang-jvm: Java; Kotlin; Scala; Groovy
lang-sys: C!; C++=cpp; Rust!; Go!=golang; Zig!; Assembly=assembler
lang-dotnet: C#=c sharp,csharp; .NET=dotnet,.NET Core; ASP.NET; F#; VB.NET; Blazor
lang-data: SQL; R!; MATLAB; Stata; SPSS; Julia!; VBA
lang-mobile: Swift!; Objective-C; Dart!; Kotlin
frontend: frontend=front-end,front end,frontend development; React!=React.js,ReactJS; Angular!=AngularJS; Vue=Vue.js,VueJS; Svelte=SvelteKit; Next.js=NextJS; Nuxt=Nuxt.js; Ember!=Ember.js; Redux; jQuery; single-page applications=single page application; Tailwind=Tailwind CSS,TailwindCSS; Bootstrap!; Material UI=MUI; Webpack; Vite; responsive design
backend-js: Node.js=Node!,NodeJS; Express!=Express.js; NestJS; Deno; Fastify; Koa
backend-py: Django; Flask; FastAPI; Celery; SQLAlchemy
backend-java: Spring Boot; Spring Framework=Spring MVC; Hibernate; Jakarta EE=Java EE,J2EE; Maven; Gradle
backend-other: Ruby on Rails=Rails!; Laravel; Symfony
api: REST!=RESTful,REST API,REST APIs,RESTful APIs; GraphQL; gRPC; microservices=microservice,micro-services,microservice architecture; API design=API development,APIs; OpenAPI=Swagger; webhooks; event-driven architecture=event driven
cloud: cloud=cloud computing,cloud platforms,cloud platform,cloud infrastructure,cloud services,public cloud,cloud-native,cloud native; AWS=Amazon Web Services; Azure=Microsoft Azure; Google Cloud=Google Cloud Platform; serverless; Heroku; DigitalOcean; Cloudflare; Vercel; Netlify
aws: AWS; EC2; S3!; Lambda=AWS Lambda; EKS; RDS; CloudFormation; CloudWatch; SQS; IAM; Route 53; API Gateway; Step Functions; Aurora
containers: containers=containerization,containerisation,containerized; Docker; Kubernetes=K8s; Helm!; OpenShift; Podman; Rancher; container orchestration=orchestration
iac: infrastructure as code=IaC; Terraform; CloudFormation; Pulumi; Ansible; Chef!; Puppet!; configuration management
cicd: CI/CD=CI-CD,CICD,continuous integration,continuous delivery,continuous deployment,build pipelines,deployment pipelines; Jenkins!; GitHub Actions; GitLab CI=GitLab CI/CD; CircleCI; Travis CI; Azure DevOps; Bamboo!; Argo CD=ArgoCD; DevOps; release management
vcs: version control=source control; Git; GitHub; GitLab; Bitbucket; SVN=Subversion; Mercurial
observability: monitoring=observability; Prometheus; Grafana; Datadog; New Relic; ELK=ELK stack; OpenTelemetry; Sentry; PagerDuty; site reliability engineering=SRE
db-sql: relational databases=relational database,RDBMS; SQL; PostgreSQL=Postgres; MySQL; SQL Server=MSSQL,MS SQL Server,Microsoft SQL Server; Oracle Database=Oracle!,Oracle DB; SQLite; MariaDB; PL/SQL; T-SQL; database design=database administration,DBA
db-nosql: NoSQL; MongoDB=Mongo!; Cassandra!; DynamoDB; Redis; Couchbase; Elasticsearch=Elastic Search,OpenSearch; Neo4j; Firebase; Firestore
data-eng: data engineering; data pipelines=data pipeline; ETL; ELT; data warehousing=data warehouse,data warehouses; big data; data modeling=data modelling; Apache Spark=Spark!,PySpark; Hadoop; Kafka=Apache Kafka; Airflow=Apache Airflow; dbt; Snowflake!; Databricks; BigQuery; Redshift; Hive!; Flink; data lake=data lakes; data governance; data quality
ml: machine learning=ML!; deep learning; artificial intelligence=AI!; natural language processing; computer vision; large language models=LLM,LLMs,large language model; generative AI=GenAI,gen AI; TensorFlow; PyTorch; scikit-learn=sklearn,scikit learn; Keras; XGBoost; Hugging Face=HuggingFace,transformers; MLOps; LangChain; retrieval-augmented generation; prompt engineering; OpenCV; neural networks=neural network
data-sci: data science; data analysis=data analytics,analyzing data,analysing data; statistics=statistical analysis,statistical modeling; pandas; NumPy; Jupyter=Jupyter Notebook; predictive modeling=predictive modelling,predictive analytics; A/B testing=AB testing,A/B tests,A/B test,split testing,experimentation; regression analysis=regression; time series
bi: business intelligence=BI!; data visualization=data visualisation,dashboards,dashboard,reporting dashboards; Tableau; Power BI=PowerBI; Looker; Qlik=QlikView,Qlik Sense; Google Analytics=GA4; Mixpanel; Amplitude; Excel!=Microsoft Excel,MS Excel; Google Sheets; reporting
testing: QA!=quality assurance; test automation=automated testing,automation testing; unit testing=unit tests; integration testing=integration tests; end-to-end testing=E2E,e2e testing; TDD=test-driven development,test driven development; BDD; Jest!; Mocha!; Cypress; Playwright; Selenium; JUnit; pytest; TestNG; RSpec; manual testing; regression testing; performance testing=load testing
mobile: mobile development=mobile app development,mobile apps,mobile applications; iOS; Android; React Native; Flutter; Xamarin; SwiftUI; Jetpack Compose
os: Linux; Unix; Windows Server; macOS=Mac OS,OS X; Red Hat=RHEL; Ubuntu; system administration=sysadmin
network: computer networking=network administration; TCP/IP; DNS; DHCP; VPN; LAN; WAN; Cisco; CCNA; load balancing=load balancers; CDN
security: cybersecurity=cyber security,information security,InfoSec,IT security; SIEM; Splunk; penetration testing=pen testing,pentesting; vulnerability management=vulnerability assessment,vulnerability scanning; identity and access management=IAM; SOC 2=SOC2; ISO 27001; NIST; OWASP; firewalls=firewall; CISSP; CISM; CEH; Security+=CompTIA Security+; incident response; threat modeling=threat modelling; zero trust; encryption; application security=AppSec; security operations center
agile: Agile=agile methodologies,agile methodology; Scrum; Kanban; sprint planning=sprints; SAFe!; Scrum Master; Lean!; Jira; Confluence; Trello; Asana; Monday.com
pm: project management=managing projects; program management; product management; portfolio management; PMP; PRINCE2; stakeholder management=stakeholder engagement,stakeholder communication,managing stakeholders; roadmaps=roadmap,product roadmap; budget management=budgeting,budgets; risk management; Microsoft Project=MS Project; change management; resource planning=resource allocation; OKRs=OKR; KPIs=KPI; requirements gathering=requirements analysis; business analysis=business analyst; process improvement=continuous improvement; vendor management
design: UX!=user experience,UX design; UI!=user interface,UI design; user research=UX research; usability testing; wireframing=wireframes; prototyping=prototypes; design systems=design system; interaction design; visual design; information architecture; accessibility=WCAG,a11y; Figma; Sketch!; Adobe XD; InVision; product design; graphic design
creative: Adobe Creative Suite=Adobe Creative Cloud; Photoshop; Illustrator!; InDesign; After Effects; Premiere Pro; Lightroom; Canva; video editing; motion graphics; photography; typography
marketing: digital marketing; SEO=search engine optimization,search engine optimisation; search engine marketing; PPC=pay-per-click; Google Ads=AdWords,Google AdWords; Meta Ads=Facebook Ads; content marketing=content strategy,content calendar,editorial calendar; email marketing; social media marketing=social media,social media management,social media calendar; marketing automation; copywriting; brand management=branding,brand strategy; market research; campaign management=marketing campaigns; growth marketing; conversion rate optimization; ROAS=return on ad spend; CAC=customer acquisition cost; CTR=click-through rate; HubSpot; Marketo; Mailchimp; Hootsuite
sales: CRM=customer relationship management; Salesforce=SFDC; lead generation; business development; account management=key account management; B2B; B2C; SaaS; cold calling; pipeline management=sales pipeline; sales forecasting; quota attainment=quota; consultative selling=solution selling; territory management; upselling=cross-selling
finance: accounting=accountancy; bookkeeping=book keeping; GAAP=US GAAP; IFRS; financial reporting=financial statements; financial analysis; financial modeling=financial modelling; forecasting=forecasts; budgeting; reconciliation=reconciliations,reconcile,account reconciliation,bank reconciliation; accounts payable; accounts receivable; general ledger; auditing=audit,audits,internal audit; tax=taxation,tax preparation; CPA; CFA; ACCA; FP&A; variance analysis; month-end close=month end close,financial close; payroll; SOX=Sarbanes-Oxley; QuickBooks; Xero; NetSuite; SAP; Oracle Financials; treasury; cost accounting
healthcare: patient care; EHR=electronic health records,electronic health record; electronic medical records; Epic!; Cerner; HIPAA; basic life support; ACLS; CPR; triage; medication administration; phlebotomy; vital signs; clinical documentation; registered nurse=RN!; case management; infection control; patient education
hr: recruiting=recruitment; talent acquisition; onboarding; HRIS; Workday!; payroll; employee relations; performance management; compensation and benefits=benefits administration; sourcing; applicant tracking systems=ATS!; HR policies; learning and development=L&D,training and development; employee engagement; labor law=labour law,employment law
customer: customer service; customer support; customer success; client relations=client relationships,client management; Zendesk; Freshdesk; Intercom; ticketing=help desk,helpdesk,service desk; SLAs=SLA; CSAT; NPS; call center=contact center,call centre,contact centre; BPO=business process outsourcing; AHT=average handle time,average handling time; FCR=first call resolution,first contact resolution; ServiceNow
ops: supply chain=supply chain management; logistics; procurement; inventory management=inventory control; vendor management=supplier management; purchasing; warehouse management=warehousing; Six Sigma=Lean Six Sigma; Kaizen; ERP; demand planning; S&OP; operations management; quality control; manufacturing; process improvement
edu: curriculum development=curriculum design; lesson planning=lesson plans; classroom management; instructional design; LMS=learning management system,learning management systems; Moodle; Canvas!; e-learning=eLearning,online learning; teaching; tutoring; student assessment
office: Microsoft Office=MS Office,Office 365,Microsoft 365,M365; Excel!=Microsoft Excel,MS Excel; Word!=Microsoft Word,MS Word; PowerPoint=Power Point; Outlook!=Microsoft Outlook; Google Workspace=G Suite,GSuite; Google Sheets; Google Docs; SharePoint; Microsoft Teams=MS Teams; Slack!; Notion!; Zoom!; data entry
admin: calendar management=calendar scheduling,managing calendars,calendar; email management=inbox management,email inbox,managing emails,inbox; appointment setting=appointment scheduling
licence|norel: Licensed Professional Teacher=LPT!,LET!,LET passer,Licensure Examination for Teachers
legal|norel: contract management=contract negotiation; compliance=regulatory compliance; legal research; litigation; due diligence; intellectual property; GDPR; corporate law; risk assessment
spoken|norel w0.8: English; Spanish; French; German; Mandarin=Chinese; Cantonese; Japanese; Korean; Portuguese; Italian; Arabic; Hindi; Filipino=Tagalog; Vietnamese; Russian; Dutch; Indonesian=Bahasa Indonesia; Thai; bilingual
soft|norel w0.5: communication=communication skills,communicator; leadership=team leadership,people management; teamwork=team player; collaboration=collaborative,collaborated,collaborating; problem-solving=problem solving,problem solver; critical thinking; time management; mentoring=mentored,mentorship,mentor; coaching=coached; presentation skills=presentations,public speaking; negotiation=negotiating,negotiated; attention to detail=detail-oriented,detail oriented; cross-functional=cross functional,cross-functional teams; adaptability=adaptable; creativity=creative; organizational skills=organisational skills,organized; multitasking=multi-tasking; decision making=decision-making; strategic thinking=strategy; analytical skills=analytical; interpersonal skills=interpersonal; customer focus=customer-focused,customer-centric; self-motivated=self-starter; ownership; prioritization=prioritisation,prioritizing
licensed engineer|norel: civil engineer; mechanical engineer; electrical engineer
degree|norel w0.6: Bachelor's degree=Bachelor,Bachelors,BS!,BSc,B.S.,B.A.,Bachelor of Science,Bachelor of Arts,Bachelor of Engineering,Bachelor of Technology,Bachelor of Commerce; Master's degree=Master,Masters,MSc,M.S.,Master of Science,Master of Arts,Master of Engineering; MBA=Master of Business Administration; PhD=Ph.D.,doctorate,Doctor of Philosophy; associate degree=Associate's degree; computer science; software engineering; information technology=information systems; electrical engineering; mechanical engineering; civil engineering; business administration; economics; mathematics=math,maths; physics; finance; marketing; psychology; nursing=BSN; biology; chemistry; communications; education
`;

/** canonical lower-case key → { name, w, groups:Set, rel:boolean } */
export const SKILLS = new Map();
/** stem key ("unit test") → canonical key, for plain-word variants (case-insensitive, inflection-tolerant) */
const BY_STEM = new Map();
/** variants that need raw-text regex: case-sensitive or containing symbols */
const REGEX = [];
let maxN = 1;

// Single words use the light stemmer (inflections only) so "community" ≠ "communication"; phrases use full Porter,
// except for people, who are not their work: "project managers" ≠ "project management", "accountant" ≠ "accounting".
// -er verbs are not people ("deliver" = "delivered"). The raw word is tested: "engineering" light-stems to "engineer".
const NOT_PEOPLE = new Set("deliver consider register discover recover administer encounter uncover remember empower".split(" "));
const ANT_PEOPLE = new Set("accountant consultant assistant attendant applicant participant".split(" "));
const person = (w) => (/(?:er|or|ist)s?$/.test(w) && !NOT_PEOPLE.has(stem(w, true))) || ANT_PEOPLE.has(stem(w, true));
export const stemKey = (words) => (words.length === 1 ? stem(words[0], true) : words.map((w) => stem(w, person(w))).join(" "));

// Never marked: words that every CV in the field has, and acronyms with more than one meaning (GCP: Google Cloud or
// Good Clinical Practice). Typed into the terms box they still mark, literally. One-meaning acronyms (CSS, Git, SQL) stay.
const COMMON = "network; networking; software; development; software development; software engineering; web development; application development; technology; technologies; tech; system; solution; application; programming; coding; computer; digital; internet; online; technical; engineering";
const AMBIGUOUS = new Set("gcp nlp cro sem emr rag soc spa sas ecs sns bls ba ms cs pm pr ar ap ot pt pa ca er".split(" "));
const light = (s) => tokenize(s).map((t) => stem(t.t, true)).join(" ");
const NEVER = new Set([...COMMON.split("; "), ...AMBIGUOUS].map(light));
/** Too common to mark, or an ambiguous acronym; with `phrase`, also any phrase that names one ("GCP certification"). */
export const never = (s, phrase = false) => NEVER.has(light(s)) || (phrase && tokenize(s).some((t) => AMBIGUOUS.has(t.t)));

const plain = (v) => /^[a-z][a-z' -]*[a-z]$|^[a-z]$/i.test(v);
function addVariant(key, v) {
  const cs = v.endsWith("!");
  if (cs) v = v.slice(0, -1);
  if (!cs && plain(v)) {
    const words = tokenize(v).map((t) => t.t);
    const k = stemKey(words);
    if (!BY_STEM.has(k)) BY_STEM.set(k, key);
    maxN = Math.max(maxN, words.length);
    return;
  }
  // Short or single-letter terms (C, R, Go) also refuse a following dot/hyphen/apostrophe (Dr. R. Smith, C-level).
  const after = v.length <= 2 ? "(?![\\p{L}\\p{N}+#&'’./-])" : "(?![\\p{L}\\p{N}+#&]|[.](?=[\\p{L}\\p{N}]))";
  const before = /^[\p{L}\p{N}]/u.test(v) ? "(?<![\\p{L}\\p{N}+#&.])" : "(?<![\\p{L}\\p{N}])";
  REGEX.push({ key, re: new RegExp(before + escapeRe(v).replace(/ /g, "\\s+") + after, cs ? "gu" : "giu") });
}

for (const line of RAW.trim().split("\n")) {
  const i = line.indexOf(":");
  const [group, ...flags] = line.slice(0, i).split(/[| ]/);
  const norel = flags.includes("norel");
  const w = Number((flags.find((f) => /^w[\d.]+$/.test(f)) || "w1").slice(1));
  for (const item of line.slice(i + 1).split(";")) {
    const [name, aliases = ""] = item.split("=").map((s) => s.trim());
    if (!name) continue;
    const clean = name.replace(/!$/, "");
    const key = clean.toLowerCase();
    const sk = SKILLS.get(key) || { key, name: clean, w, groups: new Set(), rel: !norel };
    sk.w = Math.max(sk.w, w);
    if (!norel) sk.groups.add(group);
    SKILLS.set(key, sk);
    for (const v of [name, ...aliases.split(",").map((s) => s.trim()).filter(Boolean)]) addVariant(key, v);
  }
}

/**
 * Find dictionary skills in text. Returns [{ key, s, e }] with offsets into `text`, longest match first,
 * non-overlapping. `toks` (tokenize(text)) may be passed in to avoid re-tokenizing.
 */
export function findSkills(text, toks = tokenize(text)) {
  const hits = [];
  const keys = toks.map((t) => t.t);
  // adj[i]: token i and i+1 are separated only by spaces/hyphens, so they can form one phrase
  const adj = toks.map((t, i) => i + 1 < toks.length && /^[\s-]+$/.test(text.slice(t.e, toks[i + 1].s)));
  for (let i = 0; i < toks.length; i++) {
    let n = 1;
    while (n < maxN && i + n < toks.length && adj[i + n - 1]) n++;
    for (; n >= 1; n--) {
      const k = BY_STEM.get(stemKey(keys.slice(i, i + n)));
      if (k && !never(text.slice(toks[i].s, toks[i + n - 1].e))) { hits.push({ key: k, s: toks[i].s, e: toks[i + n - 1].e }); break; }
    }
  }
  for (const { key, re } of REGEX) for (const m of text.matchAll(re)) if (!never(m[0])) hits.push({ key, s: m.index, e: m.index + m[0].length });
  hits.sort((a, b) => a.s - b.s || b.e - a.e);
  const out = [];
  let end = -1;
  for (const h of hits) if (h.s >= end) { out.push(h); end = h.e; }
  return out;
}

/** Two skills are related when they share a group (and neither group is norel). */
export function related(a, b) {
  const A = SKILLS.get(a), B = SKILLS.get(b);
  if (!A || !B || a === b || !A.rel || !B.rel) return false;
  for (const g of A.groups) if (B.groups.has(g)) return true;
  return false;
}
