/**
 * Node-environment tests, the same shape as `packages/cli-runtime/vitest.config.ts`.
 *
 * Without a config here vitest walks up to the app's root `vite.config.ts`, whose setup imports `src/i18n` and dies
 * on `window.localStorage.setItem` — Node 26 defines `window` but leaves `localStorage` undefined unless
 * `--localstorage-file` is passed. Measured here: this package's OpenTUI test failed to collect with
 * `Cannot find module '.../react-reconciler/constants' imported from '.../@opentui/react/chunk-hjtp6jv9.js'`, while
 * its other test files did collect, because none of them reaches `src/i18n`.
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
