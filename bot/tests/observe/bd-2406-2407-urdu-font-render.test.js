/**
 * bd-2406 / bd-2407 — Urdu renders as tofu boxes on prod (Linux) in the
 * teacher hero report and the coach-the-coach card.
 *
 * Re-diagnosis (the handover's "no @font-face embed" root was STALE — both
 * templates have embedded the base64 Noto Nastaliq @font-face since May, and
 * NIETE prod was running it during the 30-Jul test): the real root is a
 * font-load RACE in shared/utils/html-to-pdf.js. `htmlToImage`/`htmlToPdf`
 * awaited only `document.fonts.ready`, which resolves before a large,
 * lazily-referenced @font-face (the 1.1 MB Nastaliq) is even requested — so
 * the capture fired before the glyphs existed. macOS masked it (CoreText
 * substitutes a system Urdu font); prod Linux has no fallback → tofu.
 *
 * The fix: ensureFontsLoaded() force-loads every declared FontFace before
 * capture. This test proves the embedded Nastaliq font is actually available
 * at capture time.
 *
 * Skips gracefully if Chromium isn't installed (CI without browsers).
 * Created: 2026-07-30
 */
const fs = require('fs');
const path = require('path');

let chromium = null;
try { chromium = require('playwright-core').chromium; } catch (_) { /* no browser */ }

const FONT_DIR = path.join(__dirname, '../../shared/fonts');
const b64 = (f) => fs.readFileSync(path.join(FONT_DIR, f)).toString('base64');

// The exact @font-face + family the templates use (observe-coach-card.js /
// hero-report.template.js). Urdu sample: "درمیان" (between) + a full clause.
function buildUrduHtml() {
  const nastR = b64('NotoNastaliqUrdu-Regular.ttf');
  const nastB = b64('NotoNastaliqUrdu-Bold.ttf');
  return `<!doctype html><html dir="rtl" lang="ur"><head><meta charset="utf-8"><style>
    @font-face{font-family:'NastaliqUrdu';font-weight:400;src:url(data:font/ttf;base64,${nastR})}
    @font-face{font-family:'NastaliqUrdu';font-weight:700;src:url(data:font/ttf;base64,${nastB})}
    body{margin:0}
    .card{width:600px;padding:40px;font-family:'NastaliqUrdu',serif}
    .q{font-weight:700;font-size:22px;line-height:2}
  </style></head><body>
    <div class="card"><p class="q">یہ آپ اور میرے درمیان ہے۔ آپ ہی کوچ ہیں۔ اگلی بار یہ آزمائیں۔</p></div>
  </body></html>`;
}

const maybe = chromium ? describe : describe.skip;

maybe('bd-2406/2407 · embedded Urdu font is loaded before capture', () => {
  jest.setTimeout(60000);
  const { ensureFontsLoaded } = require('../../shared/utils/html-to-pdf');
  let browser;
  beforeAll(async () => { browser = await chromium.launch(); });
  afterAll(async () => { if (browser) await browser.close(); });

  it('ensureFontsLoaded makes NastaliqUrdu available (regular + bold) at capture time', async () => {
    const ctx = await browser.newContext({ viewport: { width: 600, height: 200 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.setContent(buildUrduHtml(), { waitUntil: 'domcontentloaded' });
    await ensureFontsLoaded(page);
    const okRegular = await page.evaluate(() => document.fonts.check('400 22px "NastaliqUrdu"'));
    const okBold = await page.evaluate(() => document.fonts.check('700 22px "NastaliqUrdu"'));
    expect(okRegular).toBe(true);
    expect(okBold).toBe(true);
    await ctx.close();
  });

  it('the Urdu line lays out with the embedded font (measurable width, not zero/tofu-collapsed)', async () => {
    const ctx = await browser.newContext({ viewport: { width: 600, height: 200 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.setContent(buildUrduHtml(), { waitUntil: 'domcontentloaded' });
    await ensureFontsLoaded(page);
    const width = await page.evaluate(() => document.querySelector('.q').getBoundingClientRect().width);
    expect(width).toBeGreaterThan(100);
    await ctx.close();
  });
});
