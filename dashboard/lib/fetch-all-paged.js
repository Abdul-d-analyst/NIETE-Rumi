'use strict';

/**
 * Fetch EVERY row for a Supabase/PostgREST query, paging past the hard
 * 1000-row response cap. Endpoints that scan a whole table (e.g. the
 * curriculum grades picker — 2000+ rows across all grades) MUST page: a
 * single select silently truncates at 1000 and, with no ORDER BY, drops
 * whole groups (grades) non-deterministically.
 *
 * `buildQuery` MUST return a FRESH query builder on every call — Supabase
 * builders are single-use once awaited. `.range(from, to)` is applied here.
 *
 * @param {() => { range: (from: number, to: number) => Promise<{data: any[], error: any}> }} buildQuery
 * @param {number} [pageSize=1000]
 * @returns {Promise<Array>}
 */
async function fetchAllPaged(buildQuery, pageSize = 1000) {
  let all = [];
  let from = 0;
  for (;;) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) throw error;
    const batch = data || [];
    all = all.concat(batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

module.exports = { fetchAllPaged };
