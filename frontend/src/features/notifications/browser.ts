/** Safe wrapper around the browser Notification API, which isn't available everywhere (e.g. iOS Safari tabs). */

export type BrowserPermission = NotificationPermission | "unsupported";

export function browserSupport(): BrowserPermission {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return window.Notification.permission;
}

export async function requestBrowserPermission(): Promise<BrowserPermission> {
  if (browserSupport() === "unsupported") return "unsupported";
  try {
    return await window.Notification.requestPermission();
  } catch {
    return browserSupport();
  }
}

/** Shows a system notification. `tag` stops the same one appearing twice (e.g. from two open tabs). */
export function showBrowserNotification(title: string, body: string, tag: string, onClick?: () => void) {
  if (browserSupport() !== "granted") return false;
  try {
    const n = new window.Notification(title, { body, tag, icon: "/favicon.svg" });
    if (onClick) {
      n.onclick = () => {
        window.focus();
        onClick();
        n.close();
      };
    }
    return true;
  } catch {
    // Some browsers only allow notifications from a service worker; the in-app center still works.
    return false;
  }
}
