# 09 — Play Store Launch (Android, NIETE portal)

**Status**: 🟡 Planned — activated 2026-07-29 by operator request. Supersedes the "deferred" posture of [07-capacitor-mobile](./07-capacitor-mobile.md).
**Depends on**: [00-scope-and-decisions](./00-scope-and-decisions.md) D-001 phase 2
**Tracking**: `bd-2343` … `bd-2352`

---

## Decisions locked 2026-07-29 (operator)

| # | Decision | Consequence |
|---|---|---|
| D-010 | **Replace the existing `pk.edu.niete` Play Store listing** — do not create a new one | Package name and signing key are FIXED, not chosen. See "The two immovable constraints" below. |
| D-011 | **Android only** for v1. iOS explicitly considered and deferred | No Apple Developer account. Keep the Capacitor iOS path un-poisoned so adding it later is config, not rework (`bd-2352`). |
| D-012 | **Thin wrapper first** — online-only. Offline caching is a later release | No Dexie, no service worker, no push in v1. Ship distribution, then decide offline from real usage. |
| D-013 | **Clean break — existing user data is expendable** (operator, 2026-07-29) | No data migration, no account mapping from the old NIETE app. Whoever wants the new app registers via WhatsApp like any new teacher. Removes the blocking active-installs gate. |
| D-014 | **Zero-touch first run is a GOAL, deferred** (operator, 2026-07-29) | "Install and it works" is desired but **out of scope for the wrap**. Wrap first, decide the first-run auth flow after. Tracked as `bd-2357`. |

### D-010 is the load-bearing decision

Replacing an existing listing is **not** the same job as publishing a new app. Two things become immovable:

1. **Package name must be exactly `pk.edu.niete`.** Play identifies an app by package name, permanently. A different ID (e.g. `com.rumi.niete`) creates a *second, unrelated* listing — it cannot replace or upgrade the existing one.
2. **The AAB must be signed with the same key** Play already trusts for that listing. Wrong key ⇒ Play rejects the upload outright, and there is no appeal path other than Play's key-reset process.

Both are already satisfied by the existing Taleemabad `school-app` build, which is the reference implementation to inherit from — verified 2026-07-29:

| Fact | Value (verified) |
|---|---|
| Existing app ID | `pk.edu.niete` (flavor `niete`); staging variant `pk.edu.niete.stage` |
| App name | `NIETE` |
| Signing keystore | `niete-app.jks`, alias `niete` |
| Cert subject | `CN=NIETE, OU=Taleemabad, O=Orenda Pvt Ltd, L=Islamabad, C=92` |
| Cert SHA-256 | `DA:A4:A5:FB:CF:D7:20:6F:40:41:DB:1C:EE:BF:D4:1E:E2:8E:91:E6:25:3F:49:26:65:F5:06:C0:44:CA:36:2C` |
| Cert validity | 2024-02-26 → 2049-02-19 (not an expiry risk) |
| Current `versionCode` (niete) | `1126` — **the new build must exceed this** |
| minSdk / targetSdk | 24 / 35 (Play's target-35 requirement already met) |

> **Confirm before building**: whether the listing uses **Play App Signing**. If it does, the local key is the *upload* key and Play re-signs; if not, the local key IS the app-signing key. Either way this keystore is the one to use — but it changes what happens if it is ever lost. Check Play Console → Test and release → Setup → App signing.

### What "replace" means in practice

This is a **content swap on an existing listing**, delivered as a normal version update:

- Same package, higher `versionCode` ⇒ existing NIETE users get it as an **app update**, not a new install.
- The old app's UI is entirely replaced by the Rumi portal WebView.
- It is a user-visible product change for whoever has the old app — but per **D-013 that is accepted**: no migration, no account mapping, and losing their old data is fine. They register via WhatsApp like any new teacher.

Because of D-013 the active-installs count is **no longer a blocking gate**. It is still worth a glance for comms purposes (a heads-up notice costs little), but it does not hold up the release.

---

## What we are actually shipping

A Capacitor Android shell around the **existing** NIETE teacher/coach portal — the Vite + React SPA in `portal/`. No feature rewrite. React components, routes, and API contract stay identical.

Audience is per D-002: **coaches and admins** (teachers stay on WhatsApp). The portal's live surfaces today are dashboard, lesson plans, curriculum, training, and coaching (+ analytics/detail). Reading assessments and the video library are deliberately route-404'd and stay out of scope.

### Which directory gets wrapped — and why it matters

Production serves the SPA from a **committed** `dashboard/portal-frontend/dist/`, rebuilt by hand from `portal/`. Capacitor must wrap **`portal/`** (the source project), with `webDir` pointing at `portal/dist`.

Wrapping the committed `dashboard/portal-frontend/dist/` instead would silently ship whatever stale build happens to be checked in. The web deploy and the app build must come from one `npm run build` in `portal/`, or the app and the website will drift and nobody will know which is which.

---

## The four code blockers (found 2026-07-29 by reading the portal source)

These are not speculative. Each is a concrete line that breaks under Capacitor, because a Capacitor WebView loads the app from `https://localhost` rather than from the portal's own origin.

### 1. `isPortalSubdomain` renders the wrong app entirely — `bd-2344`

`portal/src/App.tsx` decides what to show at `/` by sniffing the hostname:

```js
const isPortalSubdomain = window.location.hostname.startsWith('portal.');
// route "/" → isPortalSubdomain ? <PortalLogin /> : <Index />
```

In the WebView the hostname is `localhost`, so this is **false** — the app would open on the public **marketing splash**, not the login screen. The reference `capacitor.config.ts` for the existing NIETE app confirms `hostname: 'localhost'`.

Fix: make the "am I the portal?" decision explicit rather than host-derived — a build-time flag (e.g. `VITE_APP_TARGET=app`) OR `Capacitor.isNativePlatform()`, with the hostname check kept as the web fallback.

### 2. Session-cookie auth will not survive the WebView — `bd-2345`

The API client is cookie-session based, with a comment that is true for web and false for native:

```js
// portal/src/portal/services/api.ts
withCredentials: true, // CRITICAL: Includes session cookies
// "frontend and backend are on same domain … no more third-party cookies!"
```

Under Capacitor, origin is `https://localhost` and the API is on `portal-production-*.up.railway.app` — so the session cookie becomes **third-party**, exactly the condition the current design avoids. Without work, login appears to succeed and every subsequent request 401s (and the interceptor bounces the user back to `/portal/login` — an infinite login loop).

Fix (needs a real decision, not a guess): either
- **(a)** set the session cookie `SameSite=None; Secure` and enable `CapacitorCookies` so the WebView persists it; or
- **(b)** add a token/`Authorization`-header auth path to `/api/portal/*` for native clients — more work, but avoids third-party-cookie decay in future WebView/Chromium versions.

Recommendation: **(a)** for v1 (smaller change, no server-side auth redesign), with (b) noted as the durable answer. This must be proven on a real device before any store upload — it is the single most likely cause of a "works in emulator, dead in production" launch.

### 3. Relative API base URL has no origin in the WebView — `bd-2346`

```js
const API_BASE_URL = import.meta.env.PROD ? '/api/portal' : 'http://localhost:4000/api/portal';
```

A production Capacitor build takes the `PROD` branch, so requests resolve against `https://localhost/api/portal` — where nothing is listening. Fix: an env-driven absolute base URL for app builds (`VITE_API_BASE_URL`), defaulting to today's relative path for web.

### 4. Native shell behaviours the web app never needed — `bd-2347`

- **Hardware back button**: default Capacitor behaviour can close the app from any screen. Wire it to router history, exiting only from the dashboard root.
- **External links**: the portal links to WhatsApp. Those must open in the system browser / WhatsApp app, not navigate the WebView to a dead end.
- **Session-expiry redirect**: `window.location.href = '/portal/login'` (api.ts) needs to remain valid under the `localhost` origin.

### Plus one inherited production lesson — `bd-2348`

Doc 07 flags it and it is a real incident from `taleemabad-core`: **Capacitor's Android bridge OOMs on unbounded `console.*` arguments.** The reference config sets `loggingBehavior: 'production'`. Match that, and audit the portal for large-object logging (e.g. `console.log('Fonts loaded…')` is fine; dumping API payloads is not).

---

## Security issue to fix on the way through — `bd-2351`

The reference keystore is **committed to git with plaintext passwords in `build.gradle`**:

```gradle
storeFile file('./keystore/niete-app.jks')
storePassword 'nieteapp'   // in the repo
keyPassword  'nieteapp'    // in the repo
```

`niete-app.jks` is git-tracked and not ignored. That key controls the identity of a published government-facing app until **2049**; anyone with repo access can sign an app that Play and devices will accept as NIETE.

We inherit the key (D-010 leaves no choice), but the NIETE-Rumi build must not re-commit this pattern: keystore + passwords come from CI secrets / env, `*.jks` gitignored, and the build fails loudly if they are absent. Rotating the key itself is a separate, larger conversation — flagged, not silently adopted.

---

## Phased plan

Effort is engineering time; Google review is calendar time that runs in parallel.

### Phase 1 — Confirm the inheritance (blocking, ~1–2h, mostly Play Console)

No code. Get these facts from Play Console before writing a build:

1. Confirm the listing's package is `pk.edu.niete` and we have release access to it.
2. Record whether **Play App Signing** is on, and the expected signing-cert SHA-256. Compare to the fingerprint above.
3. Note the highest `versionCode` Play has ever accepted (may exceed the repo's `1126`).
4. *(Informational only, per D-013)* glance at active installs — for comms, not as a gate.

**Stop and reassess if**: the fingerprint doesn't match, or we don't hold release access. (The active-install concern is retired by D-013.)

### Phases 2–3 — Capacitor wrapping → **see [09a-capacitor-wrapping.md](./09a-capacitor-wrapping.md)**

The engineering work — toolchain, the four code blockers, the Capacitor shell, and physical-device verification — is a project in its own right and has its own plan of record. **Do not plan it from this doc**; 09a is authoritative.

Summary only:

| 09a phase | Work | Effort |
|---|---|---|
| 0 | Toolchain — Android SDK, JDK 17 (not the local JDK 25), portal deps (`bd-2353`) | 1–2h, blocking |
| 1 | Build-pipeline decision — app builds from `portal/`, never the committed `dist/` (`bd-2354`) | 30 min |
| 2 | The four blockers (`bd-2344`–`bd-2348`), each guarded so web behaviour is unchanged | 1–1.5 days |
| 3 | Capacitor shell with the inherited app identity + env-sourced signing (`bd-2343`, `bd-2351`, `bd-2355`) | 0.5 day |
| 4 | Physical-device verification — 7 checks (`bd-2356`) | 0.5 day |

**~2.5–3 days.** Phase 4 below (listing, policy, Data safety) can run in parallel from 09a phase 2 onward, since Google review is calendar time.

**Gate into the store work**: all seven device checks green on real hardware. Store paperwork before that is premature.

### Phase 4 — Store listing + compliance (~0.5 day + review time) — `bd-2349`, `bd-2350`

- **Assets**: adaptive icon, 512px icon, 1024×500 feature graphic, ≥2 phone screenshots, short + full description. NIETE brand assets (logo, charcoal/green palette) already exist in the portal.
- **Data safety form** — mandatory and must be accurate. The app handles teacher phone numbers, names, coaching data. Getting this wrong is a common rejection and a compliance problem.
- **Privacy policy + ToS at public URLs** (`bd-2350`) — required by Play *and* already an open Meta/WABA blocker in doc 08 item 7-8. **Doing this once clears both.**
- Because the app is a WebView over an authenticated portal, expect reviewers to need **working demo credentials** — supply a real test account, not a screenshot.

### Phase 5 — Staged rollout

Upload to **internal testing** → verify login/session on real devices → **closed testing** with NIETE coaches → production at a **staged percentage**, not 100%. Staged rollout is the only cheap protection for existing installs, since a bad update replaces a working app.

---

## Risks

| Risk | Why it matters | Mitigation |
|---|---|---|
| Signing-key mismatch | Upload permanently rejected for that listing | Phase 1 verifies the fingerprint before any build |
| Session cookie dies in WebView | Login loop; app is unusable while looking "shipped" | Prove on a physical device in phase 2, before store upload |
| ~~Existing NIETE users get a different app~~ | **Retired by D-013** — data loss accepted, clean break, no migration | Optional courtesy notice only |
| Fresh install lands on a password login | Contradicts the "install and it works" goal — the app is login-gated and credentials come from a WhatsApp one-time link, so a new user has no password to type | **Deliberately deferred (D-014, `bd-2357`)** — wrap first, then design the first-run flow. Not a wrap blocker |
| Committed signing key | Anyone with repo access can sign as NIETE | `bd-2351`; do not propagate the pattern into this repo |
| Data safety form inaccurate | Rejection or a compliance issue on teacher PII | Fill from the actual API surface, not from memory |
| Review latency | ~days, and first submissions often bounce | Start phase 4 paperwork during phase 2 |

## Explicitly out of scope for v1

Offline caching / Dexie (D-012), push notifications, iOS (D-011, `bd-2352`), camera/storage permissions (no portal surface needs them today), and any portal feature work. Reading assessments and the video library stay 404'd.

## Open questions for the operator

1. **Play App Signing on or off**, and do we hold release access to the existing listing?
2. **How many active installs** does the old NIETE app have — and does replacing it need NIETE's explicit blessing?
3. **Who owns the privacy policy / ToS text**, given it is also gating Meta verification?
4. Is the old app's backend (`schools.niete.pk`) being retired, or do both need to coexist?
