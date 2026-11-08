// The language model, off the main thread: bge-small-en-v1.5 (int8, 34 MB) turns sentences into vectors so CV lines can
// be compared with the job's requirements by meaning. Model and runtime come from this site; remote models are disabled.
import { env, pipeline } from "@huggingface/transformers";

let model = null;
const net = self.fetch.bind(self);

/** fetch that counts the model's and the runtime's bytes into one progress figure (sizes from vite.config.js). Not
 *  transformers.js's progress_callback: with one it fetches every file twice (once for its size) and, when the host
 *  compresses them (no Content-Length), shows 100% from the first byte and copies its whole buffer at every chunk. */
function counting() {
  let got = 0, shown = 0;
  const total = __MODEL_BYTES__.onnx + __MODEL_BYTES__.wasm;
  return async (url, init) => {
    const res = await net(url, init);
    if (!res.ok || !res.body || !/\.(onnx|wasm)$/.test(String(url))) return res;
    const body = res.body.pipeThrough(new TransformStream({
      transform(chunk, out) {
        out.enqueue(chunk);
        const pct = Math.min(100, Math.round(((got += chunk.byteLength) / total) * 100));
        if (pct > shown) postMessage({ type: "progress", pct: (shown = pct) });
      },
    }));
    return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
  };
}

function load(base) {
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  // a path, not a URL: transformers.js 4.3 reports files under an http(s) localModelPath as missing (so no tokenizer)
  env.localModelPath = new URL("models/", base).pathname;
  env.useWasmCache = false; // import the runtime from its own URL instead of re-wrapping it as a blob: module
  const wasm = env.backends.onnx.wasm;
  wasm.wasmPaths = { mjs: new URL("ort/ort-wasm-simd-threaded.mjs", base).href, wasm: new URL("ort/ort-wasm-simd-threaded.wasm", base).href };
  wasm.numThreads = 1; // threads need cross-origin isolation, which a static host cannot promise
  env.fetch = self.fetch = counting(); // transformers.js fetches the model through env.fetch, onnxruntime its .wasm through fetch
  return pipeline("feature-extraction", "Xenova/bge-small-en-v1.5", { dtype: "q8", device: "wasm" });
}

let queue = Promise.resolve(); // one inference at a time: an ONNX session must not run concurrently
self.onmessage = ({ data }) => { queue = queue.then(() => handle(data)); };

async function handle(data) {
  try {
    model ||= load(data.base);
    const embed = await model;
    if (data.type === "load") return postMessage({ type: "ready", id: data.id });
    const out = await embed(data.texts, { pooling: "cls", normalize: true });
    postMessage({ type: "vectors", id: data.id, dim: out.dims[1], data: out.data });
  } catch (e) {
    model = null;
    postMessage({ type: "error", id: data.id, message: String(e?.message || e) });
  }
}
