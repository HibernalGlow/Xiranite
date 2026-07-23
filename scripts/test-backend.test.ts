import { access } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"

import {
  DEFAULT_TEST_BACKEND_TTL_SECONDS,
  parseTestBackendCliOptions,
  startIsolatedTestBackend,
} from "./test-backend"

describe("isolated test backend", () => {
  test("uses a bounded TTL", () => {
    expect(parseTestBackendCliOptions([])).toEqual({ ttlSeconds: DEFAULT_TEST_BACKEND_TTL_SECONDS })
    expect(parseTestBackendCliOptions(["--ttl-seconds", "30"])).toEqual({ ttlSeconds: 30 })
    expect(() => parseTestBackendCliOptions(["--ttl-seconds", "0"])).toThrow()
    expect(() => parseTestBackendCliOptions(["--ttl-seconds", "7200"])).toThrow()
  })

  test("isolates state and removes it after close", async () => {
    const isolated = await startIsolatedTestBackend({ token: "isolated-test-token" })
    const databasePath = isolated.backend.database?.path
    try {
      expect(databasePath).toBe(join(isolated.dataDir, "xiranite.db"))
      expect(databasePath).not.toContain(join("Xiranite", "xiranite.db"))
      expect((await fetch(`${isolated.backend.url}/health`)).status).toBe(200)
      await access(databasePath!)
    } finally {
      await isolated.close()
    }
    await expect(access(isolated.dataDir)).rejects.toMatchObject({ code: "ENOENT" })
  })
})
