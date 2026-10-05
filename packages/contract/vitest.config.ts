/**
 * Without a config here vitest walks up to the app's root `vite.config.ts`, whose setup imports
 * `src/i18n` and dies on `window.localStorage` in a Node run — every file in the package then fails
 * to *collect*, which looks like a code error rather than a harness one. Same shape as
 * `packages/config/vitest.config.ts`.
 */
export default {
  test: {
    environment: "node",
  },
}
