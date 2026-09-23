/** Only allow same-origin, path-only redirects (blocks `//evil.com`, `/\evil.com` and `https://...`). */
export function safeRedirectPath(value: unknown, fallback = "/dashboard"): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return fallback;
  }
  return value;
}
