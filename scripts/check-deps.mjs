// Dependency hygiene: exact version pins, a permissive licence on every package in the bundle, no high/critical
// advisory in the production tree. Usage: node scripts/check-deps.mjs → "N checks, M FAIL" (exit 1 on failure). npm audit needs the network.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { build } from "vite";

let checks = 0, fails = 0;
const check = (ok, what, detail = "") => { checks++; if (!ok) { fails++; console.log(`FAIL ${what}${detail ? `: ${detail}` : ""}`); } };
const pkg = JSON.parse(readFileSync("package.json", "utf8"));

for (const [name, v] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) check(/^\d+\.\d+\.\d+$/.test(v), `${name} pinned exactly`, v);

// every package that ends up in the bundle (app and worker), by its package.json licence
const ids = new Set();
const collect = () => ({ name: "collect", generateBundle(_, out) { for (const c of Object.values(out)) if (c.type === "chunk") for (const id of Object.keys(c.modules)) ids.add(id); } });
await build({ logLevel: "error", build: { write: false }, plugins: [collect()], worker: { format: "es", plugins: () => [collect()] } });
const dirs = new Set([...ids].map((id) => id.replace(/^\0/, "").match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//)?.[1]).filter(Boolean));
const PERMISSIVE = new Set(["MIT", "ISC", "0BSD", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "BlueOak-1.0.0", "Zlib"]);
const ok = (lic = "") => { const ids = lic.replace(/[()]/g, "").split(/\s+(?:OR|AND)\s+/); return / OR /.test(lic) ? ids.some((x) => PERMISSIVE.has(x)) : ids.every((x) => PERMISSIVE.has(x)); };
const odd = [...dirs].map((d) => [d.replace(/^.*node_modules\//, ""), JSON.parse(readFileSync(d + "/package.json", "utf8")).license]).filter(([, l]) => !ok(l));
check(dirs.size > 5 && odd.length === 0, `permissive licences on the ${dirs.size} bundled packages`, odd.map(([n, l]) => `${n} (${l})`).join(", "));

let audit;
try { audit = JSON.parse(execSync("npm audit --omit=dev --json", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })); }
catch (e) { audit = e.stdout ? JSON.parse(e.stdout) : null; } // npm audit exits 1 when it finds anything
const v = audit?.metadata?.vulnerabilities;
check(!!v, "npm audit ran", "no result (offline?)");
if (v) check(v.high + v.critical === 0, "no high or critical advisory in shipped packages", JSON.stringify(v));

console.log(`${checks} checks, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
