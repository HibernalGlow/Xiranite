import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { ReaderInputBindingsConfigService } from "./ReaderInputBindingsConfigService.js"

describe("ReaderInputBindingsConfigService", () => {
  const roots: string[] = []
  afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

  it("[neoview.bindings.config-service] atomically inspects, applies and resets multiple bindings", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-input-bindings-"))
    roots.push(root)
    const configPath = join(root, "xiranite.config.toml")
    const service = new ReaderInputBindingsConfigService({ configPath })
    const bindings = [
      { id: "key-next", action: "reader.next-page", context: "reader", enabled: true, input: { device: "keyboard", code: "ArrowRight" } },
      { id: "mouse-next", action: "reader.next-page", context: "reader", enabled: true, input: { device: "mouse", button: 3, action: "click" } },
    ] as const

    await expect(service.apply(bindings, false)).rejects.toThrow("confirmation")
    await expect(service.apply(bindings, true)).resolves.toMatchObject({ changed: true, config: { bindings } })
    await expect(service.inspect()).resolves.toEqual({ bindings })
    expect(await readFile(configPath, "utf8")).toContain('id = "mouse-next"')
    await expect(service.reset(true)).resolves.toMatchObject({ changed: true, config: { bindings: expect.any(Array) } })
    expect((await service.inspect()).bindings.length).toBeGreaterThan(bindings.length)
  })

  it("[neoview.bindings.config-service-validation] rejects ambiguous enabled inputs before writing", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-input-bindings-invalid-"))
    roots.push(root)
    const service = new ReaderInputBindingsConfigService({ configPath: join(root, "xiranite.config.toml") })
    const input = { device: "keyboard" as const, code: "Space" }
    await expect(service.apply([
      { id: "one", action: "reader.next-page", context: "reader", enabled: true, input },
      { id: "two", action: "reader.previous-page", context: "reader", enabled: true, input },
    ], true)).rejects.toThrow("conflicting")
  })
})
