import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { PlatformReaderPathStatusProvider } from "./PlatformReaderPathStatusProvider.js"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("PlatformReaderPathStatusProvider", () => {
  it("[neoview.library.path-status] uses one host I/O lease and distinguishes missing paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-library-status-"))
    roots.push(root)
    const present = join(root, "present.cbz")
    await writeFile(present, "present")
    const release = vi.fn()
    const acquire = vi.fn(async () => ({ release }))
    const provider = new PlatformReaderPathStatusProvider({ acquire })

    await expect(provider.check(present)).resolves.toBe("present")
    await expect(provider.check(join(root, "missing.cbz"))).resolves.toBe("missing")
    expect(acquire).toHaveBeenCalledWith(expect.objectContaining({ resource: "io", priority: "background" }), undefined)
    expect(release).toHaveBeenCalledTimes(2)
  })
})
