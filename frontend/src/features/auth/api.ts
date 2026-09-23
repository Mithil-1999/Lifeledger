import { ApiError, apiFetch } from "@/lib/api";

export interface User {
  id: string;
  name: string;
  username: string;
  email: string;
  status: string;
  created_at: string;
  last_login_at: string | null;
}

export interface AuthConfig {
  registration_enabled: boolean;
  password_min_length: number;
}

export interface LoginInput {
  identifier: string;
  password: string;
  remember_me: boolean;
}

export interface RegisterInput {
  name: string;
  username: string;
  email: string;
  password: string;
  confirm_password: string;
}

export interface ChangePasswordInput {
  current_password: string;
  new_password: string;
  confirm_new_password: string;
}

export interface ResetPasswordInput {
  token: string;
  new_password: string;
  confirm_new_password: string;
}

/** The signed-in user, or null when not authenticated. */
export async function fetchCurrentUser(): Promise<User | null> {
  try {
    return await apiFetch<User>("/api/auth/me", { skipAuthRedirect: true });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

export const fetchAuthConfig = () => apiFetch<AuthConfig>("/api/auth/config");

export const login = (input: LoginInput) =>
  apiFetch<User>("/api/auth/login", { method: "POST", body: input, skipAuthRedirect: true });

export const register = (input: RegisterInput) =>
  apiFetch<User>("/api/auth/register", { method: "POST", body: input, skipAuthRedirect: true });

export const logout = () => apiFetch<void>("/api/auth/logout", { method: "POST", skipAuthRedirect: true });

export const forgotPassword = (email: string) =>
  apiFetch<{ message: string }>("/api/auth/forgot-password", { method: "POST", body: { email } });

export const resetPassword = (input: ResetPasswordInput) =>
  apiFetch<void>("/api/auth/reset-password", { method: "POST", body: input, skipAuthRedirect: true });

export const changePassword = (input: ChangePasswordInput) =>
  apiFetch<{ message: string }>("/api/auth/change-password", { method: "POST", body: input });
