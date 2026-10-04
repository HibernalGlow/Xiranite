/**
 * Build config for the "internal node as an MF2 remote" example (arch doc stage two).
 *
 * What makes this different from `examples/plugins/dissolvef-full`: that plugin is written against the
 * public surface only, while this one **imports the repository's own sources** — the real
 * `src/nodes/dissolvef/entry.ts`, its `Component.tsx`, `@/components/ui`, `@/nodes/shared`. That is
 * the point of the stage: prove the existing node contract loads over Module Federation with zero
 * changes to the node, because a trusted internal node is allowed to depend on the app's internals.
 *
 * Two consequences a reader should know, both recorded as gaps in `docs/plugin-architecture.md` §12:
 *   - there is **no stylesheet** in this bundle. The node is styled by the host page's Tailwind output
 *     (`plugin-host.html` imports the app's CSS, which scans `src/**`, so the classes the node uses are
 *     already generated there). A third-party plugin cannot rely on that, which is why `@xiranite/ui`
 *     is on the roadmap and this example is explicitly "internal node as remote", not "external plugin".
 *   - `react` and its subpaths stay shared with `import: false`, so the node renders with the host's
 *     React instead of a second copy.
 *
 * Module resolution needs exactly one alias: `@` → the repo's `src`. Imports of `@xiranite/*` resolve
 * through the repository's own `node_modules`, because the importing files live inside the repository
 * and the workspace packages are linked there (each package's `dist` directory is already built).
 */

import path from "node:path"

import { federation } from "@module-federation/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const repoRoot = path.resolve(__dirname, "..", "..", "..")
const REACT_VERSION = "19.2.4"

export default defineConfig({
  resolve: {
    alias: [{ find: "@", replacement: path.resolve(repoRoot, "src") }],
  },
  plugins: [
    react(),
    federation({
      // Must equal the `plugin` id the host page registers, so the manifest self-describes with the
      // same name the loader asks for.
      name: "dissolvef",
      filename: "remoteEntry.js",
      manifest: true,
      exposes: { "./entry": "./src/entry.ts" },
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
    cors: true,
    headers: { "access-control-allow-origin": "*" },
  },
})
