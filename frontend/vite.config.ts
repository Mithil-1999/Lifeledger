/// <reference types="vitest/config" />
import { fileURLToPath, URL } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  // Read VITE_* vars from the repo-root .env (shared with the backend) and the process env.
  const env = { ...loadEnv(mode, fileURLToPath(new URL("..", import.meta.url)), "VITE_"), ...process.env };
  const apiTarget = env.VITE_API_PROXY_TARGET || "http://localhost:8000";

  return {
    envDir: "..",
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    },
    server: {
      port: 5173,
      strictPort: true,
      // In development the frontend calls relative /api URLs; Vite forwards them to FastAPI.
      proxy: { "/api": { target: apiTarget, changeOrigin: true } },
    },
    build: {
      rolldownOptions: {
        output: {
          // Long-lived vendor chunks cache well across app releases.
          codeSplitting: {
            groups: [
              { name: "react", test: /node_modules[\\/](react|react-dom|scheduler|react-router)[\\/]/ },
              { name: "ui", test: /node_modules[\\/](radix-ui|@radix-ui|@floating-ui)[\\/]/ },
              { name: "vendor", test: /node_modules/ },
            ],
          },
        },
      },
    },
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: ["./src/test/setup.ts"],
      css: false,
    },
  };
});
