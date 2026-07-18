import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { resolveReaderShortcutChain, WindowsReaderShortcutResolver } from "./WindowsReaderShortcutResolver.js"

const temporaryPaths: string[] = []

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe("WindowsReaderShortcutResolver", () => {
  it("[neoview.shortcut.com] resolves a relative COM target and canonicalizes it", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-neoview-shortcut-"))
    temporaryPaths.push(root)
    const target = join(root, "books", "book.cbz")
    const shortcut = join(root, "links", "book.lnk")
    await mkdir(join(root, "books"), { recursive: true })
    await mkdir(join(root, "links"), { recursive: true })
    await writeFile(target, "book")
    await writeFile(shortcut, "link")
    const runPowerShell = vi.fn(async (_command, options: { shortcutPath: string }) => {
      expect(options.shortcutPath).toBe(shortcut)
      return JSON.stringify({ relativePath: "../books/book.cbz" })
    })
    const release = vi.fn()
    const scheduler = { acquire: vi.fn(async () => ({ release })) }
    const resolver = new WindowsReaderShortcutResolver({ platform: "win32", runPowerShell, resourceScheduler: scheduler })

    await expect(resolver.resolve(shortcut, new AbortController().signal)).resolves.toMatchObject({
      status: "resolved",
      targetKind: "file",
      targetPath: target,
    })
    expect(runPowerShell).toHaveBeenCalledOnce()
    expect(scheduler.acquire).toHaveBeenCalledWith({
      resource: "io",
      kind: "reader.shortcut.resolve",
      priority: "view",
      ownerId: "neoview:shortcut-resolver",
    }, expect.any(AbortSignal))
    expect(release).toHaveBeenCalledOnce()
  })

  it("[neoview.shortcut.invalid-target] rejects URL and shell targets without probing them", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-neoview-shortcut-"))
    temporaryPaths.push(root)
    const shortcut = join(root, "bad.lnk")
    await writeFile(shortcut, "link")
    const release = vi.fn()
    const scheduler = { acquire: vi.fn(async () => ({ release })) }
    const resolver = new WindowsReaderShortcutResolver({
      platform: "win32",
      resourceScheduler: scheduler,
      runPowerShell: async () => JSON.stringify({ targetPath: "https://example.test/book.cbz" }),
    })

    await expect(resolver.resolve(shortcut)).resolves.toMatchObject({ status: "invalid" })
    expect(release).toHaveBeenCalledOnce()
  })

  it("[neoview.shortcut.unavailable] reports structured unavailability off Windows", async () => {
    const resolver = new WindowsReaderShortcutResolver({ platform: "linux" })
    await expect(resolver.resolve("book.lnk")).resolves.toMatchObject({
      status: "unavailable",
    })
  })

  it("[neoview.shortcut.scheduler-cancel] does not start PowerShell when admission is cancelled", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-neoview-shortcut-"))
    temporaryPaths.push(root)
    const shortcut = join(root, "book.lnk")
    await writeFile(shortcut, "link")
    const controller = new AbortController()
    controller.abort(new DOMException("superseded", "AbortError"))
    const runPowerShell = vi.fn(async () => JSON.stringify({ targetPath: shortcut }))
    const resolver = new WindowsReaderShortcutResolver({ platform: "win32", runPowerShell, resourceScheduler: { acquire: vi.fn() } })

    await expect(resolver.resolve(shortcut, controller.signal)).rejects.toMatchObject({ name: "AbortError" })
    expect(runPowerShell).not.toHaveBeenCalled()
  })

  it("[neoview.shortcut.chain] resolves nested links and rejects cycles", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-neoview-shortcut-"))
    temporaryPaths.push(root)
    const first = join(root, "first.lnk")
    const second = join(root, "second.lnk")
    const target = join(root, "book.cbz")
    await Promise.all([writeFile(first, "link"), writeFile(second, "link"), writeFile(target, "book")])
    const targets = new Map([[first, second], [second, target]])
    const resolver = {
      resolve: vi.fn(async (path: string) => ({
        status: "resolved" as const,
        shortcutPath: path,
        targetPath: targets.get(path),
        targetKind: path === second ? "file" as const : undefined,
      })),
    }
    await expect(resolveReaderShortcutChain(first, resolver)).resolves.toMatchObject({ path: target, kind: "file" })
    targets.set(second, first)
    await expect(resolveReaderShortcutChain(first, resolver)).rejects.toThrow("cycle")
  })
})
