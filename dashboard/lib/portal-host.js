/**
 * bd-2467 — is this request addressed to the PORTAL hostname?
 *
 * Mirrors the frontend rule in `portal/src/lib/app-target.cjs`
 * (`resolveIsPortal`): a `portal.` subdomain serves the portal, anchored so a
 * host that merely contains "portal." (myportal.example.com) does not match.
 * The two must stay in agreement — the server uses this to decide whether "/"
 * belongs to the SPA (which then renders PortalRoot) or should be redirected
 * to the NIETE marketing site, and the SPA uses its copy to decide what "/"
 * renders. Disagreement shows a teacher the upstream Rumi splash.
 *
 * Kept as its own tiny module so the rule is unit-testable without booting the
 * Express app.
 */

/**
 * @param {{hostname?: string}} req  an Express request (or any {hostname})
 * @returns {boolean}
 */
function isPortalHost(req) {
  const host = (req && typeof req.hostname === 'string' ? req.hostname : '').toLowerCase();
  return host.startsWith('portal.');
}

module.exports = { isPortalHost };
