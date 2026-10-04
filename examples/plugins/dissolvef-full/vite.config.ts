/**
 * Build config for the full-form example plugin.
 *
 * Identical in shape to `examples/plugins/frontend-only/vite.config.ts` on purpose: the frontend half
 * of a full plugin is the *same* remote contract, and the backend being Extism-hosted must not change
 * how the UI is built (`docs/plugin-architecture.md` §2.2). The only differences are the federation
 * name and the preview port, so both examples can be served at once.
 *
 * `import: false` on every shared subpath is what keeps a private React copy out of this bundle — the
 * plugin must render with the host's React, and a second `react-dom/client` is the classic
 * two-React failure.
 */

import { federation } from "@module-federation/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const REACT_VERSION = "19.2.4"

export default defineConfig({
  plugins: [
    react(),
    federation({
      name: "dissolvef_full",
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
    // The host page is on another origin (`http://localhost:5173` in dev), and a `type: "module"`
    // remote is fetched with `import()`, which needs CORS on the serving side.
    cors: true,
    headers: { "access-control-allow-origin": "*" },
  },
})
