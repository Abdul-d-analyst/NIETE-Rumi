'use strict';
/**
 * FEAT-116 (bd-2302 → bd-2329) — teacher prioritisation for the /observe visit Flow.
 *
 * bd-2329 (operator 2026-07-28) supersedes the bd-2302 "recency only, never the
 * score" rule. The picker now orders by a COMBINED weight of two support signals:
 *   - support-need:  a low average AI-coaching score → this teacher needs support.
 *   - recency:       not visited in a while (or never) → this teacher is overdue.
 * Both are surfaced in the picker UI ("Needs support" + "Last visited …"). When a
 * teacher has NO visit history the recency term is maximal, so among the
 * never-visited the order collapses to score-ascending (lowest first) — exactly the
 * operator's fallback rule.
 *
 * Non-punitive framing is preserved: the score is one of two equal terms (not the
 * sole ranker), the label is "Needs support" (never a grade or a rank number), and
 * the RES-004 noise is why support-need is a capped 0..1 term, never shown raw.
 *
 * The `priority` band (due/recent/new) is retained for the school-picker dueCount.
 */

const RECENT_DAYS = 21;            // ≤ this since last visit → "recent" band (school dueCount)
const RECENCY_HORIZON_DAYS = 30;   // days-since-visit at which recency-need saturates to 1.0
const SUPPORT_THRESHOLD = 0.6;     // avg score ≤ this (0..1) → flagged "Needs support"
const NEUTRAL_SUPPORT = 0.5;       // no score → neutral support-need (neither privileged nor buried)
const W_SUPPORT = 0.5;
const W_RECENCY = 0.5;
const BAND_RANK = { due: 0, new: 1, recent: 2 };

function daysSince(todayIso, visitIso) {
  return Math.floor((Date.parse(todayIso) - Date.parse(visitIso)) / 86400000);
}

function classify(teacher, todayIso) {
  if (!teacher.lastVisitAt) return 'new';
  return daysSince(todayIso, teacher.lastVisitAt) <= RECENT_DAYS ? 'recent' : 'due';
}

/** Coerce a score to a 0..1 ratio (accepts 0..1 ratios or 0..100 percentages), else null. */
function normScore(score) {
  if (score == null || score === '' || !Number.isFinite(Number(score))) return null;
  const n = Number(score);
  return n > 1 ? Math.max(0, Math.min(1, n / 100)) : Math.max(0, Math.min(1, n));
}

/** 0..1 recency-need: never visited → 1.0 (nobody has checked in); older visit → higher. */
function recencyNeed(teacher, todayIso) {
  if (!teacher.lastVisitAt) return 1;
  const d = Math.max(0, daysSince(todayIso, teacher.lastVisitAt));
  return Math.min(d / RECENCY_HORIZON_DAYS, 1);
}

/** 0..1 support-need: low score → high need; no score → neutral. */
function supportNeed(teacher) {
  const s = normScore(teacher.score);
  return s == null ? NEUTRAL_SUPPORT : 1 - s;
}

function needScore(teacher, todayIso) {
  return W_SUPPORT * supportNeed(teacher) + W_RECENCY * recencyNeed(teacher, todayIso);
}

/**
 * @param {Array<{name?, lastVisitAt?: string|null, score?: number|null, growthAreaKey?: string|null}>} teachers
 * @param {{today?: string}} opts  today = 'YYYY-MM-DD'
 * @returns teachers tagged with `priority`, `needsSupport`, `scoreRatio`, ordered by
 *          combined support-need + recency (highest need first).
 */
function orderTeachers(teachers, opts = {}) {
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const tagged = (teachers || []).map((t) => {
    const scoreRatio = normScore(t.score);
    return {
      ...t,
      priority: classify(t, today),
      scoreRatio,
      needsSupport: scoreRatio != null && scoreRatio <= SUPPORT_THRESHOLD,
      _need: needScore(t, today),
    };
  });

  tagged.sort((a, b) => {
    if (b._need !== a._need) return b._need - a._need;            // highest combined need first
    // tie-break: lower score first (nulls last — unknown need after known), then name.
    const as = a.scoreRatio == null ? Infinity : a.scoreRatio;
    const bs = b.scoreRatio == null ? Infinity : b.scoreRatio;
    if (as !== bs) return as - bs;
    return String(a.name || '').localeCompare(String(b.name || ''));
  });

  return tagged.map(({ _need, ...t }) => t);
}

module.exports = {
  orderTeachers,
  classify,
  needScore,
  recencyNeed,
  supportNeed,
  normScore,
  RECENT_DAYS,
  RECENCY_HORIZON_DAYS,
  SUPPORT_THRESHOLD,
};
