/**
 * Node-environment tests, the same shape as `packages/cli-runtime/vitest.config.ts`: without a config here vitest
 * walks up to the app's root `vite.config.ts`, whose setup imports `src/i18n` and dies on
 * `window.localStorage.setItem` — Node 26 defines `window` but leaves `localStorage` undefined unless
 * `--localstorage-file` is passed.
 *
 * The alias and `server.deps.inline` are for the OpenTUI test: `react-reconciler@0.33.0` ships `constants.js` with no
 * `exports` map, and Node's ESM loader will not infer the extension that `@opentui/react`'s bundled chunk imports.
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
