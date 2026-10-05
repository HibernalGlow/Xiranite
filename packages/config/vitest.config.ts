/**
 * Node-environment tests, the same shape as `packages/runtime/vitest.config.ts` and
 * `packages/cli/vitest.config.ts`: without a config here vitest walks up to the app's root
 * `vite.config.ts`, whose setup imports `src/i18n` and dies on `window.localStorage` in a Node run
 * (measured on this tree: every test file in the package fails to *collect*, so nothing runs and the
 * failure looks like a code error rather than a harness one).
 *
 * These files drive real `node:fs` — the lock sibling, the temp+rename replace, symlinked config paths —
 * which is exactly what a browser environment does not model.
 */
export default {
  test: {
    environment: "node",
  },
}
