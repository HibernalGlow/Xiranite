/**
 * Build config for the frontend-only example plugin.
 *
 * Why Vite 7 here while the host is on Vite 8: the host consumes this artifact through the Module
 * Federation **runtime** and never builds with a federation plugin (`@module-federation/rolldown`
 * does not exist), so the plugin side stays on the toolchain line whose federation output is
 * best-covered. Swapping this to Rspack + `@module-federation/rspack` changes nothing for the host —
 * which is exactly the point of `docs/plugin-architecture.md` §2.2: the bundler is the plugin
 * author's choice, not part of the Xiranite contract.
 *
 * `import: false` on the shared entries is what stops a private copy of React ending up in this
 * bundle: the plugin must render with the host's React instance.
 */

import { federation } from "@module-federation/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const REACT_VERSION = "19.2.4"

export default defineConfig({
  plugins: [
    react(),
    federation({
      name: "poc_frontend",
      filename: "remoteEntry.js",
      manifest: true,
      exposes: { "./entry": "./src/entry.tsx" },
      shared: {
        react: { singleton: true, requiredVersion: REACT_VERSION, import: false },
        "react-dom": { singleton: true, requiredVersion: REACT_VERSION, import: false },
        "react-dom/client": { singleton: true, requiredVersion: REACT_VERSION, import: false },
        "react/jsx-runtime": { singleton: true, requiredVersion: REACT_VERSION, import: false },
      },
    }),
  ],
  build: {
    target: "esnext",
    minify: false,
  },
  preview: {
    // The host page runs on a different origin (`http://localhost:5173` in dev, `tauri://localhost`
    // in the desktop shell), and an ESM remote is fetched with `import()`, which needs CORS.
    cors: true,
    headers: { "access-control-allow-origin": "*" },
  },
})
