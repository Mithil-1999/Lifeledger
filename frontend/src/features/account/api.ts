import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AUTH_QUERY_KEY } from "@/features/auth/use-auth";
import type { User } from "@/features/auth/api";
import { apiDownload, apiFetch, saveBlob } from "@/lib/api";

export type DateFormatPreference = "default" | "dmy" | "mdy" | "iso";

export interface AccountPreferences {
  currency: string;
  date_format: DateFormatPreference;
  timezone: string;
  supported_currencies: string[];
}

export interface SessionInfo {
  id: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  user_agent: string | null;
  ip_address: string | null;
  current: boolean;
}

export type SecurityEventName =
  | "login_succeeded"
  | "login_failed"
  | "logout"
  | "password_changed"
  | "password_reset"
  | "session_revoked"
  | "other_sessions_revoked"
  | "profile_updated"
  | "email_changed"
  | "username_changed"
  | "data_exported";

export interface SecurityActivityItem {
  id: string;
  event: SecurityEventName;
  ip_address: string | null;
  user_agent: string | null;
  detail: string | null;
  created_at: string;
}

export interface BackupInfo {
  counts: Record<string, number>;
  document_bytes: number;
  last_export_at: string | null;
  app_version: string;
  database_revision: string | null;
}

export interface ProfileInput {
  name: string;
  username: string;
  email: string;
  current_password?: string;
}

export type ExportScope = "all" | "personal" | "financial";

export const PREFERENCES_KEY = ["account", "preferences"] as const;

export const useAccountPreferences = () =>
  useQuery({ queryKey: PREFERENCES_KEY, queryFn: () => apiFetch<AccountPreferences>("/api/account/preferences"), staleTime: 5 * 60_000 });

export const useSessions = () => useQuery({ queryKey: ["account", "sessions"], queryFn: () => apiFetch<SessionInfo[]>("/api/account/sessions") });

export const useSecurityActivity = () =>
  useQuery({ queryKey: ["account", "activity"], queryFn: () => apiFetch<SecurityActivityItem[]>("/api/account/security-activity?limit=30") });

export const useTwoFactorStatus = () =>
  useQuery({
    queryKey: ["account", "two-factor"],
    queryFn: () => apiFetch<{ available: boolean; enabled: boolean; methods_planned: string[] }>("/api/account/two-factor"),
    staleTime: Infinity,
  });

export const useBackupInfo = () => useQuery({ queryKey: ["account", "backup"], queryFn: () => apiFetch<BackupInfo>("/api/account/backup-info") });

export function useAccountMutations() {
  const queryClient = useQueryClient();
  const setUser = (user: User) => queryClient.setQueryData(AUTH_QUERY_KEY, user);
  const refreshSecurity = () => queryClient.invalidateQueries({ queryKey: ["account"] });
  return {
    updateProfile: useMutation({
      mutationFn: (input: ProfileInput) => apiFetch<User>("/api/account/profile", { method: "PUT", body: input }),
      onSuccess: (user) => {
        setUser(user);
        return refreshSecurity();
      },
    }),
    uploadAvatar: useMutation({
      mutationFn: (file: File) => {
        const form = new FormData();
        form.append("file", file);
        return apiFetch<User>("/api/account/avatar", { method: "POST", body: form });
      },
      onSuccess: setUser,
    }),
    removeAvatar: useMutation({
      mutationFn: () => apiFetch<User>("/api/account/avatar", { method: "DELETE" }),
      onSuccess: setUser,
    }),
    revokeSession: useMutation({
      mutationFn: (id: string) => apiFetch<void>(`/api/account/sessions/${id}`, { method: "DELETE" }),
      onSuccess: refreshSecurity,
    }),
    revokeOthers: useMutation({
      mutationFn: () => apiFetch<{ count: number }>("/api/account/sessions/revoke-others", { method: "POST" }),
      onSuccess: refreshSecurity,
    }),
    savePreferences: useMutation({
      mutationFn: (input: { currency: string; date_format: DateFormatPreference }) =>
        apiFetch<AccountPreferences>("/api/account/preferences", { method: "PUT", body: input }),
      onSuccess: (prefs) => queryClient.setQueryData(PREFERENCES_KEY, prefs),
    }),
    exportData: useMutation({
      mutationFn: async ({ scope, password }: { scope: ExportScope; password: string }) => {
        const { blob, filename } = await apiDownload("/api/account/export", { method: "POST", body: { scope, password } });
        saveBlob(blob, filename);
        return filename;
      },
      onSuccess: refreshSecurity,
    }),
    deleteAccount: useMutation({
      mutationFn: ({ password, confirmation }: { password: string; confirmation: string }) =>
        apiFetch<void>("/api/account", { method: "DELETE", body: { password, confirmation } }),
      onSuccess: () => {
        queryClient.setQueryData(AUTH_QUERY_KEY, null);
        queryClient.clear();
      },
    }),
  };
}

/** Avatar image URL; the version query busts the browser cache after a change. */
export const avatarUrl = (user: Pick<User, "has_avatar" | "avatar_updated_at">) =>
  user.has_avatar ? `/api/account/avatar?v=${encodeURIComponent(user.avatar_updated_at ?? "")}` : null;
