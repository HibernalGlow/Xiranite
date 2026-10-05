/**
 * Node-environment tests for this package. Without a config here, vitest inherits the app's root
 * `vite.config.ts` `test` block (happy-dom plus the i18n setup file), which is not what these tests exercise.
 *
 * The two OpenTUI knobs are the load-bearing part, measured on macOS: the converted test died with
 * `Cannot find module .../react-reconciler/constants imported from .../@opentui/react/chunk-*.js` because
 * `react-reconciler@0.33.0` ships `constants.js` with no `exports` map and Node's ESM loader will not infer the
 * extension. `server.deps.inline` hands that import to vite, which is what makes the alias apply.
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
