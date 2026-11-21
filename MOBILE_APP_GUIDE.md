# Mobile App Guide (PWA and Capacitor)

## 1. Installable web app (PWA): built and tested

What users get: an "Install app" prompt on Chrome/Edge/Android, "Add to Home Screen" instructions on iOS Safari, a standalone window with the app icon, shortcuts (Plan a trip, My trips, Bookings), an offline page, and an offline banner.

| Piece | File |
| --- | --- |
| Manifest (name, icons, shortcuts, colours) | `src/app/manifest.ts` |
| Icons (192, 512, maskable, Apple touch, favicon) | `public/icons/` |
| Service worker | `public/sw.js` (no-cache headers in `next.config.ts`) |
| Offline page | `src/app/offline/page.tsx` |
| Registration, install prompt, offline banner | `src/components/pwa.tsx`, used in `src/app/layout.tsx` |

**Privacy rule of the service worker.** This is a multi-agency app that people use on shared computers, so the worker stores **nothing that belongs to a signed-in user**: no API responses, no pages. It caches only the offline page and public, content-hashed static files (scripts, styles, icons). Page visits always go to the network; the offline page is used only when the network fails. Trips, quotations and bookings are therefore **not available offline**, by design. An end-to-end test (`e2e/pwa.spec.ts`) signs in, browses, and then checks that every cached URL is on that short allow-list.

The worker is registered in production builds only (in development it would cache stale code). To ship a worker change, bump `VERSION` in `sw.js`; old caches are deleted on activation.

Regenerating the icons: they are drawn from `public/icons/icon.svg`; the PNGs were rendered from the same shapes in a headless browser.

## 2. Native shell (Capacitor): configured, **not built or run on any device**

`capacitor.config.ts` wraps the **deployed site** in an Android/iOS WebView (`CAP_SERVER_URL`, default the Vercel URL). It cannot bundle the app files because MK AI Travel is a server-rendered app with a database and live supplier calls.

What has been verified: the config loads, `cap add android` and `cap sync` succeed. What has **not**: building an APK/AAB (needs the Android SDK, absent here), running on a phone or emulator, any iOS build (needs a Mac with Xcode), signing, store submission.

```text
npm run cap:add:android      # generates the android/ folder (git-ignored)
npm run cap:sync
npm run cap:open:android     # opens Android Studio: build, run, sign there
npm run cap:add:ios          # on a Mac
```

**Decisions that are yours before a store release**

1. **App id** (`com.mksolutions.aitravel` is a placeholder). It is permanent once published.
2. **Production URL.** Set `CAP_SERVER_URL` when syncing for a release build, so a development URL never ships.
3. **Apple's rules.** App Store guideline 4.2 rejects apps that are only a website in a frame. An iOS release needs real native value (for example push notifications or scanning documents with the camera), or should stay a PWA. Google Play is more relaxed but still expects a quality app.
4. **Signing keys** and the developer accounts (Google Play and Apple Developer Program fees).
5. Whether offline behaviour is enough: the shell shows a "connecting" page when the site cannot be reached and cannot show any trips offline.

Because the shell loads the live site, web changes reach installed apps the moment you deploy, with no store review. That also means a bad deploy reaches everyone immediately.
