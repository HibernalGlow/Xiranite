import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { detectViewSource } from "./detectViewSource.js"

const temporaryPaths: string[] = []

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe("detectViewSource", () => {
  it("[neoview.shortcut.detect] follows a shortcut chain before classifying the target", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-neoview-detect-"))
    temporaryPaths.push(root)
    const target = join(root, "book.cbz")
    const link = join(root, "book.lnk")
    await mkdir(root, { recursive: true })
    await writeFile(target, "archive")
    await writeFile(link, "shortcut")
    const source = await detectViewSource(link, undefined, undefined, {
      resolve: async (path) => ({ status: "resolved", shortcutPath: path, targetPath: target, targetKind: "file" }),
    })
    expect(source).toEqual({ kind: "archive", path: target })
  })

  it("[neoview.shortcut.detect-invalid] keeps broken shortcuts out of the reader source contract", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-neoview-detect-"))
    temporaryPaths.push(root)
    const link = join(root, "broken.lnk")
    await writeFile(link, "shortcut")
    await expect(detectViewSource(link, undefined, undefined, {
      resolve: async (path) => ({ status: "invalid", shortcutPath: path, reason: "broken target" }),
    })).rejects.toThrow("broken target")
  })
})
