/**
 * OPS-115 — TRAINING_HOME "Something went wrong" on Flow open.
 *
 * The published Flow renders 5 fixed level slots. A teacher enrolled in a
 * 4-level program leaves slot 5 unused, so buildTrainingHome fills it from
 * ghostSlotData(5). That ghost returned `progress: ''`.
 *
 * WhatsApp Flows reject an EMPTY STRING bound to a TextBody/TextHeading
 * `text` property — the `visible: false` binding does NOT exempt the field
 * from validation, because the client validates the whole data payload
 * against the screen's declared schema BEFORE evaluating visibility. The
 * result is a client-side render failure: the teacher sees "Something went
 * wrong. Please try again later." and the client immediately re-POSTs INIT
 * with `{error, error_message}` — the exact pair seen in production logs for
 * every single /training open.
 *
 * The same file already knows this rule: loadGrandQuizState returns
 * `caption: ' '` / `cta: ' '` (a SPACE, not empty) for the no-quiz case.
 * ghostSlotData just missed it.
 *
 * Contract: every string a ghost slot contributes to the TRAINING_HOME data
 * payload must be non-empty, so the payload always satisfies the Flow schema.
 */

let ghostSlotData;

beforeAll(() => {
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
  jest.doMock('../../bot/shared/utils/structured-logger', () => ({
    trainingLogger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    logEvent: jest.fn(),
  }));
  jest.doMock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
  jest.doMock('../../bot/shared/services/whatsapp.service', () => ({}));
  jest.doMock('../../bot/shared/storage/r2', () => ({}));
  ({ ghostSlotData } = require('../../bot/shared/routes/teacher-training-endpoint'));
});

describe('ghostSlotData — no empty strings reach the Flow payload', () => {
  test.each([1, 2, 3, 4, 5])('slot %i emits a non-empty progress string', (slot) => {
    const ghost = ghostSlotData(slot);
    expect(typeof ghost.progress).toBe('string');
    expect(ghost.progress.length).toBeGreaterThan(0);
  });

  test.each([1, 2, 3, 4, 5])('slot %i emits a non-empty title string', (slot) => {
    const ghost = ghostSlotData(slot);
    expect(typeof ghost.title).toBe('string');
    expect(ghost.title.length).toBeGreaterThan(0);
  });

  test('ghost slots stay hidden', () => {
    expect(ghostSlotData(5).visible).toBe(false);
  });
});
