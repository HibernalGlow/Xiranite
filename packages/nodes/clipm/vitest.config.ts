import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/worker-manager.test.ts", "src/mcp-client.integration.test.ts"],
    maxWorkers: 1,
  },
})
