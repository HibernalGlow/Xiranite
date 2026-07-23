import { access, readFile } from "node:fs/promises"
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
    const previousNodeSource = process.env.XIRANITE_NODE_SOURCE
    delete process.env.XIRANITE_NODE_SOURCE
    const isolated = await startIsolatedTestBackend({ token: "isolated-test-token" })
    const databasePath = isolated.backend.database?.path
    try {
      expect(databasePath).toBe(join(isolated.dataDir, "xiranite.db"))
      expect(databasePath).not.toContain(join("Xiranite", "xiranite.db"))
      expect(process.env.XIRANITE_NODE_SOURCE).toBe("1")
      expect((await fetch(`${isolated.backend.url}/health`)).status).toBe(200)
      await access(databasePath!)
    } finally {
      await isolated.close()
    }
    if (previousNodeSource === undefined) delete process.env.XIRANITE_NODE_SOURCE
    else process.env.XIRANITE_NODE_SOURCE = previousNodeSource
    await expect(access(isolated.dataDir)).rejects.toMatchObject({ code: "ENOENT" })
  })

  test("persists NeoView source config patches instead of reading stale dist behavior", async () => {
    const isolated = await startIsolatedTestBackend({ token: "neoview-source-test-token" })
    try {
      const response = await fetch(`${isolated.backend.url}/reader/config`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-xiranite-token": isolated.backend.token,
        },
        body: JSON.stringify({ superResolution: { preferences: { preloadPages: 10 } } }),
      })
      expect(response.status).toBe(200)
      const config = await response.json() as { superResolution: { preferences: { preloadPages: number } } }
      expect(config.superResolution.preferences.preloadPages).toBe(10)
      expect(await readFile(join(isolated.dataDir, "xiranite.config.toml"), "utf8")).toContain("preload_pages = 10")
    } finally {
      await isolated.close()
    }
  })
})
