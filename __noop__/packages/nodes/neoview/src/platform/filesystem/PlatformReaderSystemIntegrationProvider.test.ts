import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { PlatformReaderSystemIntegrationProvider } from "./PlatformReaderSystemIntegrationProvider.js"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("PlatformReaderSystemIntegrationProvider", () => {
  it("[neoview.file-operations.system-platform] verifies the path and delegates to maintained adapters", async () => {
    const root = await mkdtemp(join(tmpdir(), "neoview-system-integration-"))
    roots.push(root)
    const path = join(root, "page.jpg")
    await writeFile(path, "reader")
    const openPath = vi.fn(async () => undefined)
    const revealPath = vi.fn(async () => undefined)
    const provider = new PlatformReaderSystemIntegrationProvider({ openPath, revealPath })

    await provider.open(path)
    await provider.reveal(path)
    expect(openPath).toHaveBeenCalledWith(path)
    expect(revealPath).toHaveBeenCalledWith(path)
    await expect(provider.open(join(root, "missing"))).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("[neoview.file-operations.system-scheduler] uses one interactive IO lease", async () => {
    const root = await mkdtemp(join(tmpdir(), "neoview-system-scheduler-"))
    roots.push(root)
    const path = join(root, "page.jpg")
    await writeFile(path, "reader")
    const release = vi.fn()
    const acquire = vi.fn(async () => ({ release }))
    const provider = new PlatformReaderSystemIntegrationProvider({ scheduler: { acquire }, openPath: vi.fn(async () => undefined) })

    await provider.open(path)
    expect(acquire).toHaveBeenCalledWith(expect.objectContaining({ resource: "io", priority: "interactive" }), undefined)
    expect(release).toHaveBeenCalledOnce()
  })
})
