/**
 * Node-environment tests, same shape as `packages/quickjs-shims/vitest.config.ts`.
 *
 * This package used to answer `bun run build` for `test`, so nothing in `src/*.test.ts` ever ran: the root
 * `vite.config.ts` collects only `src/**` of the app, and its `setupFiles` import the app's i18n, which throws
 * in a Node environment. These files drive HTTP clients against a real `node:http` listener, so they need a
 * plain Node environment and no browser setup.
 */
export default {
  test: {
    environment: "node",
  },
}
