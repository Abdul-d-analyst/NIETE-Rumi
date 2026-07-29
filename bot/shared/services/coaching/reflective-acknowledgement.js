/**
 * FEAT-106 #4a (bd-2374) — reflective answer acknowledgement.
 *
 * After the teacher's single reflective answer, the flow jumped to a generic
 * "Thank you for your thoughtful reflections 🙏" with nothing that reflected
 * back what she said — it read as if the bot ignored her (Hareem, Irum; ICT).
 *
 * This builds a short warm line that names what she said. Generation is injected
 * (the caller passes a `generator(prompt) => text`), so this module is pure and
 * unit-testable; the caller falls back to the generic thanks whenever this
 * returns null (empty answer, LLM failure, blank output).
 */

/**
 * @param {string} answer    the teacher's reflective answer
 * @param {string} question  the question she was answering (for context)
 * @param {string} langName  target language name (English/Urdu/…)
 * @returns {string} system prompt
 */
function buildAcknowledgementPrompt(answer, question, langName = 'English') {
  return `The teacher just finished a short reflective coaching conversation.

The reflective question we asked her:
"${question}"

Her answer:
"${answer}"

Write ONE short, warm sentence in ${langName} that reflects HER answer back to her — name the specific thing SHE said so she feels genuinely heard. Rules:
- Do NOT ask a new question. Do NOT add advice or a next step.
- Gender-neutral — never gendered second-person verb forms; we do not know her gender.
- Plain language; keep any pedagogical/technical terms in English (Latin letters) inline.
- Max ~25 words. Warm, specific, human. End on a statement, not a question.
Return ONLY the sentence — no quotes, no preamble.`;
}

/**
 * @param {string} answer
 * @param {string} question
 * @param {string} languageCode
 * @param {{generator: (prompt:string)=>Promise<string>, langName?: string}} deps
 * @returns {Promise<string|null>}  the line, or null to fall back to generic thanks
 */
async function generateAcknowledgement(answer, question, languageCode, deps = {}) {
  const { generator, langName } = deps;
  if (typeof generator !== 'function') return null;
  if (!answer || typeof answer !== 'string' || answer.trim().length < 2) return null;
  try {
    const prompt = buildAcknowledgementPrompt(answer, question || '', langName || 'English');
    const raw = await generator(prompt);
    const line = String(raw || '').trim().replace(/^["'\s]+|["'\s]+$/g, '');
    return line.length ? line : null;
  } catch (_e) {
    return null;
  }
}

module.exports = { buildAcknowledgementPrompt, generateAcknowledgement };
