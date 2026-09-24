import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup, configure } from "@testing-library/react";

// Full-app renders (router + guards + dashboard) can be slow in jsdom, and the first
// dashboard render in each worker also compiles Recharts on demand (several seconds cold).
// Passing assertions resolve as soon as the element appears, so this only affects failures.
configure({ asyncUtilTimeout: 8000 });

afterEach(() => {
  cleanup();
  localStorage.clear();
});

// jsdom lacks matchMedia and ResizeObserver, which the theme provider and Radix use.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
