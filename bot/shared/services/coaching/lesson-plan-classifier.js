/**
 * FEAT-106 #8 (bd-2372) — lesson-plan content validation.
 *
 * The extraction worker parses ANY uploaded document into the LP schema and
 * marks it 'completed'. A teacher who sends the wrong file (Irum, ICT, DC-9:
 * an application/leave letter) had it silently "analysed" with no reply. This
 * classifier reads the parsed structured data and decides whether the document
 * actually looks like a lesson plan, so the worker can tell her fast instead of
 * treating a letter as a plan.
 *
 * Pure function — no I/O, no heavy deps — so it is unit-testable in isolation
 * (the worker itself pulls pdf-parse / mammoth / textract at load).
 *
 * @param {object|null} structured  the parseWithGPT4oMini output
 * @returns {boolean|null}  true = looks like an LP, false = clearly not,
 *                          null = cannot classify (no structured data)
 */
function isLikelyLessonPlan(structured) {
  if (!structured || typeof structured !== 'object') return null;

  // The parser may state it outright — trust an explicit verdict.
  if (typeof structured.is_lesson_plan === 'boolean') return structured.is_lesson_plan;

  const nonEmptyArray = (v) => Array.isArray(v) && v.length > 0;
  const nonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;

  // Count independent lesson-plan signals. A leave letter / notice / form has
  // none of these; even a thin lesson plan has at least an objective + a
  // subject or an activity.
  const signals = [
    nonEmptyArray(structured.objectives),
    nonEmptyArray(structured.activities),
    nonEmptyArray(structured.materials),
    nonEmptyArray(structured.assessment_methods),
    nonEmptyArray(structured.assessment_protocols),
    nonEmptyArray(structured.assessment_sequences),
    nonEmptyArray(structured.planned_questions),
    structured.objectives_found === true,
    structured.materials_found === true,
    structured.assessment_found === true,
    structured.prior_knowledge_found === true,
    nonEmptyString(structured.subject),
    nonEmptyString(structured.topic),
  ].filter(Boolean).length;

  // Two independent signals clears the bar — one stray field (a "subject" line
  // on a letterhead) is not enough.
  return signals >= 2;
}

module.exports = { isLikelyLessonPlan };
