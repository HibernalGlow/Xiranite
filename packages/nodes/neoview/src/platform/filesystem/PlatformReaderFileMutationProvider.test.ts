import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { PlatformReaderFileMutationProvider } from "./PlatformReaderFileMutationProvider.js"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("PlatformReaderFileMutationProvider", () => {
  it("[neoview.file-operations.platform] uses Node primitives and move-file without overwriting by default", async () => {
    const root = await temporaryRoot()
    const source = join(root, "source.txt")
    const copied = join(root, "copied.txt")
    const moved = join(root, "moved.txt")
    const renamed = join(root, "renamed.txt")
    await writeFile(source, "reader")
    const provider = new PlatformReaderFileMutationProvider()

    await provider.execute({ kind: "copy", sourcePath: source, destinationPath: copied })
    await expect(provider.execute({ kind: "copy", sourcePath: source, destinationPath: copied })).rejects.toMatchObject({ code: "EEXIST" })
    await provider.execute({ kind: "move", sourcePath: copied, destinationPath: moved })
    await provider.execute({ kind: "rename", sourcePath: moved, destinationPath: renamed })

    expect(await readFile(source, "utf8")).toBe("reader")
    expect(await readFile(renamed, "utf8")).toBe("reader")
    await expect(stat(moved)).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("[neoview.file-operations.trash-adapter] verifies existence and delegates recycle behavior", async () => {
    const root = await temporaryRoot()
    const source = join(root, "source.txt")
    await writeFile(source, "reader")
    const trashPath = vi.fn(async () => undefined)
    const provider = new PlatformReaderFileMutationProvider({ trash: trashPath })

    await provider.execute({ kind: "trash", sourcePath: source })
    expect(trashPath).toHaveBeenCalledWith(source)
    await expect(provider.execute({ kind: "trash", sourcePath: join(root, "missing") })).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("[neoview.file-operations.scheduler] acquires and releases one interactive IO lease", async () => {
    const root = await temporaryRoot()
    const destinationPath = join(root, "created")
    const release = vi.fn()
    const acquire = vi.fn(async () => ({ release }))
    const provider = new PlatformReaderFileMutationProvider({ scheduler: { acquire } })

    await provider.execute({ kind: "create-directory", destinationPath })
    expect(acquire).toHaveBeenCalledWith(expect.objectContaining({ resource: "io", priority: "interactive" }), undefined)
    expect(release).toHaveBeenCalledOnce()
  })
})

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "neoview-file-operation-"))
  roots.push(root)
  return root
}
