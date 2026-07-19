import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { PlatformReaderDirectorySizeProvider } from "./PlatformReaderDirectorySizeProvider.js"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("PlatformReaderDirectorySizeProvider", () => {
  it("[neoview.folder.size-platform] streams recursive file stats through readdirp under one background IO lease", async () => {
    const root = await mkdtemp(join(tmpdir(), "neoview-directory-size-"))
    roots.push(root)
    await mkdir(join(root, "nested"))
    await writeFile(join(root, "a.bin"), Buffer.alloc(3))
    await writeFile(join(root, "nested", "b.bin"), Buffer.alloc(5))
    const release = vi.fn()
    const acquire = vi.fn(async () => ({ release }))
    const provider = new PlatformReaderDirectorySizeProvider({ resourceScheduler: { acquire } })

    await expect(provider.measure(root)).resolves.toEqual({ path: root, bytes: 8, fileCount: 2 })
    expect(acquire).toHaveBeenCalledWith(expect.objectContaining({
      resource: "io",
      priority: "background",
      kind: "reader.directory-size.scan",
    }), undefined)
    expect(release).toHaveBeenCalledOnce()
  })

  it("[neoview.folder.size-budget] stops at the configured file budget and releases resources", async () => {
    const root = await mkdtemp(join(tmpdir(), "neoview-directory-size-budget-"))
    roots.push(root)
    await writeFile(join(root, "a.bin"), "a")
    await writeFile(join(root, "b.bin"), "b")
    const release = vi.fn()
    const provider = new PlatformReaderDirectorySizeProvider({
      maximumFiles: 1,
      resourceScheduler: { acquire: async () => ({ release }) },
    })

    await expect(provider.measure(root)).rejects.toThrow("1 file size-scan limit")
    expect(release).toHaveBeenCalledOnce()
  })

  it("[neoview.folder.size-cancellation-race] does not start scanning after a cancelled lease is granted", async () => {
    const root = await mkdtemp(join(tmpdir(), "neoview-directory-size-cancel-"))
    roots.push(root)
    await writeFile(join(root, "a.bin"), Buffer.alloc(3))
    const release = vi.fn()
    let grantLease: ((lease: { release: () => void }) => void) | undefined
    const acquire = vi.fn(() => new Promise<{ release: () => void }>((resolve) => {
      grantLease = resolve
    }))
    const provider = new PlatformReaderDirectorySizeProvider({ resourceScheduler: { acquire } })
    const controller = new AbortController()
    const pending = provider.measure(root, controller.signal)

    expect(acquire).toHaveBeenCalledOnce()
    controller.abort(new Error("directory size caller cancelled"))
    grantLease!({ release })

    await expect(pending).rejects.toThrow("directory size caller cancelled")
    expect(release).toHaveBeenCalledOnce()
  })

  it("[neoview.folder.size-drive-root] normalizes a Windows drive-only root before scanning", async () => {
    const original = process.platform
    Object.defineProperty(process, "platform", { value: "win32", configurable: true })
    try {
      const provider = new PlatformReaderDirectorySizeProvider()
      const error = await provider.measure("E:").catch((cause: unknown) => cause)
      expect(String(error)).toContain("E:\\")
    } finally {
      Object.defineProperty(process, "platform", { value: original, configurable: true })
    }
  })
})
