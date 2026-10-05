/**
 * Node-environment tests, same shape as `packages/native-loader/vitest.config.ts`: these files drive the shim
 * against the real `node:events` in the same process, so they need a plain Node environment and no browser setup.
 */
export default {
  test: {
    environment: "node",
  },
}
