/**
 * bd-2467 — "/" on the portal hostname must reach the portal, not the
 * marketing site.
 *
 * The NIETE fork redirects "/" to niete.edu.pk so the bare Railway URL doesn't
 * show the upstream Rumi marketing splash. Once portal.niete.edu.pk went live
 * that redirect fired there too, so teachers opening the portal domain landed
 * back on the marketing site. The SPA already handles this case — App.tsx
 * routes "/" to PortalRoot (session-aware) whenever the hostname starts with
 * "portal." — so the server just has to stop preempting it.
 *
 * isPortalHost mirrors the frontend rule in portal/src/lib/app-target.cjs
 * (`hostname.startsWith('portal.')`, anchored). The two must agree: if the
 * server passes "/" through on a host the SPA does NOT consider a portal host,
 * the user gets the Rumi splash — the exact thing the redirect exists to avoid.
 */

const { isPortalHost } = require('../lib/portal-host');

describe('isPortalHost (bd-2467)', () => {
  it('is true for the live portal hostname', () => {
    expect(isPortalHost({ hostname: 'portal.niete.edu.pk' })).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isPortalHost({ hostname: 'PORTAL.NIETE.EDU.PK' })).toBe(true);
  });

  it('is false for the bare Railway URL (marketing redirect still wanted there)', () => {
    expect(isPortalHost({ hostname: 'portal-production-6a508.up.railway.app' })).toBe(false);
  });

  it('is anchored — a host merely containing "portal." does not match', () => {
    expect(isPortalHost({ hostname: 'myportal.example.com' })).toBe(false);
    expect(isPortalHost({ hostname: 'niete.edu.pk' })).toBe(false);
  });

  it('never throws on a missing/odd host', () => {
    expect(isPortalHost({})).toBe(false);
    expect(isPortalHost({ hostname: '' })).toBe(false);
    expect(isPortalHost(undefined)).toBe(false);
  });

  it('matches the frontend rule in app-target.cjs (single source of truth)', () => {
    const { resolveIsPortal } = require('../../portal/src/lib/app-target.cjs');
    for (const h of ['portal.niete.edu.pk', 'myportal.example.com', 'niete.edu.pk',
                     'portal-production-6a508.up.railway.app']) {
      expect({ host: h, server: isPortalHost({ hostname: h }) })
        .toEqual({ host: h, server: resolveIsPortal({ hostname: h }) });
    }
  });
});

describe('the "/" route wiring (bd-2467)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.js'), 'utf8');

  it('index.js uses isPortalHost to skip the marketing redirect on "/"', () => {
    expect(src).toMatch(/isPortalHost/);
  });

  it('"/" is no longer an unconditional redirect to the marketing site', () => {
    // the old shape: for (const p of ['/', '/how-it-works']) { ...res.redirect(302, NIETE_MARKETING_REDIRECT) }
    expect(src).not.toMatch(/for \(const p of \['\/', '\/how-it-works'\]\) \{\s*app\.get\(p, \(req, res\) => res\.redirect/);
  });
});
