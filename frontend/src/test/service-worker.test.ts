/// <reference types="node" />
/**
 * Runs public/sw.js in a simulated service-worker scope to prove its privacy rule:
 * API responses (personal data) are never intercepted or cached; only the app shell is.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

type Listener = (event: Record<string, unknown>) => void;

function loadServiceWorker() {
  const listeners: Record<string, Listener> = {};
  const stored = new Map<string, Response>();
  const cache = {
    addAll: vi.fn(async (urls: string[]) => urls.forEach((u) => stored.set(u, new Response(`shell:${u}`)))),
    put: vi.fn(async (key: Request | string, response: Response) => void stored.set(typeof key === "string" ? key : new URL(key.url).pathname, response)),
    match: vi.fn(async (key: Request | string) => stored.get(typeof key === "string" ? key : new URL(key.url).pathname)),
  };
  const caches = {
    open: vi.fn(async () => cache),
    keys: vi.fn(async () => ["lifevault-shell-v1", "old-cache"]),
    delete: vi.fn(async () => true),
    match: vi.fn(async (key: string) => stored.get(key)),
  };
  const fetchMock = vi.fn(async (request: Request | string) => new Response(`network:${typeof request === "string" ? request : new URL(request.url).pathname}`));
  const self = {
    location: { origin: "https://lifevault.example" },
    addEventListener: (type: string, fn: Listener) => void (listeners[type] = fn),
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn() },
  };
  const source = readFileSync(resolve(process.cwd(), "public/sw.js"), "utf8");
  vm.runInNewContext(source, { self, caches, fetch: fetchMock, URL, Response, Promise });

  async function dispatchFetch(path: string, init: { method?: string; mode?: string; origin?: string } = {}) {
    let responded: Promise<Response> | null = null;
    const request = { url: `${init.origin ?? "https://lifevault.example"}${path}`, method: init.method ?? "GET", mode: init.mode ?? "cors" };
    listeners.fetch({ request, respondWith: (p: Promise<Response>) => void (responded = p) });
    return responded ? await (responded as Promise<Response>) : null;
  }
  return { listeners, stored, cache, caches, fetchMock, dispatchFetch };
}

describe("service worker", () => {
  it("never intercepts or caches API requests", async () => {
    const sw = loadServiceWorker();
    for (const path of ["/api/vault/entries", "/api/expenses?page=1", "/api/auth/me", "/api/documents/1/download"]) {
      expect(await sw.dispatchFetch(path)).toBeNull(); // the browser handles it normally
    }
    expect(await sw.dispatchFetch("/api/notes", { method: "POST" })).toBeNull();
    expect(sw.cache.put).not.toHaveBeenCalled();
    expect([...sw.stored.keys()].some((k) => k.startsWith("/api"))).toBe(false);
  });

  it("ignores other origins and non-GET requests", async () => {
    const sw = loadServiceWorker();
    expect(await sw.dispatchFetch("/assets/x.js", { origin: "https://cdn.example" })).toBeNull();
    expect(await sw.dispatchFetch("/assets/x.js", { method: "POST" })).toBeNull();
  });

  it("serves pages from the network, and the cached shell when offline", async () => {
    const sw = loadServiceWorker();
    const online = await sw.dispatchFetch("/dashboard", { mode: "navigate" });
    expect(await online!.text()).toBe("network:/dashboard");
    sw.stored.set("/", new Response("cached shell"));
    sw.fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    const offline = await sw.dispatchFetch("/expenses", { mode: "navigate" });
    expect(await offline!.text()).toBe("cached shell");
  });

  it("caches hashed build assets", async () => {
    const sw = loadServiceWorker();
    const first = await sw.dispatchFetch("/assets/index-abc123.js");
    expect(await first!.text()).toBe("network:/assets/index-abc123.js");
    await Promise.resolve();
    expect(sw.cache.put).toHaveBeenCalledTimes(1);
  });

  it("precaches only shell files on install and removes old caches on activate", async () => {
    const sw = loadServiceWorker();
    let installing: Promise<unknown> = Promise.resolve();
    sw.listeners.install({ waitUntil: (p: Promise<unknown>) => void (installing = p) });
    await installing;
    const precached = sw.cache.addAll.mock.calls[0][0] as string[];
    expect(precached.every((u) => !u.startsWith("/api"))).toBe(true);
    let activating: Promise<unknown> = Promise.resolve();
    sw.listeners.activate({ waitUntil: (p: Promise<unknown>) => void (activating = p) });
    await activating;
    expect(sw.caches.delete).toHaveBeenCalledWith("old-cache");
    expect(sw.caches.delete).not.toHaveBeenCalledWith("lifevault-shell-v1");
  });
});
