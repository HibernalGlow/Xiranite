import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { PlatformFileMutationProvider } from "./platform.js"

const roots: string[] = []
const capabilities = {
  deleteToTrash: true,
  list: true,
  restore: true,
  provider: "trash-rs" as const,
  providerVersion: "5.2.6",
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("PlatformFileMutationProvider", () => {
  it("captures the CZ trash-rs receipt and restores it", async () => {
    const root = await temporaryRoot()
    const source = join(root, "source.txt")
    await writeFile(source, "xiranite")
    const nativeReceipt = { id: "$R-test", name: "source.txt", originalParent: root, timeDeleted: 123 }
    const trash = vi.fn(async (path: string) => {
      await rm(path)
      return { trashed: true as const, receipt: nativeReceipt }
    })
    const restoreTrash = vi.fn(async () => { await writeFile(source, "xiranite") })
    const provider = new PlatformFileMutationProvider({ trash, restoreTrash, trashCapabilities: capabilities })

    const receipt = await provider.execute({ kind: "trash", sourcePath: source })

    expect(receipt).toMatchObject({
      original: { kind: "trash", sourcePath: source },
      providerData: { kind: "trash-rs", item: nativeReceipt },
    })
    await provider.undo(receipt!)
    expect(restoreTrash).toHaveBeenCalledWith(nativeReceipt)
    expect(await readFile(source, "utf8")).toBe("xiranite")
  })

  it("refuses to restore over a replacement path", async () => {
    const root = await temporaryRoot()
    const source = join(root, "source.txt")
    await writeFile(source, "original")
    const trash = async (path: string) => {
      await rm(path)
      return { trashed: true as const, receipt: { id: "id", name: "source.txt", originalParent: root, timeDeleted: 1 } }
    }
    const restoreTrash = vi.fn(async () => undefined)
    const provider = new PlatformFileMutationProvider({ trash, restoreTrash, trashCapabilities: capabilities })
    const receipt = await provider.execute({ kind: "trash", sourcePath: source })
    await writeFile(source, "replacement")

    await expect(provider.undo(receipt!)).rejects.toMatchObject({ code: "ESTALE" })
    expect(restoreTrash).not.toHaveBeenCalled()
  })

  it("keeps non-trash mutations behind the same provider contract", async () => {
    const root = await temporaryRoot()
    const source = join(root, "source.txt")
    const destination = join(root, "copy.txt")
    await writeFile(source, "xiranite")
    const provider = new PlatformFileMutationProvider({ trashCapabilities: { ...capabilities, restore: false } })

    const receipt = await provider.execute({ kind: "copy", sourcePath: source, destinationPath: destination })
    expect(await readFile(destination, "utf8")).toBe("xiranite")
    await provider.undo(receipt!)
    await expect(stat(destination)).rejects.toMatchObject({ code: "ENOENT" })
  })
})

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "xiranite-file-operation-test-"))
  roots.push(root)
  return root
}
