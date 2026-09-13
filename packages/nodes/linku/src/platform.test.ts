import { lstat, mkdir, mkdtemp, rm, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "vitest"
import { createNodeLinkuRuntime } from "./platform.js"

const cleanupPaths: string[] = []

afterEach(async () => {
  await Promise.all(cleanupPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe("createNodeLinkuRuntime", () => {
  test("removes a directory symlink without deleting its target", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-linku-"))
    cleanupPaths.push(root)
    const target = join(root, "target")
    const link = join(root, "link")
    await mkdir(target)
    await symlink(target, link, process.platform === "win32" ? "junction" : "dir")

    await createNodeLinkuRuntime().removeSymlink(link)

    await expect(lstat(link)).rejects.toMatchObject({ code: "ENOENT" })
    await expect(lstat(target)).resolves.toBeDefined()
  })
})
