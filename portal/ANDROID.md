# NIETE Android app — build & test

The portal SPA wrapped in Capacitor as an Android app. Same React code as the
web portal; only the build and a few runtime decisions differ.

> **App identity is fixed.** `appId` is `pk.edu.niete` because this build
> replaces the existing NIETE Play Store listing, and Play identifies an app by
> package name permanently. Do not change it.

## Prerequisites

| Need | Version | Note |
|---|---|---|
| JDK | **21** | Capacitor 8's `capacitor-android` hardcodes Java 21. JDK 17 fails with `invalid source release: 21`; a JRE-only JDK 25 fails with `does not provide JAVA_COMPILER`. |
| Android SDK | platform **35**, build-tools **35.0.0**, platform-tools | |
| Node deps | `npm ci` in `portal/` | |

`.android-env.sh` (gitignored, machine-local) sets `JAVA_HOME`, `ANDROID_HOME`
and `PATH`. Create your own if it's missing:

```bash
export JAVA_HOME="$HOME/.local/jdk/jdk-21.0.12+8"   # any real JDK 21
export ANDROID_HOME="$HOME/Android/Sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
```

No-root SDK/JDK install:
```bash
# JDK 21
curl -fsSL https://api.adoptium.net/v3/binary/latest/21/ga/linux/x64/jdk/hotspot/normal/eclipse \
  | tar -xz -C ~/.local/jdk
# SDK cmdline-tools, then:
sdkmanager --sdk_root="$ANDROID_HOME" "platform-tools" "platforms;android-35" "build-tools;35.0.0"
```

## Build

The app needs an **absolute** API URL — inside the WebView the page origin is
`https://localhost`, so a relative `/api/portal` resolves to nothing. That
comes from `.env.app` (gitignored):

```
VITE_APP_TARGET=app
VITE_API_BASE_URL=https://<portal-host>/api/portal
```

```bash
cd portal
source .android-env.sh
npx vite build --mode app        # web assets with the absolute API URL
npx cap sync android             # copy into the native project
cd android && ./gradlew assembleDebug
# -> app/build/outputs/apk/debug/app-debug.apk
```

The build **fails loudly** if a native build has no absolute `VITE_API_BASE_URL`
— that's deliberate, so a misconfigured app can't ship silently pointing at a
host with no server.

## Install and test

```bash
adb devices                                    # confirm the phone is attached
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb logcat | grep -iE "capacitor|chromium"     # watch for WebView errors
```

### What to check

| # | Check | Expected |
|---|---|---|
| 1 | App opens | The **portal login screen** — not the public marketing page |
| 2 | Login | Succeeds with a phone number + password set up beforehand via the WhatsApp link |
| 3 | Data loads | Dashboard, lesson plans, curriculum, training, coaching show real data |
| 4 | Session persists | ❌ **Known broken** — force-close returns you to login. Deferred; tracked as a known bug. Don't re-report it. |
| 5 | Back button | Navigates back; exits only from the dashboard root |
| 6 | WhatsApp links | Open WhatsApp / the browser, not a dead WebView |
| 7 | Stability | No crash or freeze during normal navigation |

**Status as of 2026-07-29** (Realme RMX2061, real hardware): #1, #2, #3 and #7
pass. #4 **fails** — session does not survive force-close; deferred to a later
release. #5 and #6 are not implemented yet.

Login (#2) only works because the portal server allows the app's origin through
CORS and issues the session cookie with `SameSite=None`. If login starts failing
with "correct" credentials, check that first — the symptom is a CORS error in
`adb logcat`, not an auth error.

> First run is **not** zero-touch yet: the portal is login-gated and passwords
> are issued through a one-time WhatsApp setup link, so a fresh install lands on
> a login screen. Making that automatic is a separate, deferred decision.

## Web build is unaffected

`npm run build` (no `--mode app`) still produces the website bundle with the
relative `/api/portal` path and hostname-based portal detection. One codebase,
two targets — verified by `tests/portal/app-target.test.js`.

## Release signing

Release builds need the inherited NIETE signing key, supplied via environment
(see `keystore.properties.template`). Never commit the `.jks` or its passwords.
