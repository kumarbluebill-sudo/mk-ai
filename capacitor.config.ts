import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Native shell (Android / iOS) around the deployed web app.
 *
 * MK AI Travel is a server-rendered Next.js app with live supplier calls and a database, so it cannot be
 * exported as static files into the app bundle. The native app is therefore a WebView that loads the
 * deployed site (server.url). Consequences, stated plainly:
 *   - the app needs a connection; offline shows `capacitor-web/index.html`;
 *   - web changes reach users the moment you deploy, with no store review;
 *   - Apple may reject apps that are only a website wrapper (App Store guideline 4.2), so an iOS release
 *     needs real native value (push notifications, camera for documents, etc.) or a different approach.
 *
 * Decisions you must make before a store release: appId (permanent once published), the production URL,
 * app name, signing keys. Nothing here has been built or run on a device.
 */

const SERVER_URL = process.env.CAP_SERVER_URL ?? "https://mk-ai-iota.vercel.app";
const host = new URL(SERVER_URL).host;

const config: CapacitorConfig = {
  appId: "com.mksolutions.aitravel",
  appName: "MK AI Travel",
  // Only used when the site cannot be reached; the real UI comes from server.url.
  webDir: "capacitor-web",
  server: {
    url: SERVER_URL,
    cleartext: SERVER_URL.startsWith("http://"),
    // The WebView may only navigate to our site and the services the pages themselves load from.
    allowNavigation: [host, "api.mapbox.com"],
  },
  android: { allowMixedContent: false },
  ios: { contentInset: "automatic" },
};

export default config;
