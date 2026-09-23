/**
 * API client.
 *
 * - In development, requests go to relative `/api/...` URLs and Vite proxies them to FastAPI,
 *   so the browser sees one origin. Set VITE_API_BASE_URL only for a different API origin.
 * - Authentication is an HttpOnly session cookie (never readable here).
 * - State-changing requests carry the CSRF token in `X-CSRF-Token`. The token is fetched
 *   lazily, kept in memory only, and updated whenever the API rotates it.
 */
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ?? "";
const CSRF_HEADER = "X-CSRF-Token";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Fired when a request that should be authenticated gets a 401 (e.g. the session expired). */
export const UNAUTHORIZED_EVENT = "lifevault:unauthorized";

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `Request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

let csrfToken: string | null = null;
let csrfRequest: Promise<string> | null = null;

async function getCsrfToken(forceRefresh = false): Promise<string> {
  if (csrfToken && !forceRefresh) return csrfToken;
  csrfRequest ??= fetch(`${API_BASE_URL}/api/auth/csrf`, { credentials: "include", headers: { Accept: "application/json" } })
    .then(async (response) => {
      if (!response.ok) throw new ApiError(response.status, null, "Could not start a secure session.");
      const body = (await response.json()) as { csrf_token: string };
      csrfToken = body.csrf_token;
      return csrfToken;
    })
    .finally(() => {
      csrfRequest = null;
    });
  return csrfRequest;
}

/** Test helper: forget the cached CSRF token. */
export function resetCsrfToken() {
  csrfToken = null;
  csrfRequest = null;
}

export interface ApiRequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  /** Don't broadcast UNAUTHORIZED_EVENT for 401s (login, "who am I" checks, ...). */
  skipAuthRedirect?: boolean;
}

async function send(path: string, options: ApiRequestOptions, retryOnCsrf: boolean): Promise<Response> {
  const { body, skipAuthRedirect: _skip, ...init } = options;
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (body !== undefined) headers.set("Content-Type", "application/json");
  if (!SAFE_METHODS.has(method)) headers.set(CSRF_HEADER, await getCsrfToken());

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "include",
  });

  const rotated = response.headers.get(CSRF_HEADER);
  if (rotated) csrfToken = rotated;

  if (response.status === 403 && retryOnCsrf && !SAFE_METHODS.has(method)) {
    const detail = await response.clone().json().catch(() => null);
    if (typeof detail?.detail === "string" && detail.detail.startsWith("CSRF")) {
      await getCsrfToken(true);
      return send(path, options, false);
    }
  }
  return response;
}

export async function apiFetch<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const response = await send(path, options, true);
  const isJson = response.headers.get("content-type")?.includes("application/json");
  const data: unknown = isJson ? await response.json().catch(() => null) : null;

  if (!response.ok) {
    if (response.status === 401 && !options.skipAuthRedirect) {
      window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
    }
    throw new ApiError(response.status, data, errorMessageFromBody(response.status, data));
  }
  return data as T;
}

interface ValidationErrorItem {
  loc?: (string | number)[];
  msg?: string;
}

/** Turn an API error body into a message that is safe and useful to show. */
function errorMessageFromBody(status: number, body: unknown): string {
  const detail = (body as { detail?: unknown } | null)?.detail;
  const errors = (body as { errors?: ValidationErrorItem[] } | null)?.errors;
  if (Array.isArray(errors) && errors.length) return errors.map((e) => e.msg).filter(Boolean).join(" ");
  if (typeof detail === "string") return detail;
  if (detail && typeof detail === "object" && "message" in detail) return String((detail as { message: unknown }).message);
  if (status === 429) return "Too many attempts. Please wait a moment and try again.";
  if (status >= 500) return "Something went wrong on our side. Please try again.";
  return "Request failed. Please try again.";
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof TypeError) return "Can't reach the LifeVault server. Check your connection and try again.";
  return "Something went wrong. Please try again.";
}

/** For 409/422 responses: map a server error to the form field it belongs to. */
export function getFieldError(error: unknown): { field: string; message: string } | null {
  if (!(error instanceof ApiError)) return null;
  const body = error.body as { detail?: { field?: string; message?: string } } | null;
  if (body?.detail && typeof body.detail === "object" && body.detail.field && body.detail.message) {
    return { field: body.detail.field, message: body.detail.message };
  }
  return null;
}
