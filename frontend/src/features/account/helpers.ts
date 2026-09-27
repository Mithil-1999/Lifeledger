import type { SecurityEventName } from "./api";

/** "Chrome on Windows" from a user-agent string (best effort; shown for recognising your devices). */
export function describeDevice(userAgent: string | null) {
  if (!userAgent) return "Unknown device";
  const ua = userAgent;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : null;
  const os = /Windows/.test(ua)
    ? "Windows"
    : /Android/.test(ua)
      ? "Android"
      : /iPhone|iPad|iPod/.test(ua)
        ? "iOS"
        : /Mac OS X/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : null;
  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os ?? "Unknown device";
}

export const SECURITY_EVENT_LABELS: Record<SecurityEventName, string> = {
  login_succeeded: "Signed in",
  login_failed: "Failed sign-in attempt",
  logout: "Signed out",
  password_changed: "Password changed",
  password_reset: "Password reset by email",
  session_revoked: "Signed out a device",
  other_sessions_revoked: "Signed out all other devices",
  profile_updated: "Profile updated",
  email_changed: "Email changed",
  username_changed: "Username changed",
  data_exported: "Data exported",
};

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export const dateTime = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
