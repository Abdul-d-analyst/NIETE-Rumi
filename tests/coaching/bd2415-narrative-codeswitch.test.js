/**
 * bd-2415 (FEAT-106 row 15) — the Urdu hero report translated pedagogical /
 * section terms literally ("Warm Questions" → "واضح گرم سوالات", "Classroom" →
 * "جماعتی پڑھائی"). These concept names must stay in English. Two levers:
 *  (1) the narrative prompt (keep pedagogical concept NAMES in English), and
 *  (2) a deterministic normalizer safety net for the observed literal forms.
 */

const fs = require('fs');
const path = require('path');
jest.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }), { virtual: true });
jest.mock('../../bot/shared/config/supabase', () => ({ from: () => ({}) }), { virtual: true });
const { fixCodeswitch } = require('../../bot/shared/services/coaching/report-v2/narrative.service');

describe('bd-2415 — fixCodeswitch normalizer covers the observed literal translations', () => {
  it('maps جماعتی پڑھائی → classroom', () => {
    expect(fixCodeswitch('اگلی جماعتی پڑھائی میں').toLowerCase()).toContain('classroom');
  });
  it('maps گرم سوالات → warm questions', () => {
    expect(fixCodeswitch('آپ کے گرم سوالات').toLowerCase()).toContain('warm questions');
  });
  it('leaves clean Urdu untouched', () => {
    const s = 'آپ نے بچوں کو اچھی طرح سمجھایا۔';
    expect(fixCodeswitch(s)).toBe(s);
  });
});

describe('bd-2415 — narrative prompt keeps pedagogical concept names in English (source guard)', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../../bot/shared/services/coaching/report-v2/narrative.service.js'),
    'utf8',
  );
  it('instructs strength_name / horizon_title to keep the concept in English', () => {
    // The Urdu rules must name strength_name/horizon_title and say keep the term English.
    expect(src).toMatch(/strength_name/);
    expect(src.toLowerCase()).toMatch(/keep .*english|in english/);
  });
  it('gives the row-15 concrete examples (Warm Questions / Classroom)', () => {
    expect(src).toMatch(/Warm Questions/);
    expect(src).toMatch(/Classroom/);
  });
});
