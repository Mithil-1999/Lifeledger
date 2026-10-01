/**
 * Installable app (PWA) support: service worker registration and the install prompt.
 *
 * The service worker only caches the app shell (see public/sw.js); API data is never cached.
 */
import * as React from "react";

/** Chrome/Edge/Android fire this when the app can be installed; it isn't in the TS DOM types. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export type InstallState =
  | { kind: "installed" } // already running as an installed app
  | { kind: "available" } // the browser can show its install dialog
  | { kind: "ios" } // iPhone/iPad: install through Share → Add to Home Screen
  | { kind: "manual" }; // other browsers: use the browser menu, if it supports installing

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

function isStandalone() {
  if (typeof window === "undefined") return false;
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia?.("(display-mode: standalone)").matches === true;
}

function isIos() {
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac, but with touch support.
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
}

/** Call once at startup, before React renders, so an early install event isn't missed. */
export function initPwa() {
  if (typeof window === "undefined") return;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault(); // show our own button instead of the browser's mini-bar
    deferredPrompt = event as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    installed = true;
    deferredPrompt = null;
    notify();
  });
  // Only production builds get a service worker (in development it would cache stale code).
  if (import.meta.env.PROD && "serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Not fatal: the app works the same without it, it just can't be installed.
      });
    });
  }
}

export function getInstallState(): InstallState {
  if (installed || isStandalone()) return { kind: "installed" };
  if (deferredPrompt) return { kind: "available" };
  if (isIos()) return { kind: "ios" };
  return { kind: "manual" };
}

/** Opens the browser's install dialog. Resolves to true if the user accepted. */
export async function promptInstall(): Promise<boolean> {
  const event = deferredPrompt;
  if (!event) return false;
  deferredPrompt = null;
  await event.prompt();
  const { outcome } = await event.userChoice;
  if (outcome === "accepted") installed = true;
  notify();
  return outcome === "accepted";
}

let cachedKind: InstallState["kind"] | null = null;
let cachedState: InstallState = { kind: "manual" };

function snapshot(): InstallState {
  const state = getInstallState();
  if (state.kind !== cachedKind) {
    cachedKind = state.kind;
    cachedState = state;
  }
  return cachedState;
}

export function useInstallState(): InstallState {
  return React.useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    snapshot,
    snapshot,
  );
}

/** Test helper: simulate the browser offering installation. */
export function _setDeferredPromptForTests(event: BeforeInstallPromptEvent | null) {
  deferredPrompt = event;
  installed = false;
  notify();
}
