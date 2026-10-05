/**
 * Node-environment tests for this package. The three non-Tui files already collected fine without it (measured:
 * `vitest run src --exclude src/Tui.bun.test.tsx` was green), so this config exists for the OpenTUI test:
 * `react-reconciler@0.33.0` ships `constants.js` with no `exports` map, and Node's ESM loader will not infer the
 * extension that `@opentui/react`'s bundled chunk imports — hence the alias plus `server.deps.inline`, which is what
 * makes vite (rather than Node) resolve that import.
 */
export default {
  resolve: {
    alias: {
      "react-reconciler/constants": "react-reconciler/constants.js",
    },
  },
  test: {
    environment: "node",
    server: {
      deps: {
        inline: [/@opentui\/react/],
      },
    },
  },
}
