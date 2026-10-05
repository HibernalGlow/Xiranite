/**
 * Node-environment tests, the same shape as `packages/cli-runtime/vitest.config.ts`: without a config here
 * vitest walks up to the app's root `vite.config.ts`, whose setup imports `src/i18n` and dies on
 * `window.localStorage` in a Node run (measured: all three test files fail to collect).
 *
 * Two extra knobs, both for the OpenTUI test:
 * - `server.deps.inline` for `@opentui/react`, because its bundled chunk imports `react-reconciler/constants`,
 *   and `react-reconciler@0.33.0` ships `constants.js` with no `exports` map — Node's ESM loader will not infer
 *   the extension, so an externalized import throws `Cannot find module`.
 * - the matching alias, which only takes effect once the importer is processed by vite rather than Node.
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
