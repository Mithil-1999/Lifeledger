/**
 * Minimal API client. In development, requests go to relative `/api/...` URLs and the
 * Vite dev server proxies them to FastAPI, so the browser sees a single origin.
 * Set VITE_API_BASE_URL only if the API is served from a different origin.
 */
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ?? "";

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

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
    credentials: "include",
  });

  const isJson = response.headers.get("content-type")?.includes("application/json");
  const body: unknown = isJson ? await response.json().catch(() => null) : null;

  if (!response.ok) throw new ApiError(response.status, body);
  return body as T;
}
