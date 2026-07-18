import { describe, expect, it, vi } from "vitest"

import { SystemSuperResolutionCliResolver } from "./SystemSuperResolutionCliResolver.js"

describe("SystemSuperResolutionCliResolver", () => {
  it("[neoview.super-resolution.explicit-path] does not silently fall back when an explicit path is invalid", async () => {
    const which = vi.fn(async () => "D:/PATH/upscayl-bin.exe")
    const resolver = new SystemSuperResolutionCliResolver({
      explicitPaths: { upscayl: "D:/configured/missing.exe" },
      which,
      canonicalize: vi.fn(async () => { throw new Error("not found") }),
    })
    await expect(resolver.resolve("upscayl")).resolves.toEqual({
      engine: "upscayl",
      available: false,
      reason: "Configured executable is invalid: not found",
    })
    expect(which).not.toHaveBeenCalled()
  })

  it("[neoview.super-resolution.path-probe] canonicalizes and probes a PATH candidate", async () => {
    const resolver = new SystemSuperResolutionCliResolver({
      which: vi.fn(async () => "UPSCAYL-BIN.EXE"),
      canonicalize: vi.fn(async () => "D:/Tools/upscayl-bin.exe"),
      probe: vi.fn(async () => ({ version: "2.15.0" })),
    })
    await expect(resolver.resolve("upscayl")).resolves.toEqual({
      engine: "upscayl",
      available: true,
      executablePath: "D:/Tools/upscayl-bin.exe",
      version: "2.15.0",
      architecture: process.arch,
    })
  })

  it("[neoview.super-resolution.trusted-fallback] tries trusted candidates after a broken PATH result", async () => {
    const probe = vi.fn(async (_engine, path: string) => {
      if (path.includes("PATH")) throw new Error("wrong executable")
      return { version: "1.0.0" }
    })
    const resolver = new SystemSuperResolutionCliResolver({
      trustedCandidates: { realcugan: ["D:/Trusted/realcugan.exe"] },
      which: vi.fn(async () => "D:/PATH/realcugan.exe"),
      canonicalize: vi.fn(async (path) => path),
      probe,
    })
    await expect(resolver.resolve("realcugan")).resolves.toMatchObject({
      available: true,
      executablePath: "D:/Trusted/realcugan.exe",
    })
    expect(probe).toHaveBeenCalledTimes(2)
  })

  it("[neoview.super-resolution.probe-cache] caches each engine and refreshes explicitly", async () => {
    const probe = vi.fn(async () => ({ version: "1.0.0" }))
    const resolver = new SystemSuperResolutionCliResolver({
      which: vi.fn(async (command) => `D:/Tools/${command}.exe`),
      canonicalize: vi.fn(async (path) => path),
      probe,
    })
    await Promise.all([resolver.resolve("waifu2x"), resolver.resolve("waifu2x")])
    expect(probe).toHaveBeenCalledOnce()
    await resolver.resolve("waifu2x", { refresh: true })
    expect(probe).toHaveBeenCalledTimes(2)
  })

  it("[neoview.super-resolution.capability-abort] aborts the caller without cancelling the shared probe", async () => {
    let finish!: () => void
    const probe = vi.fn(async () => {
      await new Promise<void>((resolve) => { finish = resolve })
      return { version: "1.0.0" }
    })
    const resolver = new SystemSuperResolutionCliResolver({
      which: vi.fn(async () => "D:/Tools/upscayl.exe"),
      canonicalize: vi.fn(async (path) => path),
      probe,
    })
    const controller = new AbortController()
    const cancelled = resolver.resolve("upscayl", { signal: controller.signal })
    await vi.waitFor(() => expect(probe).toHaveBeenCalledOnce())
    controller.abort(new Error("cancelled"))
    await expect(cancelled).rejects.toThrow("cancelled")
    const shared = resolver.resolve("upscayl")
    finish()
    await expect(shared).resolves.toMatchObject({ available: true })
    expect(probe).toHaveBeenCalledOnce()
  })
})
