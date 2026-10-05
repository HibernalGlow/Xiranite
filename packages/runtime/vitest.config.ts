/**
 * Node-environment tests, the same shape as `packages/cli-runtime/vitest.config.ts`: without a config here
 * vitest walks up to the app's root `vite.config.ts`, whose browser setup is not what these module-loader and
 * node-preparer tests exercise (they drive real `node:` fs and child processes).
 */
export default {
  test: {
    environment: "node",
  },
}
