# 09a — Capacitor Wrapping (the engineering work)

**Status**: 🟡 Planned — 2026-07-29. This is the **prerequisite project** for [09-play-store-launch](./09-play-store-launch.md); the store submission is its tail end, not its substance.
**Scope**: turn the existing portal SPA into a signed Android app that a coach can install and log into. Everything up to "we have a working, signed AAB on a real phone."
**Out of scope**: store listing assets, Data safety form, review, rollout — those are doc 09 phases 3–4. **Also out of scope: zero-touch first-run auth** (D-014 / `bd-2357`) — see below.

> **Scope note added 2026-07-29 (operator).** The goal is that a teacher installs the app and it "just works" with nothing to configure. That is **not part of this wrap**: the portal is login-gated and passwords are issued through a one-time WhatsApp setup link, so a fresh install necessarily lands on a login screen today. Wrap first; design the first-run flow after. This doc therefore targets **"installs, runs, and can log in"** — not "installs and is already logged in."
>
> Why it can't be a config tweak: a coach's route to credentials is WhatsApp registration → `/portal/setup/{token}` (7-day expiry) → set password → log in with phone + password. Nothing in the Capacitor layer can conjure a session. The enabler when we do tackle it is that the WhatsApp `/portal` command is **re-requestable and idempotent** — activated users get a login link, unactivated get a fresh setup link — so a deep-link-to-session exchange is the most likely design. Recorded, not built.
**Tracking**: `bd-2343` (shell), `bd-2344`–`bd-2348` (blockers), `bd-2351` (signing hygiene), + `bd-2353`–`bd-2356` (below)

---

## Why this is a separate doc

Doc 09 compressed roughly two days of engineering into "Phase 2 + Phase 3" and read as a store-submission plan. That hid the actual work and, more importantly, hid three environment blockers that mean **nobody can execute the build steps as written today**. This doc is the buildable version.

The dependency order is:

```
09a (this doc): make it build + run + log in   →   09: make it publishable
```

---

## Phase 0 — Toolchain (blocking; nothing below works without it) — `bd-2353`

Verified on this machine 2026-07-29. All three are hard stops:

| Check | Found | Needed | Why it blocks |
|---|---|---|---|
| Android SDK | **absent** — no `ANDROID_HOME`, no `sdkmanager`/`adb` on PATH | SDK platform 35 + build-tools + platform-tools | `npx cap add android` scaffolds, but `./gradlew` cannot compile |
| JDK | **25** (`openjdk 25.0.3`) | **17** (21 acceptable) | The reference build is AGP **8.13.2** / Gradle **8.13**; AGP 8.13 supports up to JDK 21. JDK 25 fails the build. The reference's own script states `openjdk-17-jdk`. |
| `portal/node_modules` | **absent** | installed | `npm run build` can't produce `dist/` to wrap |

Deliverable: `java -version` reports 17, `sdkmanager --list` works, `cd portal && npm ci && npm run build` produces `dist/`.

> Use a JDK switcher (e.g. `alternatives`/`sdkman`) rather than replacing the system JDK 25 — other tooling on this box may want it.

---

## Phase 1 — Decide the build pipeline (a real decision, ~30 min) — `bd-2354`

The portal is currently deployed by **committing a pre-built `dist/`** into the dashboard's static folder and refreshing it by hand. Adding an app build forks that question, because now **two** artifacts come from one source and they must not drift.

| Option | How it works | Pro | Con |
|---|---|---|---|
| **A. Wrap `portal/`, keep the manual web copy** (recommended for v1) | `webDir: 'dist'` inside `portal/`. Web deploy keeps its current hand-copy step. | Smallest change; no deploy-pipeline risk during this project | Two manual steps; drift still possible if someone rebuilds one and not the other |
| B. Single build script feeding both | One script builds `portal/dist`, copies to the dashboard folder, then `cap sync` | Web and app provably from one build | Touches the live web deploy path — a regression here breaks the portal for coaches |
| C. Two-stage CI build | CI builds the SPA, publishes both artifacts | Correct long-term | Most work; the fork's CI has no build gate on `portal/` today |

**Recommendation: A now, B or C when the app is real.** This project should not put the live coach portal at risk to tidy a build pipeline. But record it: **the app must be built from `portal/`, never from the committed `dist/`** — wrapping the committed copy would ship whatever stale build is checked in, and app/web would silently diverge with no signal.

---

## Phase 2 — Fix the four blockers (the real work, ~1–1.5 days) — `bd-2344`–`bd-2348`

Root cause shared by all four: Capacitor serves the bundle from `https://localhost` on-device, not from the portal's public origin. Four places assume the latter. TDD per Rule 6 — each gets a test that fails against current code first; all are deterministic and unit-testable except the cookie behaviour, which needs a device.

**All four must be guarded so web behaviour is byte-for-byte unchanged** — one codebase keeps serving the website. That guard is the acceptance criterion, not an afterthought.

### 2.1 — Portal-vs-marketing gate (`bd-2344`)

`portal/src/App.tsx:30`:
```js
const isPortalSubdomain = window.location.hostname.startsWith('portal.');
// route "/" → isPortalSubdomain ? <PortalLogin /> : <Index />
```
On-device the hostname is `localhost` ⇒ **false** ⇒ the app opens the public marketing splash. The reference `capacitor.config.ts` confirms `hostname: 'localhost'`.

Fix: resolve the target explicitly — `Capacitor.isNativePlatform()` or a build flag (`VITE_APP_TARGET=app`) — keeping the hostname test as the web fallback.
Test: given a native platform, `/` resolves to `PortalLogin`; given `portal.*`, unchanged; given a bare web host, `Index`.

### 2.2 — Absolute API base URL (`bd-2346`)

`portal/src/portal/services/api.ts`:
```js
const API_BASE_URL = import.meta.env.PROD ? '/api/portal' : 'http://localhost:4000/api/portal';
```
A production app build takes the `PROD` branch ⇒ resolves against `https://localhost/api/portal` ⇒ nothing listening ⇒ blank screens.

Fix: `VITE_API_BASE_URL` (absolute) for app builds; default to today's relative path on web.
Test: with the app flag + env set, base URL is the absolute portal origin; without it, `/api/portal`.

Do 2.1 and 2.2 first — they're pure logic, and until both land, nothing renders on-device to test 2.3 against.

### 2.3 — Session cookies in the WebView (`bd-2345`) — the risky one

`api.ts` sets `withCredentials: true` and carries a comment that same-origin means "no more third-party cookies" — true on web, **false** in the app: page origin `https://localhost`, API on the Railway host. The session cookie becomes third-party, the exact condition the current design avoids.

Unfixed symptom: login *appears* to succeed, every subsequent request 401s, and the interceptor redirects to `/portal/login` — an endless login loop.

| Option | Change | Trade-off |
|---|---|---|
| **(a) `SameSite=None; Secure` + `CapacitorCookies`** (recommended v1) | Session cookie attributes + Capacitor cookie plugin | Small; no auth redesign. Depends on third-party cookie tolerance, which browsers keep tightening |
| (b) Token/`Authorization` header for native clients | Add a token path to `/api/portal/*` | Durable, immune to cookie policy — but a server-side auth change touching a live portal |

Recommendation: **(a) for v1, (b) recorded as the durable answer.**

> **This cannot be signed off in an emulator.** WebView cookie behaviour differs across real Android versions and OEM builds. Acceptance = log in on a **physical device**, force-close, reopen, and still be authenticated. This is the single most likely cause of a "shipped but dead" launch, so it gates everything downstream.

### 2.4 — Native shell behaviours (`bd-2347`)

- **Hardware back button** — default can close the app from any screen; wire to router history, exit only from the dashboard root.
- **External links** — the portal links out to WhatsApp; those must hand off to the system browser/WhatsApp app, not navigate the WebView to a dead end.
- **Session-expiry redirect** — `window.location.href = '/portal/login'` must still resolve under the `localhost` origin.

### 2.5 — Console-logging safety (`bd-2348`)

Inherited from `taleemabad-core`: Capacitor's Android bridge **OOMs on unbounded `console.*` args** — a real production incident there. Set `loggingBehavior: 'production'` (as the reference does) and audit the portal for large-payload logging.

---

## Phase 3 — Add the Capacitor shell (~0.5 day) — `bd-2343`

Only after Phase 0 is green and Phase 2 is merged.

```bash
cd portal
npm i -D @capacitor/cli && npm i @capacitor/core @capacitor/android
npx cap init NIETE pk.edu.niete --web-dir=dist   # appId MUST be exactly pk.edu.niete
npx cap add android
```

`capacitor.config.ts` mirrors the verified reference:

| Setting | Value | Source |
|---|---|---|
| `appId` | `pk.edu.niete` | **Immovable** — must match the existing listing (doc 09 D-010) |
| `appName` | `NIETE` | reference |
| `androidScheme` | `https` | reference |
| `hostname` | `localhost` | reference — and the reason for blocker 2.1 |
| `loggingBehavior` | `production` | reference — OOM mitigation (2.5) |
| `minSdk` / `targetSdk` | 24 / 35 | reference; already meets Play's target-35 rule |
| `versionCode` | above the highest Play has accepted (repo shows `1126`) | doc 09 phase 1 |

**Signing (`bd-2351`)** — we inherit the existing key (D-010 leaves no choice), but not its handling. The reference commits `niete-app.jks` with plaintext passwords in `build.gradle`. Here: keystore path + passwords come from env/CI secrets, `*.jks` is gitignored, and the build **fails loudly** if they're absent. Never commit the key to this repo.

**Repo hygiene (`bd-2355`)** — `npx cap add android` adds ~50 files. Before committing: confirm the generated `android/` doesn't trip `secret-scan.yml` or the source-hygiene guard (which scans broadly for credentials and internal refs), and that `ci.yml` — which already references `portal/` — doesn't try to build or lint the native dir.

Deliverable: a signed AAB that installs on a physical device and reaches the portal **login screen**.

---

## Phase 4 — Prove it on real hardware (~0.5 day) — `bd-2356`

Emulator is for iteration; sign-off is on a physical Android phone.

1. Login succeeds against the production portal API — **using credentials set up beforehand via the WhatsApp link**. Manual login at this stage is expected, not a failure (D-014).
2. **Session survives force-close and reopen** (the 2.3 gate) — this is the test that the cookie fix actually works, and it is also the groundwork for zero-touch later: a session that persists correctly is what makes "already logged in on reopen" possible at all.
3. Dashboard, lesson plans, curriculum, training, coaching all load real data.
4. Back button navigates, exits only from root.
5. WhatsApp link opens the app/browser, not a dead WebView.
6. No OOM/crash under normal navigation.
7. **Website unchanged** — rebuild and confirm the web portal behaves exactly as before.

Ideally test on a second, older/low-end device — the coach audience is not on flagships, and WebView versions vary.

Exit criterion for 09a → 09: **all seven green on real hardware.** Only then is store paperwork worth doing.

---

## Risks specific to this phase

| Risk | Mitigation |
|---|---|
| Cookie fix works in emulator, fails on real devices | Physical-device gate; second older device if available |
| Fixing the four blockers regresses the live web portal | Every fix guarded + web-unchanged check in Phase 4.7 |
| Build pipeline change breaks the coach portal deploy | Option A — don't touch the live deploy path during this project |
| `android/` trips CI secret-scan / hygiene guards | Checked before commit (`bd-2355`) |
| Keystore leaks into this repo | Gitignore + env-sourced secrets; fail loudly (`bd-2351`) |
| Wrap ships, then zero-touch auth forces a rethink of the session design | The cookie work in 2.3 is the foundation either way — a persistent session is a prerequisite for any auto-login design, so this work is not wasted. Keep the auth path in 2.3 option (b)-friendly if it's cheap to do so (`bd-2357`) |
| JDK/AGP mismatch burns a day | Phase 0 pins JDK 17 up front |

## Effort

| Phase | Effort |
|---|---|
| 0 — Toolchain | 1–2h (blocking) |
| 1 — Pipeline decision | 30 min |
| 2 — Four blockers | 1–1.5 days |
| 3 — Capacitor shell | 0.5 day |
| 4 — Device verification | 0.5 day |

**~2.5–3 days engineering**, before any store paperwork. Doc 09 phase 4 (listing, policy, Data safety) can run in parallel from Phase 2 onward, since Google review is calendar time.
