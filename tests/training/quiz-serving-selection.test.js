/**
 * Quiz SERVING selection — the pure decision layer.
 *
 * Three serving changes, all driven by training_vendors config so a second or
 * third content vendor can be switched by data rather than a deploy:
 *
 *   1. module_quiz_strategy='one_per_bloom' — serve ONE question per distinct
 *      bloom_level present on the module, with a FLOOR of 2 (a module whose
 *      questions all share one level still gets 2, topped up from the level
 *      with the most spare questions).
 *   2. exam_question_cap=N — a level exam serves at most N questions, chosen
 *      at random per attempt. NULL = serve everything (today's behaviour).
 *   3. shuffle_options — MCQ option ORDER is permuted per (attempt, question),
 *      so a re-sit does not present the same lettering.
 *
 * All three are DETERMINISTIC in the attempt id: nothing about which questions
 * were served, or in which order the options appeared, is stored anywhere, so
 * the selection has to be reproducible from the attempt row alone. Resume,
 * re-render after a multi-select tap, and grading all re-derive it
 * independently and must agree.
 *
 * The option permutation is canonical-index preserving: `chosen_option` is
 * always persisted as the DB's own 1-based option index, keeping the 400k+
 * historical answer rows and every existing grading path valid.
 */

const {
  selectServedQuestions,
  buildOptionDisplayOrder,
  normalizeServingConfig,
  DEFAULT_SERVING_CONFIG,
  MIN_SERVED_QUESTIONS,
} = require('../../bot/shared/services/training/quiz-serving.service');

const ATTEMPT_A = '11111111-2222-3333-4444-555555555555';
const ATTEMPT_B = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function q(id, bloom, orderIndex) {
  return { id, bloom_level: bloom, order_index: orderIndex ?? id };
}

/** A module shaped like the real NIETE median: 9 questions, 3 Bloom levels. */
function moduleBank() {
  return [
    q(1, 'remember', 1), q(2, 'remember', 2), q(3, 'remember', 3),
    q(4, 'understand', 4), q(5, 'understand', 5), q(6, 'understand', 6),
    q(7, 'apply', 7), q(8, 'apply', 8), q(9, 'apply', 9),
  ];
}

const ONE_PER_BLOOM = { ...DEFAULT_SERVING_CONFIG, module_quiz_strategy: 'one_per_bloom' };

describe('module quiz — one question per Bloom level', () => {
  test('serves exactly one question per distinct bloom_level', () => {
    const served = selectServedQuestions(moduleBank(), {
      attemptId: ATTEMPT_A, isModuleQuiz: true, config: ONE_PER_BLOOM,
    });
    expect(served).toHaveLength(3);
    expect(new Set(served.map(x => x.bloom_level))).toEqual(new Set(['remember', 'understand', 'apply']));
  });

  test('served questions stay in order_index order (natural progression)', () => {
    const served = selectServedQuestions(moduleBank(), {
      attemptId: ATTEMPT_A, isModuleQuiz: true, config: ONE_PER_BLOOM,
    });
    const idx = served.map(x => x.order_index);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  });

  test('FLOOR of 2 — a single-Bloom module still serves 2, topped up from the fullest level', () => {
    const bank = [q(1, 'apply', 1), q(2, 'apply', 2), q(3, 'apply', 3), q(4, 'apply', 4)];
    const served = selectServedQuestions(bank, {
      attemptId: ATTEMPT_A, isModuleQuiz: true, config: ONE_PER_BLOOM,
    });
    expect(served).toHaveLength(MIN_SERVED_QUESTIONS);
    expect(new Set(served.map(x => x.id)).size).toBe(2); // no duplicate question
  });

  test('a module with fewer questions than the floor serves everything it has', () => {
    const bank = [q(1, 'apply', 1)];
    const served = selectServedQuestions(bank, {
      attemptId: ATTEMPT_A, isModuleQuiz: true, config: ONE_PER_BLOOM,
    });
    expect(served.map(x => x.id)).toEqual([1]);
  });

  test('null / blank bloom_level is its own bucket, never dropped', () => {
    const bank = [q(1, null, 1), q(2, null, 2), q(3, 'apply', 3)];
    const served = selectServedQuestions(bank, {
      attemptId: ATTEMPT_A, isModuleQuiz: true, config: ONE_PER_BLOOM,
    });
    expect(served).toHaveLength(2);
    expect(served.some(x => !x.bloom_level)).toBe(true);
    expect(served.some(x => x.bloom_level === 'apply')).toBe(true);
  });

  test('the two Bloom taxonomies are NOT merged — affective levels count as levels', () => {
    const bank = [
      q(1, 'remember', 1), q(2, 'receiving', 2), q(3, 'responding', 3), q(4, 'valuing', 4),
    ];
    const served = selectServedQuestions(bank, {
      attemptId: ATTEMPT_A, isModuleQuiz: true, config: ONE_PER_BLOOM,
    });
    expect(served).toHaveLength(4);
  });

  test("strategy 'all' (today's behaviour for other vendors) serves the whole bank", () => {
    const served = selectServedQuestions(moduleBank(), {
      attemptId: ATTEMPT_A, isModuleQuiz: true, config: DEFAULT_SERVING_CONFIG,
    });
    expect(served).toHaveLength(9);
  });
});

describe('grand quiz — random cap', () => {
  const examBank = () => Array.from({ length: 72 }, (_, i) => q(i + 1, 'apply', i + 1));

  test('caps the exam at the configured number of questions', () => {
    const served = selectServedQuestions(examBank(), {
      attemptId: ATTEMPT_A, isModuleQuiz: false,
      config: { ...DEFAULT_SERVING_CONFIG, exam_question_cap: 20 },
    });
    expect(served).toHaveLength(20);
    expect(new Set(served.map(x => x.id)).size).toBe(20);
  });

  test('a null cap serves every question, in the original order', () => {
    const bank = examBank();
    const served = selectServedQuestions(bank, {
      attemptId: ATTEMPT_A, isModuleQuiz: false, config: DEFAULT_SERVING_CONFIG,
    });
    expect(served.map(x => x.id)).toEqual(bank.map(x => x.id));
  });

  test('a cap larger than the bank leaves the bank untouched and unshuffled', () => {
    const bank = examBank().slice(0, 12);
    const served = selectServedQuestions(bank, {
      attemptId: ATTEMPT_A, isModuleQuiz: false,
      config: { ...DEFAULT_SERVING_CONFIG, exam_question_cap: 20 },
    });
    expect(served.map(x => x.id)).toEqual(bank.map(x => x.id));
  });

  test('the capped subset is presented in order_index order', () => {
    const served = selectServedQuestions(examBank(), {
      attemptId: ATTEMPT_A, isModuleQuiz: false,
      config: { ...DEFAULT_SERVING_CONFIG, exam_question_cap: 20 },
    });
    const idx = served.map(x => x.order_index);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  });

  test('different attempts get different exams', () => {
    const a = selectServedQuestions(examBank(), {
      attemptId: ATTEMPT_A, isModuleQuiz: false,
      config: { ...DEFAULT_SERVING_CONFIG, exam_question_cap: 20 },
    });
    const b = selectServedQuestions(examBank(), {
      attemptId: ATTEMPT_B, isModuleQuiz: false,
      config: { ...DEFAULT_SERVING_CONFIG, exam_question_cap: 20 },
    });
    expect(a.map(x => x.id)).not.toEqual(b.map(x => x.id));
  });
});

describe('determinism — the whole design rests on it', () => {
  test('the same attempt id reproduces the identical module selection', () => {
    const one = selectServedQuestions(moduleBank(), {
      attemptId: ATTEMPT_A, isModuleQuiz: true, config: ONE_PER_BLOOM,
    });
    const two = selectServedQuestions(moduleBank(), {
      attemptId: ATTEMPT_A, isModuleQuiz: true, config: ONE_PER_BLOOM,
    });
    expect(two.map(x => x.id)).toEqual(one.map(x => x.id));
  });

  test('the same attempt id reproduces the identical exam selection', () => {
    const bank = () => Array.from({ length: 72 }, (_, i) => q(i + 1, 'apply', i + 1));
    const cfg = { ...DEFAULT_SERVING_CONFIG, exam_question_cap: 20 };
    const one = selectServedQuestions(bank(), { attemptId: ATTEMPT_A, isModuleQuiz: false, config: cfg });
    const two = selectServedQuestions(bank(), { attemptId: ATTEMPT_A, isModuleQuiz: false, config: cfg });
    expect(two.map(x => x.id)).toEqual(one.map(x => x.id));
  });

  test('a different attempt id generally picks a different module question', () => {
    const seen = new Set();
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      seen.add(selectServedQuestions(moduleBank(), {
        attemptId: id, isModuleQuiz: true, config: ONE_PER_BLOOM,
      }).map(x => x.id).join(','));
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('option order — display permutation with canonical indices', () => {
  const SHUFFLE = { ...DEFAULT_SERVING_CONFIG, shuffle_options: true };

  test('shuffle off ⇒ identity order (unchanged for vendors that opt out)', () => {
    const order = buildOptionDisplayOrder({
      optionCount: 4, correctOption: '2', cap: 10,
      attemptId: ATTEMPT_A, questionId: 900, shuffle: false,
    });
    expect(order).toEqual([1, 2, 3, 4]);
  });

  test('shuffle on ⇒ a permutation of the same canonical indices', () => {
    const order = buildOptionDisplayOrder({
      optionCount: 4, correctOption: '2', cap: 10,
      attemptId: ATTEMPT_A, questionId: 900, shuffle: true,
    });
    expect([...order].sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
  });

  test('the permutation actually reorders something across questions', () => {
    const orders = [900, 901, 902, 903, 904, 905].map(qid => buildOptionDisplayOrder({
      optionCount: 4, correctOption: '1', cap: 10,
      attemptId: ATTEMPT_A, questionId: qid, shuffle: true,
    }).join(','));
    expect(new Set(orders).size).toBeGreaterThan(1);
    expect(orders.some(o => o !== '1,2,3,4')).toBe(true);
  });

  test('same (attempt, question) ⇒ identical permutation on every re-render', () => {
    const args = {
      optionCount: 6, correctOption: '3', cap: 10,
      attemptId: ATTEMPT_A, questionId: 900, shuffle: true,
    };
    expect(buildOptionDisplayOrder(args)).toEqual(buildOptionDisplayOrder(args));
  });

  test('a different attempt permutes the same question differently', () => {
    const base = { optionCount: 6, correctOption: '3', cap: 10, questionId: 900, shuffle: true };
    const a = buildOptionDisplayOrder({ ...base, attemptId: ATTEMPT_A });
    const b = buildOptionDisplayOrder({ ...base, attemptId: ATTEMPT_B });
    expect(a).not.toEqual(b);
  });

  test('the option cap keeps the first N canonical options when the key is inside them', () => {
    const order = buildOptionDisplayOrder({
      optionCount: 12, correctOption: '3', cap: 10,
      attemptId: ATTEMPT_A, questionId: 900, shuffle: false,
    });
    expect(order).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  test('the correct option is NEVER dropped by the cap — it is swapped in', () => {
    const order = buildOptionDisplayOrder({
      optionCount: 12, correctOption: '12', cap: 10,
      attemptId: ATTEMPT_A, questionId: 900, shuffle: true,
    });
    expect(order).toHaveLength(10);
    expect(order).toContain(12);
  });

  test('every member of a multi-answer key survives the cap', () => {
    const order = buildOptionDisplayOrder({
      optionCount: 14, correctOption: '1,11,13', cap: 10,
      attemptId: ATTEMPT_A, questionId: 900, shuffle: true,
    });
    expect(order).toHaveLength(10);
    for (const need of [1, 11, 13]) expect(order).toContain(need);
  });

  test('an empty / missing correct key does not crash the cap logic', () => {
    const order = buildOptionDisplayOrder({
      optionCount: 12, correctOption: '', cap: 10,
      attemptId: ATTEMPT_A, questionId: 900, shuffle: false,
    });
    expect(order).toHaveLength(10);
  });
});

describe('serving config normalisation — fail-open to today behaviour', () => {
  test('a missing vendor row yields the safe defaults', () => {
    expect(normalizeServingConfig(null)).toEqual(DEFAULT_SERVING_CONFIG);
    expect(DEFAULT_SERVING_CONFIG).toEqual({
      module_quiz_strategy: 'all', exam_question_cap: null, shuffle_options: false,
    });
  });

  test('a vendor row without the new columns yields the safe defaults', () => {
    expect(normalizeServingConfig({ key: 'BEACONHOUSE', passing_pct: 70 })).toEqual(DEFAULT_SERVING_CONFIG);
  });

  test('an unknown strategy string falls back to "all" rather than serving nothing', () => {
    expect(normalizeServingConfig({ module_quiz_strategy: 'per_topic' }).module_quiz_strategy).toBe('all');
  });

  test('a nonsense cap is ignored', () => {
    expect(normalizeServingConfig({ exam_question_cap: 0 }).exam_question_cap).toBeNull();
    expect(normalizeServingConfig({ exam_question_cap: -3 }).exam_question_cap).toBeNull();
    expect(normalizeServingConfig({ exam_question_cap: 'twenty' }).exam_question_cap).toBeNull();
  });

  test('real config is read through', () => {
    expect(normalizeServingConfig({
      module_quiz_strategy: 'one_per_bloom', exam_question_cap: 20, shuffle_options: true,
    })).toEqual({
      module_quiz_strategy: 'one_per_bloom', exam_question_cap: 20, shuffle_options: true,
    });
  });
});
