/**
 * bd-2395 — the Play release identity is not allowed to drift.
 *
 * Two ways an Android release goes unrecoverably wrong, both silent at build
 * time and only visible once Play rejects the upload (or worse, accepts it):
 *
 *   1. applicationId stops being exactly `pk.edu.niete`. Play identifies a
 *      listing by package name permanently, so a release carrying a suffix
 *      (`.debug`, `.stage`) cannot update the existing app — it would be a
 *      second, unrelated listing. Debug builds DO take a `.debug` suffix so
 *      they can sit beside the real app; the guard is that the suffix stays
 *      inside the debug block and never reaches release.
 *
 *   2. versionCode fails to increase. Play rejects any bundle whose
 *      versionCode is not strictly higher than the live release, so shipping
 *      a fix under a stale code wastes an upload round-trip.
 *
 * Reading build.gradle as text is deliberate: the failure is a one-line edit
 * in that file, and asserting on the file is what catches it before a build.
 */
const fs = require('fs');
const path = require('path');

const GRADLE = path.join(__dirname, '../../portal/android/app/build.gradle');
const source = fs.readFileSync(GRADLE, 'utf8');

/** The build.gradle body of a named buildTypes block. */
function buildTypeBlock(name) {
  const start = source.indexOf(`${name} {`, source.indexOf('buildTypes'));
  if (start === -1) return '';
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return '';
}

/** Strip line + block comments so prose about `.debug` can't satisfy a match. */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('bd-2395 — Android release identity', () => {
  it('applicationId is exactly pk.edu.niete', () => {
    expect(source).toMatch(/applicationId\s+["']pk\.edu\.niete["']/);
  });

  it('the release build type carries NO applicationIdSuffix', () => {
    const release = stripComments(buildTypeBlock('release'));
    expect(release).not.toMatch(/applicationIdSuffix/);
  });

  it('the debug suffix stays scoped to the debug build type', () => {
    const debug = stripComments(buildTypeBlock('debug'));
    expect(debug).toMatch(/applicationIdSuffix\s+["']\.debug["']/);
  });

  it('versionCode is at least 1203 (1202 shipped; Play needs a higher code)', () => {
    const m = source.match(/versionCode\s+(\d+)/);
    expect(m).not.toBeNull();
    expect(Number(m[1])).toBeGreaterThanOrEqual(1203);
  });

  it('versionName tracks versionCode', () => {
    const code = source.match(/versionCode\s+(\d+)/)[1];
    const name = source.match(/versionName\s+["']([^"']+)["']/)[1];
    expect(name).toBe(code);
  });
});
