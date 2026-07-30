import type { CapacitorConfig } from '@capacitor/cli';

/**
 * NIETE portal Android app.
 *
 * appId MUST stay `pk.edu.niete` — this build replaces the existing NIETE
 * Play Store listing, and Play identifies an app by package name permanently.
 * A different id would create a second, unrelated listing that cannot
 * replace or upgrade the existing one.
 *
 * `hostname: 'localhost'` (matching the existing NIETE app) is why the portal
 * needs the app-target fix: hostname-sniffing to decide "am I the portal?"
 * is false in the WebView.
 *
 * `loggingBehavior: 'production'` is deliberate — Capacitor's Android bridge
 * can exhaust memory on unbounded console output. That caused a real
 * production incident on the existing app.
 */
const config: CapacitorConfig = {
  appId: 'pk.edu.niete',
  appName: 'NIETE',
  webDir: 'dist',
  loggingBehavior: 'production',
  android: {
    // Release signing comes from environment/CI secrets, never committed.
    // See android/keystore.properties.template.
    buildOptions: {
      keystorePath: process.env.NIETE_KEYSTORE_PATH,
      keystorePassword: process.env.NIETE_KEYSTORE_PASSWORD,
      keystoreAlias: process.env.NIETE_KEY_ALIAS,
      keystoreAliasPassword: process.env.NIETE_KEY_PASSWORD,
      releaseType: 'AAB',
    },
  },
  server: {
    androidScheme: 'https',
    hostname: 'localhost',
  },
};

export default config;
