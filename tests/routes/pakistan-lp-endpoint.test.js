/**
 * Pakistan LP Flow endpoint (FEAT-059 + FEAT-109 v2) — asserts the
 * data_exchange handlers return the right dropdown rows per screen.
 *
 * v2 screens: SELECT_GRADE → SELECT_SUBJECT → SELECT_CHAPTER → SELECT_TOPIC → SUCCESS
 * (SPEC was removed in FEAT-109; INIT returns SELECT_GRADE directly.)
 */

// ── minimal supabase mock (mirrors the student-videos test's shape) ─────
function makeSupabase(datasets) {
  const store = JSON.parse(JSON.stringify(datasets));
  function builder(table) {
    let rows = (store[table] || []).slice();
    const api = {
      select() { return api; },
      eq(k, v) { rows = rows.filter(r => String(r[k]) === String(v)); return api; },
      in(k, vs) { rows = rows.filter(r => vs.includes(r[k])); return api; },
      order() { return api; },
      limit() { return api; },
      maybeSingle() { return Promise.resolve({ data: rows[0] || null, error: null }); },
      single() { return Promise.resolve({ data: rows[0] || null, error: rows[0] ? null : { message: 'no rows' } }); },
      insert(payload) {
        const row = { id: `gen-${(store[table] || []).length + 1}`, ...payload };
        store[table] = store[table] || [];
        store[table].push(row);
        return { then: (res) => res({ data: row, error: null }) };
      },
      update() { return { eq() { return Promise.resolve({ data: null, error: null }); } }; },
      then(resolve) { return resolve({ data: rows, error: null }); },
    };
    return api;
  }
  return { from: jest.fn((t) => builder(t)) };
}

const LP_ROWS = [
  { id: 'r-g1-en-ch1', curriculum: 'pakistan', grade: 1, subject: 'English', chapter_number: 1, chapter_title: 'Hello World', pdf_r2_key_en: 'lesson_plans/pakistan/pregen/Rumi_TA_G1_English_Hello_World.pdf', pdf_r2_key_ur: null, is_current: true, generation_status: 'completed' },
  { id: 'r-g1-en-ch2', curriculum: 'pakistan', grade: 1, subject: 'English', chapter_number: 2, chapter_title: 'Five Senses Funland!', pdf_r2_key_en: 'lesson_plans/pakistan/pregen/Rumi_TA_G1_English_Ch2_Five_Senses_Funland.pdf', pdf_r2_key_ur: null, is_current: true, generation_status: 'completed' },
  { id: 'r-g1-math', curriculum: 'pakistan', grade: 1, subject: 'Math', chapter_number: 1, chapter_title: 'Number Buddies (0–9)', pdf_r2_key_en: 'lesson_plans/pakistan/pregen/Rumi_TA_G1_Math_Number_Buddies_0-9.pdf', pdf_r2_key_ur: null, is_current: true, generation_status: 'completed' },
  { id: 'r-g3-en', curriculum: 'pakistan', grade: 3, subject: 'English', chapter_number: 1, chapter_title: 'English — Chapter 1', pdf_r2_key_en: 'lesson_plans/pakistan/pregen/PK_G3_ENG_CH1.pdf', pdf_r2_key_ur: null, is_current: true, generation_status: 'completed' },
  // method-comparison row: MUST NOT appear in any picker screen
  { id: 'r-g6-m1', curriculum: 'pakistan_methods', grade: 6, subject: 'English', chapter_number: 601, chapter_title: 'Chapter 1 — Explicit Instruction', pdf_r2_key_en: 'lesson_plans/pakistan/pregen/method_comparison/PK_G6_ENG_CH1_M1_ExplicitInstruction.pdf', pdf_r2_key_ur: null, is_current: true, generation_status: 'completed' },
  // In-progress row: MUST NOT appear (generation_status != completed)
  { id: 'r-incomplete', curriculum: 'pakistan', grade: 1, subject: 'Urdu', chapter_number: 99, chapter_title: 'X', pdf_r2_key_en: 'x.pdf', pdf_r2_key_ur: null, is_current: true, generation_status: 'pending' },
];

describe('pakistan-lp-endpoint (v2 — FEAT-109)', () => {
  let ep, sendMsgSpy, sendDocByLinkSpy;

  function load(rows = LP_ROWS) {
    jest.resetModules();
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
    const supa = makeSupabase({
      pre_generated_lps: rows,
      users: [{ id: 'u1', phone_number: '15551230000', preferred_language: 'en' }],
    });
    jest.doMock('../../bot/shared/config/supabase', () => supa);
    sendMsgSpy = jest.fn().mockResolvedValue(true);
    sendDocByLinkSpy = jest.fn().mockResolvedValue(true);
    jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
      sendMessage: sendMsgSpy,
      sendDocumentByLink: sendDocByLinkSpy,
      sendVoicenoteFromR2Key: jest.fn().mockResolvedValue(true),
    }));
    jest.doMock('../../bot/shared/storage/r2', () => ({
      buildR2PublicUrl: (k) => `https://r2.example/${k}`,
      getPresignedUrl: async (u) => `${u}?sig=stub`,
    }));
    ep = require('../../bot/shared/routes/pakistan-lp-endpoint');
  }

  it('INIT returns SELECT_GRADE directly (no SPEC in v2)', async () => {
    load();
    const res = await ep.handlePakistanLpInit('u1:pakistan-lp:1');
    expect(res.screen).toBe('SELECT_GRADE');
    expect(res.data.grades.map(g => g.id)).toEqual(['1', '3']);
    // Method-comparison grades must not leak
    expect(res.data.grades.map(g => g.id)).not.toContain('6');
  });

  it('SELECT_GRADE → SELECT_SUBJECT lists distinct subjects for that grade', async () => {
    load();
    const res = await ep.handlePakistanLpDataExchange('u1', 'SELECT_GRADE', { grade: '1' });
    expect(res.screen).toBe('SELECT_SUBJECT');
    expect(res.data.subjects.map(s => s.id).sort()).toEqual(['English', 'Math']);
    expect(res.data.grade_display).toBe('Grade 1');
  });

  it('SELECT_GRADE with no completed rows returns an error', async () => {
    load();
    const res = await ep.handlePakistanLpDataExchange('u1', 'SELECT_GRADE', { grade: '99' });
    expect(res.data.error).toBeDefined();
  });

  it('SELECT_SUBJECT → SELECT_CHAPTER lists chapters sorted by chapter_number', async () => {
    load();
    const res = await ep.handlePakistanLpDataExchange('u1', 'SELECT_SUBJECT', { grade: '1', subject: 'English' });
    expect(res.screen).toBe('SELECT_CHAPTER');
    expect(res.data.chapters).toHaveLength(2);
    expect(res.data.chapters[0].id).toBe('1');
    expect(res.data.chapters[0].title).toMatch(/Hello World/);
    expect(res.data.chapters[1].id).toBe('2');
    expect(res.data.chapters[1].title).toMatch(/Five Senses/);
    expect(res.data.header_text).toBe('Grade 1 — English');
  });

  it('SELECT_CHAPTER → SELECT_TOPIC lists topic options for the chapter', async () => {
    load();
    const res = await ep.handlePakistanLpDataExchange('u1', 'SELECT_CHAPTER', { grade: '1', subject: 'English', chapter: '1' });
    expect(res.screen).toBe('SELECT_TOPIC');
    expect(res.data.topics).toHaveLength(1);
    // Single-row chapter yields synthetic "Full Chapter Lesson Plan" title
    expect(res.data.topics[0].title).toBe('Full Chapter Lesson Plan');
    expect(res.data.topics[0].id).toBe('r-g1-en-ch1');
    expect(res.data.chapter_value).toBe('1');
    expect(res.data.header_text).toMatch(/Grade 1 English · Ch 1: Hello World/);
  });

  it('SELECT_TOPIC returns SUCCESS + queues async delivery via sendDocumentByLink', async () => {
    load();
    const res = await ep.handlePakistanLpDataExchange(
      'u1:pakistan-lp:1', 'SELECT_TOPIC', { grade: '1', subject: 'English', chapter: '1', topic: 'r-g1-en-ch1' }
    );
    expect(res.screen).toBe('SUCCESS');
    expect(res.data.message).toMatch(/on its way/);
    // Pre-delivery ack fires
    await new Promise(r => setImmediate(r));
    expect(sendMsgSpy).toHaveBeenCalled();
    // Async delivery uses sendDocumentByLink (Palestine pattern), NOT sendDocument(path)
    await new Promise(r => setImmediate(r));
    await new Promise(r => setTimeout(r, 20));
    expect(sendDocByLinkSpy).toHaveBeenCalled();
    const [phone, url, filename] = sendDocByLinkSpy.mock.calls[0];
    expect(phone).toBe('15551230000');
    expect(url).toContain('r2.example');
    expect(url).toContain('sig=stub');
    expect(filename).toMatch(/Hello World/);
  });

  it('SELECT_TOPIC rejects an unknown row id', async () => {
    load();
    const res = await ep.handlePakistanLpDataExchange(
      'u1', 'SELECT_TOPIC', { grade: '1', subject: 'English', chapter: '1', topic: 'nope-nope' }
    );
    expect(res.data.error).toBeDefined();
  });

  it('SELECT_TOPIC rejects a request missing topic id', async () => {
    load();
    const res = await ep.handlePakistanLpDataExchange(
      'u1', 'SELECT_TOPIC', { grade: '1', subject: 'English', chapter: '1' } // no topic
    );
    expect(res.data.error).toBeDefined();
  });

  it('CURRICULUM_TAG is "pakistan" — never leaks the methods corpus', async () => {
    load();
    expect(ep.CURRICULUM_TAG).toBe('pakistan');
  });
});
