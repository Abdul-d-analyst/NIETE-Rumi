/**
 * bd-2458 — the observability/admin dashboard must carry the NIETE brand
 * (wrt. book V.2), not the parent Rumi brand it shipped with: navy-slate
 * #333748 + green #47BA7D tokens, the NIETE app-icon logo, NIETE strings.
 * File-level assertions so this runs with no server and pins the BUILT css
 * (main.css is committed; a token change without `npm run build:css` fails here).
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const VIEWS = fs.readdirSync(path.join(root, 'views')).filter((f) => f.endsWith('.ejs'))
  .map((f) => `views/${f}`)
  .concat(fs.readdirSync(path.join(root, 'views', 'partials')).filter((f) => f.endsWith('.ejs'))
    .map((f) => `views/partials/${f}`));

describe('NIETE brand — observability dashboard (bd-2458)', () => {
  test('design tokens are NIETE navy-slate + green in input.css AND the built main.css', () => {
    for (const f of ['public/css/input.css', 'public/css/main.css']) {
      const css = read(f);
      expect(css).toContain('229 17% 24%');   // navy-slate #333748
      expect(css).toContain('146 44% 51%');   // green #47BA7D
      expect(css).not.toContain('225 73% 20%'); // Rumi navy
      expect(css).not.toContain('15 85% 60%');  // Rumi coral
    }
  });

  test('no view references rumi-logo.png; the NIETE app-icon logo exists', () => {
    for (const v of VIEWS) {
      expect({ view: v, hasRumiLogo: read(v).includes('rumi-logo.png') })
        .toEqual({ view: v, hasRumiLogo: false });
    }
    const png = fs.readFileSync(path.join(root, 'public/images/niete-logo.png'));
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect(png.includes(Buffer.from('niete-app-icon-v1'))).toBe(true);
  });

  test('no view says "Rumi Observability"; layout + login titles are NIETE', () => {
    for (const v of VIEWS) {
      expect({ view: v, rumiObs: /rumi observability/i.test(read(v)) })
        .toEqual({ view: v, rumiObs: false });
    }
    expect(read('views/layout.ejs')).toContain('NIETE Observability Portal');
    expect(read('views/login.ejs')).toContain('NIETE Observability Portal');
  });

  test('the transcript pages carry the NIETE navy, not Rumi #001F3F', () => {
    for (const v of ['views/transcript-enhanced.ejs', 'views/loading-transcript.ejs']) {
      const s = read(v);
      expect({ view: v, rumiNavy: /#001F3F/i.test(s) }).toEqual({ view: v, rumiNavy: false });
    }
    expect(read('views/transcript-enhanced.ejs')).toContain('#333748');
  });
});
