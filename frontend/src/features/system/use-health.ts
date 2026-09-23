import { useQuery } from "@tanstack/react-query";
import { ApiError, apiFetch } from "@/lib/api";

export interface HealthResponse {
  status: "ok" | "degraded";
  service: string;
  version: string;
  environment: string;
  database: "ok" | "unavailable";
}

async function fetchHealth(): Promise<HealthResponse> {
  try {
    return await apiFetch<HealthResponse>("/api/health");
  } catch (error) {
    // 503 still carries a health body (API up, database down): surface it as data, not an error.
    if (error instanceof ApiError && error.status === 503 && error.body) return error.body as HealthResponse;
    throw error;
  }
}

export function useHealth() {
  return useQuery({
    queryKey: ["system", "health"],
    queryFn: fetchHealth,
    refetchInterval: 30_000,
    retry: 1,
  });
}
