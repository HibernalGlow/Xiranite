/**
 * Node-environment tests, same shape as `packages/quickjs-shims/vitest.config.ts`.
 *
 * Without a config in this directory vitest walks up and loads the app's root `vite.config.ts`, whose include
 * pattern is resolved against this package and whose setupFiles import the app's i18n, which touches
 * `window.localStorage` in a Node environment. Host attach (`src/backend.ts`) is the transport every terminal
 * face depends on, so its tests must actually run.
 */
export default {
  test: {
    environment: "node",
  },
}
