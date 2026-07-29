/**
 * FEAT-106 #9 (bd-2373) — plain-language glossing of coach-jargon.
 *
 * Sara (ICT, DC-2) couldn't parse an action card that used "scaffolding" /
 * "extension". Our commitment-card and report prompts deliberately keep
 * pedagogical terms in English (teachers code-switch), but a handful of terms
 * are COACH-jargon the teacher never says — she needs them explained.
 *
 * This glosses only that curated set, inline, the FIRST time each term appears,
 * in the surrounding language (English gloss on the en path, Urdu gloss on the
 * ur path). Terms teachers actually use (open-ended questions, wait time,
 * Think-Pair-Share) are intentionally NOT in the registry. Idempotent: a term
 * already followed by "(" is left alone, so re-running never double-glosses.
 *
 * Pure, dependency-free → unit-testable in isolation.
 */

// term (lowercase, matched case-insensitively at word boundaries) → glosses.
// Keep ONLY true coach-jargon here. Do not add terms teachers say themselves.
const JARGON = [
  // Longer phrases first so a phrase is glossed whole, not partially.
  { term: 'scaffolding',          en: 'step-by-step support',                         ur: 'قدم بہ قدم مدد' },
  { term: 'scaffold',             en: 'break the task into small steps',              ur: 'کام کو چھوٹے مرحلوں میں بانٹنا' },
  { term: 'extension activity',   en: 'an extra challenge for fast finishers',        ur: 'تیز مکمل کرنے والوں کے لیے اضافی مشق' },
  { term: 'extension',            en: 'an extra challenge for fast finishers',        ur: 'تیز مکمل کرنے والوں کے لیے اضافی مشق' },
  { term: 'differentiation',      en: 'adjusting the task to each child’s level', ur: 'ہر بچے کی سطح کے مطابق کام' },
  { term: 'formative assessment', en: 'a quick check of understanding during the lesson', ur: 'دورانِ سبق سمجھ کی جانچ' },
  { term: 'higher-order thinking', en: 'questions that make students think, not just recall', ur: 'ایسے سوال جو سوچنے پر مجبور کریں، صرف یاد نہیں' },
  { term: 'metacognition',        en: 'getting students to think about their own thinking', ur: 'بچوں کو اپنی سوچ پر غور کرانا' },
  { term: 'gradual release',      en: 'do it together first, then let them try alone', ur: 'پہلے مل کر، پھر خود کرنے دینا' },
];

function glossFor(entry, lang) {
  const isUrdu = String(lang || '').slice(0, 2) === 'ur';
  return isUrdu ? `یعنی ${entry.ur}` : entry.en; // "یعنی <gloss>" in Urdu
}

/**
 * @param {string|null} text
 * @param {string} lang  language code (en/ur/...); gloss language follows it
 * @returns {string|null}
 */
function simplifyPedagogyJargon(text, lang = 'en') {
  if (!text || typeof text !== 'string') return text;
  let out = text;
  for (const entry of JARGON) {
    // First occurrence only, and NOT if it's already glossed (followed by "(").
    const re = new RegExp(`\\b(${entry.term.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')})\\b(?!\\s*\\()`, 'i');
    const m = out.match(re);
    if (m) {
      const idx = m.index + m[0].length;
      out = `${out.slice(0, idx)} (${glossFor(entry, lang)})${out.slice(idx)}`;
    }
  }
  return out;
}

module.exports = { simplifyPedagogyJargon, JARGON };
