/**
 * BUG-142 (bd-2402): the NIETE Android app dropped its portal session on every
 * force-close — reopening always landed on the login screen.
 *
 * Root cause was NOT the cookie: the portal issues it with a 7-day Max-Age,
 * Secure and SameSite=None (dashboard/index.js), so it is a *persistent* cookie
 * the WebView is allowed to keep. The failure was that Android's WebView holds
 * cookies in an in-memory store and only flushes them to disk on its own
 * schedule; a swipe-away kills the process before that flush, so the cookie was
 * never written and the next launch started with an empty cookie jar.
 *
 * The fix lives in native Java (`MainActivity.onPause()` →
 * `CookieManager.getInstance().flush()`). Its real acceptance test is on a
 * physical device (see docs/migration/09a §2.3 — WebView cookie behaviour
 * cannot be signed off in an emulator, let alone in Jest). What we CAN guard in
 * CI is that the native shell never silently regresses to the empty
 * `extends BridgeActivity {}` stub that lost the cookie — this test was red
 * against that stub and is green once the flush-on-pause override is present.
 */

const fs = require('fs');
const path = require('path');

const MAIN_ACTIVITY = path.join(
  __dirname,
  '../../portal/android/app/src/main/java/pk/edu/niete/MainActivity.java'
);

describe('NIETE Android session persistence (BUG-142)', () => {
  // The android/ project only exists on the Capacitor branch. Skip cleanly
  // where it is absent so this guard is a no-op on branches without the shell,
  // rather than a spurious failure.
  const hasNativeShell = fs.existsSync(MAIN_ACTIVITY);
  const src = hasNativeShell ? fs.readFileSync(MAIN_ACTIVITY, 'utf8') : '';

  // Strip comments so we assert on real code, not the explanatory doc-comment.
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  (hasNativeShell ? it : it.skip)('overrides onPause to persist cookies', () => {
    expect(code).toMatch(/@Override\s+public\s+void\s+onPause\s*\(\s*\)/);
    expect(code).toMatch(/super\.onPause\s*\(\s*\)/);
  });

  (hasNativeShell ? it : it.skip)(
    'flushes the WebView CookieManager to disk (the fix for the force-close logout)',
    () => {
      expect(code).toMatch(/CookieManager\.getInstance\s*\(\s*\)\s*\.flush\s*\(\s*\)/);
    }
  );

  (hasNativeShell ? it : it.skip)(
    'is not the empty stub that lost the session',
    () => {
      // The regressed form was exactly `public class MainActivity extends
      // BridgeActivity {}` — no body. Assert there IS a body doing work.
      expect(code).not.toMatch(/class\s+MainActivity\s+extends\s+BridgeActivity\s*\{\s*\}/);
    }
  );
});
