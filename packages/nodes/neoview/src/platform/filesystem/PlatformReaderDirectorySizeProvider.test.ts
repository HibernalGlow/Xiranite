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
})
