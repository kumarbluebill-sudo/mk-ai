"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

/** The browser's install event, which TypeScript's DOM types do not include. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISSED_KEY = "mk-install-dismissed";

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** Registers the service worker (production only: in dev it would cache stale code). */
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((error: unknown) => {
      console.error("Service worker registration failed:", error instanceof Error ? error.message : error);
    });
  }, []);
  return null;
}

/** Banner shown when the connection drops, so a failed save is not a mystery. */
export function OfflineBanner() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    sync();
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);
  if (online) return null;
  return (
    <p role="status" className="fixed inset-x-0 top-0 z-50 bg-amber-100 p-2 text-center text-sm text-amber-900">
      You are offline. Searches, saving and bookings need a connection.
    </p>
  );
}

/**
 * "Install app" prompt. Chrome/Edge/Android give us an install event; iOS Safari has none, so it gets a
 * short instruction instead. Dismissal is remembered on this device only.
 */
const noSubscribe = () => () => undefined;

function isIosSafari(): boolean {
  const ua = navigator.userAgent;
  return /iphone|ipad|ipod/i.test(ua) && /safari/i.test(ua) && !/crios|fxios/i.test(ua);
}

export function InstallPrompt() {
  const [event, setEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [closed, setClosed] = useState(false);
  // Browser facts are read with useSyncExternalStore (server snapshot: false) so nothing renders differently
  // between server and client, and no state has to be set from an effect.
  const eligible = useSyncExternalStore(noSubscribe, () => !isStandalone() && !readDismissed(), () => false);
  const iosHint = useSyncExternalStore(noSubscribe, () => isIosSafari(), () => false);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvent(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setClosed(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  function dismiss() {
    try {
      window.localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Storage can be blocked; hiding for this visit is enough.
    }
    setClosed(true);
  }

  async function install() {
    if (!event) return;
    await event.prompt();
    await event.userChoice.catch(() => undefined);
    setEvent(null);
    setClosed(true);
  }

  if (closed || !eligible || (!event && !iosHint)) return null;
  return (
    <div role="region" aria-label="Install app" className="fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-md items-center justify-between gap-3 rounded border bg-white p-3 text-sm shadow-lg">
      <span>
        {event ? "Install MK AI Travel on this device for quick access." : "Install: tap Share, then Add to Home Screen."}
      </span>
      <span className="flex shrink-0 gap-2">
        {event && <button onClick={() => void install()} className="rounded bg-blue-600 px-3 py-1 text-white">Install</button>}
        <button onClick={dismiss} className="rounded border px-3 py-1">Not now</button>
      </span>
    </div>
  );
}
