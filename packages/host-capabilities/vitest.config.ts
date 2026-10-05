import { defineConfig } from "vitest/config"

// A package-local config: the root vite.config.ts only collects `src/**` under the app, so a package without
// this file reports "No test files found" and every gate that shells out to `bun run test` looks green.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    pool: "forks",
    fileParallelism: false,
  },
})
