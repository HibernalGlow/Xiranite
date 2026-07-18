import { describe, expect, it, vi } from "vitest"

import {
  loadOpenComicSystemRuntime,
  OpenComicSystemRuntimeUnavailableError,
} from "./OpenComicSystemRuntimeLoader.js"

describe("OpenComic system runtime loader", () => {
  it("[neoview.super-resolution.runtime-loader] accepts the validated default export", async () => {
    const runtime = fakeRuntime()
    const importModule = vi.fn(async () => ({ default: runtime }))
    await expect(loadOpenComicSystemRuntime({ importModule })).resolves.toBe(runtime)
    expect(importModule).toHaveBeenCalledWith("@hibernalglow/opencomic-ai-system")
  })

  it("[neoview.super-resolution.runtime-loader-missing] wraps module resolution failures", async () => {
    const cause = new Error("module not found")
    await expect(loadOpenComicSystemRuntime({ importModule: async () => { throw cause } }))
      .rejects.toMatchObject({ name: "OpenComicSystemRuntimeUnavailableError", cause })
  })

  it("[neoview.super-resolution.runtime-loader-contract] rejects incompatible package versions", async () => {
    await expect(loadOpenComicSystemRuntime({ importModule: async () => ({ default: { modelsList: [] } }) }))
      .rejects.toBeInstanceOf(OpenComicSystemRuntimeUnavailableError)
  })
})

function fakeRuntime() {
  return {
    modelsList: ["model"],
    model: vi.fn(() => ({ upscaler: "upscayl", scales: [2] })),
    setBinaryResolver: vi.fn(),
    setModelsPath: vi.fn(),
    setConcurrentDaemons: vi.fn(),
    setDaemonIdleTimeout: vi.fn(),
    pipeline: vi.fn(async (_source: string, destination: string) => destination),
    closeAllProcesses: vi.fn(),
  }
}
