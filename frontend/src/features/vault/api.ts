import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, apiFetch } from "@/lib/api";

export type VaultCategory = "email" | "social_media" | "banking" | "education" | "work" | "shopping" | "government" | "hosting" | "other";

export interface VaultStatus {
  configured: boolean;
  unlocked: boolean;
  unlocked_until: string | null;
  unlock_minutes: number;
}

/** A vault entry as lists/details return it. There is no password here, by design. */
export interface VaultEntry {
  id: string;
  website: string;
  url: string | null;
  category: VaultCategory;
  username: string | null;
  email: string | null;
  is_favorite: boolean;
  has_notes: boolean;
  password_changed_at: string;
  created_at: string;
  updated_at: string;
  notes?: string | null; // detail only
}

export interface VaultEntryInput {
  website: string;
  url: string | null;
  username: string | null;
  email: string | null;
  /** null when editing = keep the current password */
  password: string | null;
  category: VaultCategory;
  notes: string | null;
  is_favorite: boolean;
}

export interface VaultList {
  items: VaultEntry[];
  counts: Record<string, number>;
}

export interface AuditEntry {
  id: string;
  action: string;
  entry_id: string | null;
  entry_label: string | null;
  ip_address: string | null;
  created_at: string;
}

export const VAULT_STATUS_KEY = ["vault", "status"] as const;

export const useVaultStatus = () =>
  useQuery({ queryKey: VAULT_STATUS_KEY, queryFn: () => apiFetch<VaultStatus>("/api/vault/status"), staleTime: 0 });

export const isLocked = (error: unknown) => error instanceof ApiError && error.status === 423;

export const useVaultEntries = (enabled: boolean, filters: { search?: string; category?: string; favorites?: boolean }) =>
  useQuery({
    queryKey: ["vault", "entries", filters],
    queryFn: () => {
      const params = new URLSearchParams();
      if (filters.search) params.set("search", filters.search);
      if (filters.category) params.set("category", filters.category);
      if (filters.favorites) params.set("favorites", "true");
      const qs = params.toString();
      return apiFetch<VaultList>(`/api/vault/entries${qs ? `?${qs}` : ""}`);
    },
    enabled,
    placeholderData: keepPreviousData,
    gcTime: 0, // don't keep decrypted usernames around after leaving the page
  });

export const useVaultEntry = (id: string | null) =>
  useQuery({
    queryKey: ["vault", "entry", id],
    queryFn: () => apiFetch<VaultEntry>(`/api/vault/entries/${id}`),
    enabled: id !== null,
    gcTime: 0,
  });

export const useVaultAudit = (enabled: boolean) =>
  useQuery({ queryKey: ["vault", "audit"], queryFn: () => apiFetch<AuditEntry[]>("/api/vault/audit?limit=20"), enabled, gcTime: 0 });

export function useVaultMutations() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["vault"] });
  return {
    unlock: useMutation({
      // A wrong password is a 401 here; it must not end the whole app session.
      mutationFn: (password: string) => apiFetch<VaultStatus>("/api/vault/unlock", { method: "POST", body: { password }, skipAuthRedirect: true }),
      onSuccess: (status) => {
        queryClient.setQueryData(VAULT_STATUS_KEY, status);
        return refresh();
      },
    }),
    lock: useMutation({
      mutationFn: () => apiFetch<void>("/api/vault/lock", { method: "POST" }),
      onSettled: () => {
        // Drop anything decrypted that might still be cached.
        queryClient.removeQueries({ queryKey: ["vault", "entries"] });
        queryClient.removeQueries({ queryKey: ["vault", "entry"] });
        return queryClient.invalidateQueries({ queryKey: VAULT_STATUS_KEY });
      },
    }),
    save: useMutation({
      mutationFn: ({ id, input }: { id?: string; input: VaultEntryInput }) =>
        apiFetch<VaultEntry>(id ? `/api/vault/entries/${id}` : "/api/vault/entries", { method: id ? "PUT" : "POST", body: input }),
      onSettled: refresh,
    }),
    favorite: useMutation({
      mutationFn: ({ id, is_favorite }: { id: string; is_favorite: boolean }) =>
        apiFetch<VaultEntry>(`/api/vault/entries/${id}/favorite`, { method: "PATCH", body: { is_favorite } }),
      onSettled: refresh,
    }),
    remove: useMutation({
      mutationFn: (id: string) => apiFetch<void>(`/api/vault/entries/${id}`, { method: "DELETE" }),
      onSettled: refresh,
    }),
  };
}

/** Decrypt ONE password on demand. A mutation, never a cached query: the result lives only in
 * the calling component's state and is dropped when it's hidden or unmounted. Audited server-side. */
export function useRevealPassword() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, purpose }: { id: string; purpose: "reveal" | "copy" }) =>
      apiFetch<{ password: string }>(`/api/vault/entries/${id}/reveal`, { method: "POST", body: { purpose } }),
    onError: (error) => {
      if (isLocked(error)) void queryClient.invalidateQueries({ queryKey: VAULT_STATUS_KEY });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["vault", "audit"] }),
    gcTime: 0,
  });
}
