/**
 * bd-2452 — NIETE-branded FICO hero report.
 *
 * The hero report template shipped with NIETE logo assets but the full Rumi
 * navy/gold palette (#0c1a4e / #1b2f7a / #f5b301). For the NIETE deployment
 * the FICO report must carry the NIETE brand: Green #47BA7D + Navy Slate
 * #333748 (source: niete-brand skill, reconciled 2026-08-01 against the
 * official wrt. brand book — the book navy supersedes the portal charcoal).
 *
 * Contract under test:
 *   1. renderer-registry routes `fico` through a hero renderer that injects
 *      `opts.brand = 'niete'`.
 *   2. buildHeroReportHtml({ brand:'niete' }) emits the NIETE palette
 *      (#47BA7D + #333748), the NIETE ondark mark, and ZERO Rumi navy.
 *   3. Without a brand, the template still renders the original Rumi palette
 *      (other frameworks / upstream behaviour unchanged).
 *
 * Red-first: fails on main (template has no brand concept; registry passes
 * no brand for fico).
 */

const fs = require('fs');
const path = require('path');

const { buildHeroReportHtml } = require('../../shared/services/coaching/report-v2/hero-report.template');

const RUMI_NAVY_DEEP = '#0c1a4e';
const RUMI_NAVY_MID = '#1b2f7a';
const RUMI_GOLD = '#f5b301';
const NIETE_GREEN = '#47ba7d';
// Official brand book (wrt. "Brand Identity Design" V.2, p6): the dark is
// navy-slate #333748 — NOT the portal's neutral charcoal #32373C (portal CSS
// drift, flagged in the niete-brand skill). Designed artifacts use the book navy.
const NIETE_NAVY_SLATE = '#333748';

function ficoVm(extra = {}) {
  return {
    language: 'ur',
    teacherName: 'Sadia Tabassum',
    topic: 'Fractions',
    date: '2026-08-01',
    score: { overall: 75, marks: 111, max: 148 },
    groups: [
      { key: 'B', name: 'Lesson Plan Fidelity', score: 31, max: 40, pct: 78 },
      { key: 'C', name: 'High-Leverage Practices', score: 34, max: 48, pct: 71 },
      { key: 'D', name: 'Student Engagement', score: 22, max: 28, pct: 79 },
      { key: 'F', name: 'Teacher Subject Knowledge', score: 24, max: 32, pct: 75 },
    ],
    narrative: {
      affirmation: 'آپ کی کلاس میں سوالوں کی گونج تھی',
      strength_name: 'Wait time',
      strength_note: 'note',
      horizon_title: 'Cold call',
      horizon_note: 'note',
      moments: [{ quote: 'بہت خوب', why: 'why' }],
    },
    tryNext: 'ایک بات آزمائیں',
    trend: [
      { date: '2026-07-10', pct: 62 },
      { date: '2026-07-24', pct: 75 },
    ],
    photoB64: '',
    ...extra,
  };
}

describe('bd-2452 · NIETE-branded FICO hero report', () => {
  describe('template — brand: niete', () => {
    const html = buildHeroReportHtml(ficoVm({ brand: 'niete' })).toLowerCase();

    it('emits NIETE Green #47BA7D', () => {
      expect(html).toContain(NIETE_GREEN);
    });

    it('emits NIETE Navy Slate #333748 (official book dark)', () => {
      expect(html).toContain(NIETE_NAVY_SLATE);
    });

    it('contains NO Rumi navy/gold tokens', () => {
      expect(html).not.toContain(RUMI_NAVY_DEEP);
      expect(html).not.toContain(RUMI_NAVY_MID);
      expect(html).not.toContain(RUMI_GOLD);
    });

    it('embeds the NIETE ondark mark (hero header) and onlight mark (footer)', () => {
      const asset = (f) =>
        fs.readFileSync(path.join(__dirname, '../../shared/assets', f)).toString('base64').toLowerCase();
      expect(html).toContain(asset('niete-mark-ondark.png').slice(0, 200));
      expect(html).toContain(asset('niete-mark-onlight.png').slice(0, 200));
    });
  });

  describe('template — no brand (default) stays Rumi-palette (upstream unchanged)', () => {
    it('renders the original navy palette and no NIETE charcoal', () => {
      const html = buildHeroReportHtml(ficoVm({ brand: undefined, language: 'en' })).toLowerCase();
      expect(html).toContain(RUMI_NAVY_DEEP);
      expect(html).not.toContain(NIETE_NAVY_SLATE);
    });
  });

  describe('renderer-registry — fico injects brand: niete', () => {
    beforeEach(() => {
      jest.resetModules();
    });

    it('passes opts.brand="niete" into generateHeroReport for framework fico', async () => {
      const generateHeroReport = jest.fn().mockResolvedValue({ png: Buffer.from('x'), caption: 'c' });
      jest.doMock('../../shared/services/coaching/report-v2/hero-report.service', () => ({ generateHeroReport }));
      const { getReportRenderer } = require('../../shared/services/coaching/report-renderers/renderer-registry');

      const input = { session: { id: 's1' }, analysis: { framework: 'fico' }, opts: { teacherName: 'T' } };
      await getReportRenderer('fico').render(input);

      expect(generateHeroReport).toHaveBeenCalledTimes(1);
      const opts = generateHeroReport.mock.calls[0][2];
      expect(opts.brand).toBe('niete');
      expect(opts.teacherName).toBe('T'); // caller opts preserved
    });

    it('does NOT inject a brand for other frameworks (oecd)', async () => {
      const generateHeroReport = jest.fn().mockResolvedValue({ png: Buffer.from('x'), caption: 'c' });
      jest.doMock('../../shared/services/coaching/report-v2/hero-report.service', () => ({ generateHeroReport }));
      const { getReportRenderer } = require('../../shared/services/coaching/report-renderers/renderer-registry');

      await getReportRenderer('oecd').render({ session: {}, analysis: { framework: 'oecd' }, opts: {} });

      const opts = generateHeroReport.mock.calls[0][2];
      expect(opts.brand).toBeUndefined();
    });
  });

  describe('hero service — vm carries the brand through to the rendered HTML', () => {
    it('generateHeroReport(opts.brand="niete") hands NIETE-palette HTML to htmlToImage', async () => {
      jest.resetModules();
      jest.doMock('../../shared/services/coaching/report-v2/narrative.service', () => ({
        generateReportNarrative: jest.fn().mockResolvedValue({ affirmation: 'a' }),
      }));
      jest.doMock('../../shared/services/coaching/coaching-trend.service', () => ({
        loadTrendData: jest.fn().mockResolvedValue([]),
      }));
      const htmlToImage = jest.fn().mockResolvedValue(Buffer.from('png'));
      jest.doMock('../../shared/utils/html-to-pdf', () => ({ htmlToImage }));
      // requireActual: the registry tests above doMock'd this module, and doMock
      // registrations persist for the whole test file.
      const { generateHeroReport } = jest.requireActual('../../shared/services/coaching/report-v2/hero-report.service');

      await generateHeroReport(
        { id: 's1', user_id: 'u1', created_at: '2026-08-01', transcript_text: 't' },
        { framework: 'fico', scores: { overall_percentage: 75 } },
        { teacherName: 'Sadia', brand: 'niete' }
      );

      expect(htmlToImage).toHaveBeenCalledTimes(1);
      const html = String(htmlToImage.mock.calls[0][0]).toLowerCase();
      expect(html).toContain(NIETE_GREEN);
      expect(html).toContain(NIETE_NAVY_SLATE);
      expect(html).not.toContain(RUMI_NAVY_DEEP);
    });
  });
});
