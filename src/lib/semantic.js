// Client side of the model worker: unit vectors per text (cached, so a longer job ad only embeds what is new) and,
// per CV block, how close it comes in meaning to the closest requirement sentence of the job.
let worker = null, seq = 0;
const calls = new Map();
const cache = new Map(); // text → Float32Array
const listeners = new Set();
export const model = { status: "idle", pct: 0, error: "" }; // idle | loading | ready | error

function set(patch) {
  Object.assign(model, patch);
  for (const f of listeners) f({ ...model });
}
export const onModel = (f) => (listeners.add(f), () => listeners.delete(f));

function call(msg) {
  if (!worker) {
    worker = new Worker(new URL("./embed-worker.js", import.meta.url), { type: "module", name: "language-model" });
    worker.onmessage = ({ data }) => {
      if (data.type === "progress") return set({ status: "loading", pct: data.pct });
      const c = calls.get(data.id);
      calls.delete(data.id);
      if (data.type === "error") { set({ status: "error", error: data.message }); c?.reject(new Error(data.message)); }
      else { if (model.status !== "ready") set({ status: "ready", pct: 100 }); c?.resolve(data); }
    };
    worker.onerror = (e) => {
      set({ status: "error", error: e.message || "worker failed" });
      for (const c of calls.values()) c.reject(new Error("model worker failed"));
      calls.clear();
      worker = null;
    };
  }
  const id = ++seq;
  if (model.status === "idle" || model.status === "error") set({ status: "loading", pct: 0, error: "" });
  return new Promise((resolve, reject) => {
    calls.set(id, { resolve, reject });
    worker.postMessage({ ...msg, id, base: document.baseURI });
  });
}

/** Start loading the model at the user's first step, so it is ready by the time both the CV and the job are in (not on Data Saver). */
export function warmUp() {
  if (model.status === "idle" && !navigator.connection?.saveData) call({ type: "load" }).catch(() => {}); // a failure shows when lines are ranked
}

export async function embed(texts) {
  const todo = [...new Set(texts)].filter((t) => !cache.has(t));
  for (let i = 0; i < todo.length; i += 16) {
    const chunk = todo.slice(i, i + 16);
    const { dim, data } = await call({ type: "embed", texts: chunk });
    chunk.forEach((t, k) => cache.set(t, data.slice(k * dim, (k + 1) * dim)));
  }
  return texts.map((t) => cache.get(t));
}

const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

/** For each text, { order: the indices of `options` from the closest in meaning to the furthest, scores: their cosines }. */
export async function closest(texts, options) {
  const [o, t] = await Promise.all([embed(options), embed(texts)]);
  return t.map((v) => {
    const s = o.map((u, i) => [dot(v, u), i]).sort((x, y) => y[0] - x[0]);
    return { order: s.map(([, i]) => i), scores: s.map(([d]) => d) };
  });
}
// Measured on the sample CV (scripts/harness.js semRaw): lines that fit the job score 0.67–0.87 against it, the best
// line against an unrelated (nursing) job 0.61. Spreading 0.6..0.85 to 0..1 means an unrelated job ranks nothing by meaning.
const LO = 0.6, HI = 0.85;

/** sem per block, 0..1 (blocks under 4 words get 0): closeness to the nearest requirement sentence. */
export async function blockSimilarity(blocks, requirements) {
  if (!requirements.length) return null;
  const idx = blocks.map((b, i) => (b.text.trim().split(/\s+/).length >= 4 ? i : -1)).filter((i) => i >= 0);
  const [reqs, lines] = await Promise.all([embed(requirements), embed(idx.map((i) => blocks[i].text.trim().slice(0, 600)))]);
  const sem = blocks.map(() => 0);
  idx.forEach((bi, k) => {
    const best = Math.max(...reqs.map((r) => dot(lines[k], r)));
    sem[bi] = +Math.min(1, Math.max(0, (best - LO) / (HI - LO))).toFixed(3);
  });
  return sem;
}
