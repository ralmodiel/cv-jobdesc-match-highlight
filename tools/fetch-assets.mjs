// Usage: node scripts/fetch-assets.mjs  — puts the embedding model under public/models and the ONNX wasm under public/ort.
// Pinned to a model revision and checked by hash, so a changed upstream file fails loudly instead of shipping.
import { createHash } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const REV = "ea104dacec62c0de699686887e3f920caeb4f3e3"; // Xenova/bge-small-en-v1.5, 2025-07-22
const DIR = "public/models/Xenova/bge-small-en-v1.5/";
// [file, kind, hash]: sha256 for LFS objects, git blob sha1 for small files (what the HF API reports)
const FILES = [
  ["config.json", "git", "0c4d86248983ce46dfc09a9091b6f56bb0224550"],
  ["tokenizer.json", "git", "688882a79f44442ddc1f60d70334a7ff5df0fb47"],
  ["tokenizer_config.json", "git", "37fca74771bc76a8e01178ce3a6055a0995f8093"],
  ["special_tokens_map.json", "git", "a8b3208c2884c4efb86e49300fdd3dc877220cdf"],
  ["onnx/model_quantized.onnx", "sha256", "6c9c6101a956d62dfb5e7190c538226c0c5bb9cb27b651234b6df063ee7dbfe4"],
];
const hash = (buf, kind) => kind === "sha256"
  ? createHash("sha256").update(buf).digest("hex")
  : createHash("sha1").update(`blob ${buf.length}\0`).update(buf).digest("hex");

let bad = 0;
for (const [f, kind, want] of FILES) {
  const out = DIR + f;
  if (existsSync(out) && hash(readFileSync(out), kind) === want) continue;
  const res = await fetch(`https://huggingface.co/Xenova/bge-small-en-v1.5/resolve/${REV}/${f}`);
  if (!res.ok) { console.error(`FAIL ${f}: HTTP ${res.status}`); bad++; continue; }
  const buf = Buffer.from(await res.arrayBuffer());
  if (hash(buf, kind) !== want) { console.error(`FAIL ${f}: hash mismatch`); bad++; continue; }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, buf);
  console.log(`got ${f} (${buf.length} bytes)`);
}
// Plain SIMD build: transformers.js also uses it on Safari<26, and we only run the WASM backend, single-threaded.
mkdirSync("public/ort", { recursive: true });
for (const f of ["ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm"])
  copyFileSync("node_modules/onnxruntime-web/dist/" + f, "public/ort/" + f);
// pdf.js data for PDFs that rely on non-embedded standard fonts, CJK CMaps or JPX/JBIG2 images: served locally, never a CDN.
for (const d of ["standard_fonts", "cmaps", "wasm"]) cpSync("node_modules/pdfjs-dist/" + d, "public/pdfjs/" + d, { recursive: true });
console.log(`${FILES.length + 5} assets, ${bad} FAIL`);
process.exit(bad ? 1 : 0);
