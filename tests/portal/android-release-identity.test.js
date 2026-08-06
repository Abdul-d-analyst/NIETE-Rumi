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

  // Floor moves with every upload: Play rejects a bundle whose versionCode is
  // not strictly higher than the live release, so this asserts against the
  // highest code that has LEFT this machine, not the highest ever built.
  // 1202 shipped, then 1203 was uploaded (operator, 2026-08-06) — so the AAB
  // carrying the auth-flow fixes has to be 1204.
  it('versionCode is at least 1204 (1203 uploaded; Play needs a higher code)', () => {
    const m = source.match(/versionCode\s+(\d+)/);
    expect(m).not.toBeNull();
    expect(Number(m[1])).toBeGreaterThanOrEqual(1204);
  });

  it('versionName tracks versionCode', () => {
    const code = source.match(/versionCode\s+(\d+)/)[1];
    const name = source.match(/versionName\s+["']([^"']+)["']/)[1];
    expect(name).toBe(code);
  });

  // bd-2396: Gradle's default output is `app-release.aab` for every build, so
  // two AABs from different versions are indistinguishable once they leave the
  // build directory — and the file that matters is the one being uploaded to
  // Play. Naming the artifact after the versionCode makes it self-identifying.
  describe('the release artifact is self-identifying (bd-2396)', () => {
    it('names the archive niete-rumi-v<versionCode>', () => {
      const gradle = stripComments(source);
      expect(gradle).toMatch(/archivesName\s*=\s*["']niete-rumi-v\$\{[^}]*versionCode\}["']/);
    });

    it('copies the bundle to the exact niete-rumi-v<versionCode>.aab name', () => {
      const gradle = stripComments(source);
      expect(gradle).toMatch(/niete-rumi-v\$\{[^}]*versionCode\}\.aab/);
    });

    it('derives the name from versionCode rather than hardcoding a number', () => {
      const gradle = stripComments(source);
      for (const [, name] of gradle.matchAll(/["'](niete-rumi-v[^"']*)["']/g)) {
        // A literal digit would go stale on the next bump; it must interpolate.
        expect(name).not.toMatch(/v\d/);
        expect(name).toContain('${');
      }
    });

    // archivesBaseName is removed in Gradle 9 — the modern spelling is
    // archivesName, and reintroducing the old one would reintroduce a
    // deprecation warning on every build.
    it('does not use the Gradle-9-removed archivesBaseName', () => {
      expect(stripComments(source)).not.toMatch(/archivesBaseName/);
    });
  });
});
