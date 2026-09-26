import type { VaultCategory } from "./api";

export const VAULT_CATEGORIES: Record<VaultCategory, string> = {
  email: "Email",
  social_media: "Social Media",
  banking: "Banking",
  education: "Education",
  work: "Work",
  shopping: "Shopping",
  government: "Government",
  hosting: "Hosting",
  other: "Other",
};

export const AUDIT_LABELS: Record<string, string> = {
  entry_created: "Entry created",
  entry_updated: "Entry updated",
  entry_deleted: "Entry deleted",
  secret_revealed: "Password revealed",
  secret_copied: "Password copied",
  vault_unlocked: "Vault unlocked",
  unlock_failed: "Unlock failed",
  vault_locked: "Vault locked",
};

/** How long a revealed password stays visible, and when a copied one is cleared. */
export const REVEAL_SECONDS = 20;
export const CLIPBOARD_CLEAR_SECONDS = 30;

/** Only ever link to http(s) URLs (the server enforces this too). */
export function safeHref(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch {
    return null;
  }
}
