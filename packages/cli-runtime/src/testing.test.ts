import { join } from "node:path"
import { describe, expect, test } from "vitest"

import { createMemoryCliHost } from "./testing.js"

/**
 * Why these two assertions exist: a CLI test that checks a clean stderr was measured passing on one machine
 * and failing on another, because the config loader prints a "loaded with overrides" hint when the user's
 * own `xiranite.config.toml` has a `[nodes.<id>]` block. The default below is what stops that, so it has to
 * be pinned or the next person can quietly restore the inheritance.
 */
describe("createMemoryCliHost", () => {
  test("does not inherit the operator's own config by default", () => {
    const original = process.env.XIRANITE_CONFIG_PATH
    delete process.env.XIRANITE_CONFIG_PATH
    try {
      const host = createMemoryCliHost()
      // The point of the fixture name: nothing on disk answers to it, so the loader finds no overrides.
      expect(host.env.XIRANITE_CONFIG_PATH).toBe(join(process.cwd(), "artifacts/test-runs/cli-runtime-missing-config.toml"))
    } finally {
      if (original !== undefined) process.env.XIRANITE_CONFIG_PATH = original
    }
  })

  test("an explicit config path from the caller still wins", () => {
    const host = createMemoryCliHost({ configPath: "/tmp/caller-config.toml" })
    expect(host.env.XIRANITE_CONFIG_PATH).toBe("/tmp/caller-config.toml")

    const viaEnv = createMemoryCliHost({ env: { XIRANITE_CONFIG_PATH: "/tmp/env-config.toml" } })
    expect(viaEnv.env.XIRANITE_CONFIG_PATH).toBe("/tmp/env-config.toml")
  })

  test("a caller that sets an inherited environment keeps everything else in it", () => {
    const host = createMemoryCliHost({ env: { XIRANITE_ONLY: "1" } })
    expect(host.env.XIRANITE_ONLY).toBe("1")
    expect(host.env.PATH).toBe(process.env.PATH)
  })
})
