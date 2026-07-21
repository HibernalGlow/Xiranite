import { describe, expect, it, vi } from "vitest"

import {
  detectSuperResolutionDaemonSupport,
  SystemSuperResolutionCliResolver,
} from "./SystemSuperResolutionCliResolver.js"

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
      probe: vi.fn(async () => ({ version: "2.15.0", daemonSupported: true })),
    })
    await expect(resolver.resolve("upscayl")).resolves.toEqual({
      engine: "upscayl",
      available: true,
      executablePath: "D:/Tools/upscayl-bin.exe",
      version: "2.15.0",
      architecture: process.arch,
      daemonSupported: true,
      performanceMode: "daemon",
      managed: false,
    })
  })

  it("[neoview.super-resolution.daemon-capability] detects daemon mode only when UpScayl help declares it", () => {
    expect(detectSuperResolutionDaemonSupport("upscayl", "  -d daemon mode\n  -i input")).toBe(true)
    expect(detectSuperResolutionDaemonSupport("upscayl", "  --daemon keep process ready")).toBe(true)
    expect(detectSuperResolutionDaemonSupport("upscayl", "  -i input\n  -o output")).toBe(false)
    expect(detectSuperResolutionDaemonSupport("upscayl", "daemon mode is unavailable in this build")).toBe(false)
    expect(detectSuperResolutionDaemonSupport("waifu2x", "  -d daemon mode")).toBe(false)
  })

  it("[neoview.super-resolution.managed-daemon] prefers a managed daemon over a PATH process-per-page executable", async () => {
    const resolver = new SystemSuperResolutionCliResolver({
      managedCandidates: { upscayl: ["D:/Xiranite/tools/upscayl-daemon/current/upscayl-bin.exe"] },
      which: vi.fn(async () => "D:/scoop/apps/Upscayl/current/upscayl-bin.exe"),
      canonicalize: vi.fn(async (path) => path),
      probe: vi.fn(async (_engine, path) => ({ daemonSupported: path.includes("Xiranite") })),
    })
    await expect(resolver.resolve("upscayl")).resolves.toMatchObject({
      available: true,
      executablePath: "D:/Xiranite/tools/upscayl-daemon/current/upscayl-bin.exe",
      daemonSupported: true,
      performanceMode: "daemon",
      managed: true,
    })
  })

  it("[neoview.super-resolution.compatibility-warning] exposes a warning when only PATH process-per-page Upscayl is available", async () => {
    const resolver = new SystemSuperResolutionCliResolver({
      managedCandidates: { upscayl: ["D:/Xiranite/missing/upscayl-bin.exe"] },
      which: vi.fn(async () => "D:/scoop/apps/Upscayl/current/upscayl-bin.exe"),
      canonicalize: vi.fn(async (path) => {
        if (path.includes("missing")) throw new Error("not found")
        return path
      }),
      probe: vi.fn(async () => ({ daemonSupported: false })),
    })
    await expect(resolver.resolve("upscayl")).resolves.toMatchObject({
      available: true,
      managed: false,
      performanceMode: "process-per-page",
      warning: expect.stringContaining("every page"),
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
