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

  it("[neoview.file-operations.trash-restore] records a guarded trash receipt when restore is available", async () => {
    const root = await temporaryRoot()
    const source = join(root, "source.txt")
    await writeFile(source, "reader")
    const trashPath = vi.fn(async (path: string) => rm(path))
    const restoreTrash = vi.fn(async (path: string) => writeFile(path, "reader"))
    const identifyTrash = vi.fn(async () => "C:\\$Recycle.Bin\\test\\$R-source.txt")
    const provider = new PlatformReaderFileMutationProvider({ trash: trashPath, restoreTrash, identifyTrash })

    const receipt = await provider.execute({ kind: "trash", sourcePath: source })
    expect(provider.trashRestore).toBe(true)
    expect(receipt).toMatchObject({
      original: { kind: "trash", sourcePath: source },
      inverse: { kind: "trash", sourcePath: source },
      providerData: { kind: "windows-recycle-bin", itemPath: "C:\\$Recycle.Bin\\test\\$R-source.txt" },
    })

    await provider.undo(receipt!)
    expect(identifyTrash).toHaveBeenCalledWith(source)
    expect(restoreTrash).toHaveBeenCalledWith(source, "C:\\$Recycle.Bin\\test\\$R-source.txt", undefined)
    expect(await readFile(source, "utf8")).toBe("reader")
  })

  it("[neoview.file-operations.trash-restore-stale] refuses to restore over a replacement path", async () => {
    const root = await temporaryRoot()
    const source = join(root, "source.txt")
    await writeFile(source, "reader")
    const trashPath = vi.fn(async (path: string) => rm(path))
    const restoreTrash = vi.fn(async (path: string) => writeFile(path, "restored"))
    const identifyTrash = vi.fn(async () => "C:\\$Recycle.Bin\\test\\$R-source.txt")
    const provider = new PlatformReaderFileMutationProvider({ trash: trashPath, restoreTrash, identifyTrash })

    const receipt = await provider.execute({ kind: "trash", sourcePath: source })
    await writeFile(source, "replacement")

    await expect(provider.undo(receipt!)).rejects.toMatchObject({ code: "ESTALE" })
    expect(restoreTrash).not.toHaveBeenCalled()
    expect(await readFile(source, "utf8")).toBe("replacement")
  })

  it.runIf(process.platform === "win32")("[neoview.folder.rename-case-platform] preserves content and undo for a case-only rename", async () => {
    const root = await temporaryRoot()
    const source = join(root, "book.cbz")
    const destination = join(root, "Book.cbz")
    await writeFile(source, "reader")
    const provider = new PlatformReaderFileMutationProvider()

    const receipt = await provider.execute({ kind: "rename", sourcePath: source, destinationPath: destination })
    expect(await readFile(destination, "utf8")).toBe("reader")
    expect(receipt).toBeDefined()
    await provider.undo(receipt!)
    expect(await readFile(source, "utf8")).toBe("reader")
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

  it("[neoview.file-operations.undo-platform] reverses unchanged copy and move receipts", async () => {
    const root = await temporaryRoot()
    const source = join(root, "source.txt")
    const copied = join(root, "copied.txt")
    const moved = join(root, "moved.txt")
    await writeFile(source, "reader")
    const provider = new PlatformReaderFileMutationProvider()

    const copyReceipt = await provider.execute({ kind: "copy", sourcePath: source, destinationPath: copied })
    expect(copyReceipt).toBeDefined()
    await provider.undo(copyReceipt!)
    await expect(stat(copied)).rejects.toMatchObject({ code: "ENOENT" })
    expect(await readFile(source, "utf8")).toBe("reader")

    const moveReceipt = await provider.execute({ kind: "move", sourcePath: source, destinationPath: moved })
    expect(moveReceipt).toBeDefined()
    await provider.undo(moveReceipt!)
    expect(await readFile(source, "utf8")).toBe("reader")
    await expect(stat(moved)).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("[neoview.file-operations.undo-stale] refuses to remove a target modified after the operation", async () => {
    const root = await temporaryRoot()
    const source = join(root, "source.txt")
    const copied = join(root, "copied.txt")
    await writeFile(source, "reader")
    const provider = new PlatformReaderFileMutationProvider()
    const receipt = await provider.execute({ kind: "copy", sourcePath: source, destinationPath: copied })
    await writeFile(copied, "changed after copy")

    await expect(provider.undo(receipt!)).rejects.toMatchObject({ code: "ESTALE" })
    expect(await readFile(copied, "utf8")).toBe("changed after copy")
  })
})

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "neoview-file-operation-"))
  roots.push(root)
  return root
}
