import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as authApi from "./api";

export const AUTH_QUERY_KEY = ["auth", "me"] as const;

export function useCurrentUser() {
  return useQuery({
    queryKey: AUTH_QUERY_KEY,
    queryFn: authApi.fetchCurrentUser,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useAuthConfig() {
  return useQuery({ queryKey: ["auth", "config"], queryFn: authApi.fetchAuthConfig, staleTime: Infinity });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: authApi.login,
    onSuccess: (user) => queryClient.setQueryData(AUTH_QUERY_KEY, user),
  });
}

export function useRegister() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: authApi.register,
    onSuccess: (user) => queryClient.setQueryData(AUTH_QUERY_KEY, user),
  });
}

/** Signs out on the server, then drops every cached query so no personal data lingers. */
export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: authApi.logout,
    onSettled: () => {
      queryClient.clear();
      queryClient.setQueryData(AUTH_QUERY_KEY, null);
    },
  });
}

export function useChangePassword() {
  return useMutation({ mutationFn: authApi.changePassword });
}

export function useForgotPassword() {
  return useMutation({ mutationFn: authApi.forgotPassword });
}

export function useResetPassword() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: authApi.resetPassword,
    // Every session is revoked server-side on reset.
    onSuccess: () => queryClient.setQueryData(AUTH_QUERY_KEY, null),
  });
}
