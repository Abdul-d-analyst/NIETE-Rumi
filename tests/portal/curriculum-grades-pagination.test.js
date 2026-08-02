/**
 * The Curriculum grades picker scans the WHOLE enabled curriculum_lp_ast
 * corpus (2000+ rows across grades 0-12) and dedupes grades in JS. PostgREST
 * hard-caps a single response at 1000 rows, so an un-paged select silently
 * truncates and — with no ORDER BY — drops whole grades non-deterministically.
 * That is why the secondary grades (6-12) never appeared in the picker even
 * after their rows were loaded and enabled.
 *
 * Contract: fetchAllPaged() must page past the 1000-row cap and return every
 * row, so the deduped grade list covers the full 0-12 span.
 */

const { fetchAllPaged } = require('../../dashboard/lib/fetch-all-paged');

// A 2,485-row corpus spanning grades 0-12; every grade 6-12 row sits AFTER
// row 1000, exactly like production (grade 0-5 fills the first page).
function makeCorpus() {
  const dist = { 0: 800, 1: 400, 2: 300, 3: 300, 4: 300, 5: 255, 6: 4, 7: 12, 8: 11, 9: 16, 10: 5, 11: 12, 12: 10 };
  const rows = [];
  for (const [g, n] of Object.entries(dist)) {
    for (let i = 0; i < n; i++) rows.push({ grade: Number(g), grade_label: 'Grade ' + g });
  }
  return rows;
}

// Fake Supabase builder honouring PostgREST's 1000-row page cap on .range().
function fakeBuilder(corpus) {
  return {
    range: (from, to) => {
      const CAP = 1000;
      const end = Math.min(to, from + CAP - 1);
      return Promise.resolve({ data: corpus.slice(from, end + 1), error: null });
    },
  };
}

describe('curriculum/grades pagination', () => {
  test('a single un-paged read truncates at 1000 and drops high grades (the bug)', async () => {
    const corpus = makeCorpus();
    const { data } = await fakeBuilder(corpus).range(0, 99999); // asks for all; capped at 1000
    expect(data.length).toBe(1000);
    const grades = new Set(data.map((r) => r.grade));
    expect(grades.has(12)).toBe(false); // grade 12 silently missing
  });

  test('fetchAllPaged pages past the cap and returns every grade 0-12', async () => {
    const corpus = makeCorpus();
    const all = await fetchAllPaged(() => fakeBuilder(corpus));
    expect(all.length).toBe(corpus.length); // 2485 — nothing dropped
    const grades = [...new Set(all.map((r) => r.grade))].sort((a, b) => a - b);
    expect(grades).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  test('fetchAllPaged stops cleanly on a short final page', async () => {
    const small = [{ grade: 6 }, { grade: 7 }];
    const all = await fetchAllPaged(() => fakeBuilder(small));
    expect(all.length).toBe(2);
  });
});
