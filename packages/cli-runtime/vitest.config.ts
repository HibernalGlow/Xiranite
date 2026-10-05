/**
 * Node-environment tests, same shape as `packages/quickjs-shims/vitest.config.ts`.
 *
 * Without a config in this directory vitest walks up and loads the app's root `vite.config.ts`, whose include
 * pattern is resolved against this package and whose setupFiles import the app's i18n, which touches
 * `window.localStorage` in a Node environment. Host attach (`src/backend.ts`) is the transport every terminal
 * face depends on, so its tests must actually run.
 *
 * The alias and `server.deps.inline` below are for the OpenTUI suites in `src/tui/opentui/`:
 * `react-reconciler@0.33.0` ships `constants.js` with no `exports` map, so Node's ESM loader refuses the
 * extensionless `react-reconciler/constants` import inside `@opentui/react`'s bundled chunk (measured:
 * `Cannot find module ... Did you mean to import "react-reconciler/constants.js"?`). Inlining that package is what
 * lets vite resolve it, and then the alias applies.
 */
export default {
  resolve: {
    alias: {
      "react-reconciler/constants": "react-reconciler/constants.js",
    },
  },
  test: {
    server: {
      deps: {
        inline: [/@opentui\/react/],
      },
    },
    environment: "node",
  },
}
