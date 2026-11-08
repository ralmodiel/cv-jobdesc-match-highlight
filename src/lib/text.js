// Text helpers shared by the JD analyser and the CV matcher. Pure functions, no DOM, so they run in Node checks too.

// Words with tech punctuation inside or at the end: C++, C#, Node.js, R&D, B2B, .NET, k8s. "/" splits (C++/C#);
// slash terms like CI/CD are matched by the skills dictionary on raw text, not by tokens.
const WORD = /\.?[\p{L}\p{N}](?:[\p{L}\p{N}+#&'’.-]*[\p{L}\p{N}+#])?/gu;

/** Split text into word tokens with offsets into the original string. `t` is lower-cased, quotes folded. */
export function tokenize(text) {
  const out = [];
  for (const m of text.matchAll(WORD)) {
    let w = m[0], s = m.index;
    if (w[0] === "." && !/^\.(net|js)\b/i.test(w)) { w = w.slice(1); s++; }
    // "skills." / "Node.js," end-of-sentence dots are not part of the word; keep inner ones (Node.js)
    while (/[.'’-]$/.test(w)) w = w.slice(0, -1);
    if (!w) continue;
    out.push({ t: w.toLowerCase().replace(/’/g, "'"), s, e: s + w.length, raw: w });
  }
  return out;
}

export const STOP = new Set(("a an and are as at be been but by can could did do does for from had has have he her his i " +
  "if in into is it its me my of on or our ours she so such than that the their them then there these they this " +
  "those to too us was we were what when where which while who whom why will with would you your yours etc " +
  "via per across within without over under up down out off about above below between through during before after " +
  "also not no nor only own same just any all both each every few more most other some very may might must shall should " +
  "am being having doing let lets i'm we're you're it's").split(" "));

const VOWEL = /[aeiou]/;
const cons = (w, i) => {
  const c = w[i];
  if ("aeiou".includes(c)) return false;
  return c === "y" ? (i === 0 ? true : !cons(w, i - 1)) : true;
};
// m = number of VC sequences in the stem
const measure = (s) => {
  let n = 0, i = 0;
  const L = s.length;
  while (i < L && cons(s, i)) i++;
  while (i < L) {
    while (i < L && !cons(s, i)) i++;
    if (i >= L) break;
    n++;
    while (i < L && cons(s, i)) i++;
  }
  return n;
};
const hasVowel = (s) => { for (let i = 0; i < s.length; i++) if (!cons(s, i)) return true; return false; };
const doubleC = (s) => s.length > 1 && s[s.length - 1] === s[s.length - 2] && cons(s, s.length - 1);
const cvc = (s) => {
  const L = s.length;
  return L >= 3 && cons(s, L - 3) && !cons(s, L - 2) && cons(s, L - 1) && !"wxy".includes(s[L - 1]);
};
const STEP2 = [["ational", "ate"], ["tional", "tion"], ["enci", "ence"], ["anci", "ance"], ["izer", "ize"], ["bli", "ble"],
  ["alli", "al"], ["entli", "ent"], ["eli", "e"], ["ousli", "ous"], ["ization", "ize"], ["ation", "ate"], ["ator", "ate"],
  ["alism", "al"], ["iveness", "ive"], ["fulness", "ful"], ["ousness", "ous"], ["aliti", "al"], ["iviti", "ive"],
  ["biliti", "ble"], ["logi", "log"]];
const STEP3 = [["icate", "ic"], ["ative", ""], ["alize", "al"], ["iciti", "ic"], ["ical", "ic"], ["ful", ""], ["ness", ""]];
const STEP4 = ["al", "ance", "ence", "er", "ic", "able", "ible", "ant", "ement", "ment", "ent", "ion", "ou", "ism", "ate",
  "iti", "ous", "ive", "ize"];
const stemCache = new Map();
// -ing nouns that mean something else than the verb's other forms: accounting ≠ "key accounts", marketing ≠ "new markets"
const KEEP = new Set(["accounting", "marketing", "banking", "branding"]);

/**
 * Porter (1980) stemmer, British -ise folded to -ize first. Only for [a-z] words; others come back unchanged.
 * light=true runs only the inflection steps (1a-1c, 5): managing→manag but community≠communication.
 */
export function stem(word, light = false) {
  let w = word.toLowerCase();
  if (w.length <= 2 || !/^[a-z]+$/.test(w) || KEEP.has(w)) return w;
  const ck = light ? "~" + w : w;
  const hit = stemCache.get(ck);
  if (hit) return hit;
  const orig = w;
  w = w.replace(/is(e|es|ed|ing|ation|ations|er|ers)$/, "iz$1").replace(/ys(e|es|ed|ing|er|ers)$/, "yz$1");
  // 1a
  if (w.endsWith("sses")) w = w.slice(0, -2);
  else if (w.endsWith("ies")) w = w.slice(0, -2);
  else if (!w.endsWith("ss") && w.endsWith("s")) w = w.slice(0, -1);
  // 1b
  let fix = false;
  if (w.endsWith("eed")) { if (measure(w.slice(0, -3)) > 0) w = w.slice(0, -1); }
  else if (w.endsWith("ed") && hasVowel(w.slice(0, -2))) { w = w.slice(0, -2); fix = true; }
  else if (w.endsWith("ing") && hasVowel(w.slice(0, -3))) { w = w.slice(0, -3); fix = true; }
  if (fix) {
    if (/(at|bl|iz)$/.test(w)) w += "e";
    else if (doubleC(w) && !/[lsz]$/.test(w)) w = w.slice(0, -1);
    else if (measure(w) === 1 && cvc(w)) w += "e";
  }
  // 1c
  if (w.endsWith("y") && hasVowel(w.slice(0, -1))) w = w.slice(0, -1) + "i";
  if (!light) {
  for (const [s, r] of STEP2) if (w.endsWith(s)) { if (measure(w.slice(0, -s.length)) > 0) w = w.slice(0, -s.length) + r; break; }
  for (const [s, r] of STEP3) if (w.endsWith(s)) { if (measure(w.slice(0, -s.length)) > 0) w = w.slice(0, -s.length) + r; break; }
  for (const s of STEP4) if (w.endsWith(s)) {
    const b = w.slice(0, -s.length);
    if (measure(b) > 1 && (s !== "ion" || /[st]$/.test(b))) w = b;
    break;
  }
  }
  // 5
  if (w.endsWith("e")) { const b = w.slice(0, -1); const m = measure(b); if (m > 1 || (m === 1 && !cvc(b))) w = b; }
  if (measure(w) > 1 && doubleC(w) && w.endsWith("l")) w = w.slice(0, -1);
  if (!VOWEL.test(w) && !w.includes("y")) w = orig; // never stem a word to nothing meaningful
  stemCache.set(ck, w);
  return w;
}

/** Lower-case, fold quotes/dashes, collapse spaces. For keys and display comparisons. */
export const norm = (s) => s.normalize("NFKC").toLowerCase().replace(/[’‘]/g, "'").replace(/[‐-―]/g, "-")
  .replace(/\s+/g, " ").trim();

export const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Split prose into sentences/clauses with offsets. Line breaks and bullet glyphs always split; dots only before a space. */
export function sentences(text) {
  const out = [];
  let last = 0;
  const push = (a, b) => {
    const raw = text.slice(a, b), lead = raw.length - raw.trimStart().length, t = raw.trim();
    if (/[\p{L}\p{N}]/u.test(t)) out.push({ text: t, s: a + lead, e: a + lead + t.length });
  };
  for (const m of text.matchAll(/[.!?;](?=\s|$)|[\n•·▪◦‣●■]/gu)) {
    push(last, m[0] === "\n" || m[0].length !== 1 || !".!?;".includes(m[0]) ? m.index : m.index + 1);
    last = m.index + 1;
  }
  push(last, text.length);
  return out;
}
