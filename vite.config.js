import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { LIMITS } from "./src/lib/files.js";

// Production CSP, injected at build time only: Vite's dev server needs inline scripts for HMR and React refresh.
// No third-party origin appears anywhere, so the browser itself refuses to send the CV (or anything) elsewhere.
export const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self' data: blob:",
  "connect-src 'self' blob: data:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "media-src 'none'",
  "manifest-src 'self'",
].join("; ");

const csp = () => ({
  name: "csp",
  apply: "build",
  transformIndexHtml: () => [{ tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: CSP }, injectTo: "head-prepend" }],
});

// A PDF stream can unpack without end (a "PDF bomb": 15 MB of file, 15 GB of stream, a crashed tab), so every way pdf.js (in its
// worker) and pdf-lib unpack one stops at 256 MB (a 48 MP photo stored losslessly is 144 MB). pdf.js keeps what it read before
// that; a PDF rebuild is refused (pdf-write.js). The build fails if a library no longer has the code patched here.
// shortcut: the cap is per stream, so many capped streams still cost CPU in the worker; add a per-file budget if that shows up.
const STREAM_CAP = 256 << 20, STOP = `throw new Error("A stream in this PDF unpacks to more than 256 MB.")`;
const BIG = `throw new Error("An image in this PDF is over ${LIMITS.imagePx / 1e6} megapixels.")`;
const patchLibraries = () => ({
  name: "patch-libraries",
  transform(code, id) {
    const patches = /pdf\.worker\.min\.mjs($|\?worker_file)/.test(id) ? [ // pdf.js's worker (built or dev), minified
      [/ensureBuffer\((\w+)\)\{(?=const \w+=this\.buffer;)/g, (m, v) => `${m}if(${v}>${STREAM_CAP})${STOP};`], // every filter
      // the browser's DecompressionStream (a page's only content stream, images) unpacks each written chunk whole (a 14 GB
      // bomb in one go crashed the tab), so feed it 64 KB at a time (≤ 66 MB out each) and count; pdf.js then retries on the capped path above
      [/(new DecompressionStream\(\w+\),(\w+)=\w+\.getWriter\(\);)\2\.write\((\w+)\)\.catch\(\(\)=>\{\}\);\2\.close\(\)\.catch\(\(\)=>\{\}\);/g,
        (m, pre, w, b) => `${pre}(async()=>{for(let i_=0;i_<${b}.length;i_+=65536)await ${w}.write(${b}.subarray(i_,i_+65536));await ${w}.close()})().catch(()=>{});`],
      [/const\{value:(\w+),done:\w+\}=await \w+\.read\(\);if\(\w+\)break;\w+\.push\(\1\);(\w+)\+=\1\.byteLength/g, (m, _, v) => `${m};if(${v}>${STREAM_CAP})${STOP}`],
      [/(\w+)\+=(\w+)\.outputUsed;(?=if\(\2\.outputUsed<16384\)break)/g, (m, v) => `${m}if(${v}>${STREAM_CAP})${STOP};`], // Brotli, whole
      // pdf.js checks an image against the size the PDF states (maxImageSize, pdf-read.js), but decodes it at the size its own
      // header claims: the JS JPEG decoder allocates for that size up front, JPEG 2000 grows its wasm memory up to 2 GB
      [/function prepareComponents\((\w+)\)\{/g, (m, f) => `${m}if(${f}.samplesPerLine*${f}.scanLines>${LIMITS.imagePx})${BIG};`],
      [/=JpxImage\.parseImageProperties\((\w+)\.stream\)\);/g, (m, a) => `${m}if(${a}.width*${a}.height>${LIMITS.imagePx})${BIG};`],
    ] : /pdf-lib/.test(id) && /\.prototype\.ensureBuffer = function/.test(code) ? [
      [/DecodeStream\d*\.prototype\.ensureBuffer = function ?\((\w+)\) ?\{/g, (m, v) => `${m}if(${v}>${STREAM_CAP})${STOP};`],
    ] : /docx-preview/.test(id) && /parseDefaultProperties\(elem, style/.test(code) ? [
      // not a cap: docx-preview drops a run's character spacing (w:spacing in w:rPr), which docx.js sets to keep bold words' width
      [/(case "spacing":\s*if \(elem\.localName == "pPr"\)\s*this\.parseSpacing\(c, style\);)/g,
        (m) => `${m} else if (elem.localName == "rPr") style["letter-spacing"] = globalXmlParser.lengthAttr(c, "val");`],
      // nor a cap: it drops the paragraph mark's format (w:rPr in w:pPr), which sizes an empty paragraph (a CV's spacer lines); kept as
      // an empty run that fitLines (Preview.jsx) reads and removes
      [/this\.parseDefaultProperties\(elem, paragraph\.cssStyle = \{\}, null, c => \{/g, (m) => `${m} if (c.localName == "rPr") paragraph.children`
        + `.push({ type: DomType.Run, className: "docx-mark", children: [], cssStyle: this.parseDefaultProperties(c, {}) });`],
    ] : [];
    for (const [re, to] of patches) {
      let n = 0;
      code = code.replace(re, (...a) => (n++, to(...a)));
      if (n !== 1) this.error(`expected one match of ${re} in ${id}, found ${n}`);
    }
    return patches.length ? { code, map: null } : null;
  },
});

// The language model's and its runtime's sizes, for the progress embed-worker.js counts: a host that compresses them sends no length.
const bytes = (f) => (existsSync(f) ? statSync(f).size : 0);

export default defineConfig({
  base: "./",
  define: { __MODEL_BYTES__: JSON.stringify({ onnx: bytes("public/models/Xenova/bge-small-en-v1.5/onnx/model_quantized.onnx"), wasm: bytes("public/ort/ort-wasm-simd-threaded.wasm") }) },
  worker: { format: "es", plugins: () => [patchLibraries()] },
  resolve: {
    // CPU-only runtime that loads its .wasm from public/ort/ (wasmPaths in embed-worker.js); the WebGPU bundle
    // transformers.js imports would also copy an unused 27 MB .wasm into dist/.
    alias: [{ find: /^onnxruntime-web\/webgpu$/, replacement: fileURLToPath(new URL("node_modules/onnxruntime-web/dist/ort.wasm.min.mjs", import.meta.url)) }],
  },
  build: { target: "es2022", modulePreload: { polyfill: false }, chunkSizeWarningLimit: 1500 },
  plugins: [react(), tailwindcss(), csp(), patchLibraries()],
});
