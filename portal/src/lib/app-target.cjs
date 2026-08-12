/**
 * Where am I running, and where is the API?
 *
 * The portal SPA serves two audiences from one build: the public marketing
 * site and the authenticated teacher/coach portal. On the web it tells them
 * apart by hostname. Inside a Capacitor Android app that breaks — the WebView
 * serves the bundle from https://localhost, so hostname sniffing says
 * "marketing site" and a relative API path resolves to a host with no server.
 *
 * These two functions are the single place those decisions are made. Kept as
 * CommonJS with no imports so the same file is testable under the repo's Jest
 * runner and consumable by Vite.
 */

/**
 * Should we render the portal (rather than the public marketing site)?
 *
 * @param {object}  opts
 * @param {boolean} [opts.isNative]  running inside a Capacitor native shell
 * @param {string}  [opts.appTarget] explicit build-time target: 'app' | 'web'
 * @param {string}  [opts.hostname]  window.location.hostname (web fallback)
 * @returns {boolean}
 */
function resolveIsPortal({ isNative = false, appTarget, hostname = '' } = {}) {
  // In a native shell there is no marketing site — the app IS the portal.
  if (isNative) return true;
  if (appTarget === 'app') return true;

  // Web: a `portal.` subdomain serves the portal. Anchored so hosts that
  // merely contain "portal." (e.g. myportal.example.com) don't match.
  return hostname.startsWith('portal.');
}

/**
 * Base URL for the portal JSON API.
 *
 * Web keeps the existing same-origin relative path (no CORS, no third-party
 * cookies). Native has no origin of its own, so an absolute URL is required —
 * we fail loudly rather than silently requesting a host that isn't there.
 *
 * @param {object}  opts
 * @param {boolean} [opts.isNative]
 * @param {boolean} [opts.isProd]
 * @param {string}  [opts.apiBaseUrl] configured absolute URL (VITE_API_BASE_URL)
 * @returns {string}
 */
function resolveApiBaseUrl({ isNative = false, isProd = false, apiBaseUrl } = {}) {
  const configured = typeof apiBaseUrl === 'string' ? apiBaseUrl.trim() : '';
  const isAbsolute = /^https?:\/\//i.test(configured);

  if (isNative) {
    if (!isAbsolute) {
      throw new Error(
        'Native builds need an absolute API base URL. Set VITE_API_BASE_URL to the ' +
          "portal's full origin (e.g. https://portal.example.com/api/portal) — a " +
          'relative path resolves to the WebView host, where no server is listening.'
      );
    }
    return stripTrailingSlash(configured);
  }

  // An explicit absolute override is honoured on the web too (useful for
  // pointing a local build at staging).
  if (isAbsolute) return stripTrailingSlash(configured);

  if (isProd) return '/api/portal';

  // bd-2559: `isProd` is Vite's import.meta.env.PROD, baked in at BUILD time
  // from NODE_ENV. The staging service sets NODE_ENV=staging — not the literal
  // "production" — so every staging build shipped with isProd false and this
  // fallback hardcoded a localhost URL into the bundle. The browser then fired
  // its login preflight at http://localhost:4000, a host that does not exist
  // for the user, and login failed. Production escaped only because its
  // service happens to say NODE_ENV=production; that is luck, not design.
  //
  // The fallback exists for `vite dev`, where the SPA is served from
  // localhost:5173 while the API runs separately on :4000. So the real signal
  // is WHERE THE PAGE CAME FROM, not what NODE_ENV said at build time: a page
  // served by a real remote host is served by something that also serves the
  // API, and same-origin is correct. Only a genuinely local origin should
  // reach for the dev server.
  if (isServedByRealHost(origin)) return '/api/portal';

  return 'http://localhost:4000/api/portal';
}

function stripTrailingSlash(url) {
  return url.replace(/\/+$/, '');
}

module.exports = { resolveIsPortal, resolveApiBaseUrl };
