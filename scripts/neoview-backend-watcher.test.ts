import { describe, expect, it, vi } from "vitest"

import { createNeoviewRestartScheduler, isNeoviewBackendSourceFile } from "./neoview-backend-watcher"

describe("NeoView backend source watcher", () => {
  it("accepts TypeScript implementation files on Windows and POSIX paths", () => {
    expect(isNeoviewBackendSourceFile("platform\\asset-route\\ReaderHttpControllerImplementation.ts")).toBe(true)
    expect(isNeoviewBackendSourceFile("application/config/ReaderRuntimeConfigParser.ts")).toBe(true)
    expect(isNeoviewBackendSourceFile("domain/page/Page.ts")).toBe(true)
  })

  it("ignores tests and non-TypeScript files", () => {
    expect(isNeoviewBackendSourceFile("application/config/ReaderRuntimeConfig.test.ts")).toBe(false)
    expect(isNeoviewBackendSourceFile("platform/config/ReaderConfig.spec.tsx")).toBe(false)
    expect(isNeoviewBackendSourceFile("testing/Tui.tsx")).toBe(false)
    expect(isNeoviewBackendSourceFile("cli/library-command.ts")).toBe(false)
    expect(isNeoviewBackendSourceFile("Tui.tsx")).toBe(false)
    expect(isNeoviewBackendSourceFile("ui-core.ts")).toBe(false)
    expect(isNeoviewBackendSourceFile("README.md")).toBe(false)
  })

  it("does not restart after the watcher has closed", async () => {
    const restart = vi.fn(async () => undefined)
    const scheduler = createNeoviewRestartScheduler(restart, 5)

    scheduler.schedule()
    scheduler.close()
    await Bun.sleep(20)

    expect(restart).not.toHaveBeenCalled()
  })

  it("drops a pending follow-up when closed during a restart", async () => {
    let finishRestart!: () => void
    const restart = vi.fn(() => new Promise<void>((resolve) => { finishRestart = resolve }))
    const scheduler = createNeoviewRestartScheduler(restart, 5)

    scheduler.schedule()
    await Bun.sleep(20)
    expect(restart).toHaveBeenCalledTimes(1)

    scheduler.schedule()
    await Bun.sleep(20)
    scheduler.close()
    finishRestart()
    await Bun.sleep(5)

    expect(restart).toHaveBeenCalledTimes(1)
  })
})

