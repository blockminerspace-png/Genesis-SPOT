import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const root = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(root, "..");

const apiPrefixes = [
  "/health",
  "/auth",
  "/bot",
  "/cycles",
  "/orders",
  "/events",
  "/portfolio",
  "/market",
  "/reconciliation",
  "/live-cycle",
  "/bot-spot",
  "/strategy",
] as const;

/** Em dev (5173), `/login` deve servir o mesmo `index.html` que `/`. */
function loginSpaFallback(): Plugin {
  return {
    name: "genesis-spa-login-fallback",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const raw = req.url?.split("?")[0] ?? "";
        const spa =
          raw === "/login" || raw.startsWith("/bot-spot") || raw.startsWith("/legacy");
        if (spa) req.url = "/" + (req.url?.includes("?") ? `?${req.url.split("?").slice(1).join("?")}` : "");
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), loginSpaFallback()],
  root,
  publicDir: false,
  server: {
    port: 5173,
    strictPort: true,
    fs: { allow: [repoRoot] },
    proxy: Object.fromEntries(
      apiPrefixes.map((p) => [p, { target: "http://127.0.0.1:3000", changeOrigin: true }]),
    ),
  },
  build: {
    outDir: path.resolve(repoRoot, "public/dashboard"),
    emptyOutDir: true,
    assetsDir: "dash-assets",
  },
});
