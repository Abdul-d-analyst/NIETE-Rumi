/**
 * Deterministic, seedable pseudo-random numbers.
 *
 * WHY THIS EXISTS
 * ---------------
 * Some decisions have to be random-looking to the user but perfectly
 * reproducible to the code — because nothing about the decision is stored.
 *
 * The motivating case is quiz serving: which questions an attempt gets, and
 * in which order the options are shown. The served set is recorded nowhere
 * (there is no join table, only one answer row per ANSWERED question), and
 * three separate code paths re-derive it independently — the question sender,
 * the button handler, and a resume after a day's gap. If any of them used
 * `Math.random()` they would disagree, and a teacher would be graded against
 * a question they never saw.
 *
 * Seeding on stable identifiers instead (the attempt id, the question id)
 * makes every one of those paths compute the same answer, forever, with zero
 * new storage.
 *
 * WHAT IT IS NOT
 * --------------
 * Not cryptographic. Never use this for tokens, codes, or anything an
 * adversary should not be able to predict — a teacher who knows their own
 * attempt id can, in principle, reproduce their option order. That is
 * acceptable here (they can already see the options) and unacceptable
 * anywhere secret. Use `crypto.randomUUID()` / `crypto.randomBytes()` there.
 *
 * Algorithms: xmur3 (string → 32-bit seed) + mulberry32 (32-bit seed → PRNG).
 * Both are tiny, public-domain, and well-distributed for this purpose, which
 * is why they are inlined rather than pulled in as a dependency.
 */

/**
 * Hash a string into a 32-bit seed generator.
 * @param {string} str
 * @returns {() => number} call it for successive 32-bit seeds
 */
function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function next() {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

/**
 * mulberry32 — 32-bit state PRNG.
 * @param {number} a seed
 * @returns {() => number} uniform in [0, 1)
 */
function mulberry32(a) {
  let t = a >>> 0;
  return function next() {
    t = (t + 0x6D2B79F5) >>> 0;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build a reproducible random-number generator from any seed value.
 * The same seed always yields the same sequence.
 *
 * @param {string|number} seed
 * @returns {() => number} uniform in [0, 1)
 */
function makeRng(seed) {
  return mulberry32(xmur3(String(seed))());
}

/**
 * Fisher-Yates shuffle driven by a seeded RNG. Pure — returns a new array.
 *
 * @template T
 * @param {T[]} items
 * @param {string|number} seed
 * @returns {T[]} a deterministic permutation of `items`
 */
function seededShuffle(items, seed) {
  const out = [...items];
  const rng = makeRng(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

module.exports = { makeRng, seededShuffle };
