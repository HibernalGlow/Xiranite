/**
 * The nameu runtime against a real directory, through the capability surface.
 *
 * `core.test.ts` drives `runNameu` with a fake runtime, so nothing before this file exercised the machine
 * half. Under Vitest the specifier resolves to the Node transport (the realm build reaches the realm
 * transport through the alias table, which a test runner has no notion of), so what is proved here is the
 * mapping from `NameuRuntime` onto the capability methods — not the QuickJS run. That rule is enforced
 * where it belongs: `scripts/audit-platform-capabilities.ts` counts the `platform.ts` files still reaching
 * machine builtins directly, so a node that bypasses the surface turns the gate red instead of passing here.
 */
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { createNodeNameuRuntime } from "./platform.js"

const runtime = createNodeNameuRuntime()
let root = ""

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "nameu-platform-"))
  await writeFile(join(root, "one.txt"), "1")
  await writeFile(join(root, "two.txt"), "22")
  await mkdir(join(root, "folder"))
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe("nameu runtime via host capabilities", () => {
  it("stats a file, a directory, and an absent path", async () => {
    expect(await runtime.pathInfo(join(root, "one.txt"))).toMatchObject({
      exists: true,
      isFile: true,
      isDirectory: false,
    })
    expect(await runtime.pathInfo(join(root, "folder"))).toMatchObject({ isDirectory: true, isFile: false })
    expect(await runtime.pathInfo(join(root, "gone.txt"))).toMatchObject({ exists: false })
  })

  it("lists one level with usable paths", async () => {
    const entries = await runtime.listDir(root)
    expect(entries.map((entry) => entry.name).sort()).toEqual(["folder", "one.txt", "two.txt"])
    for (const entry of entries) expect(entry.path).toBe(join(root, entry.name))
    expect(entries.find((entry) => entry.name === "folder")?.isDirectory).toBe(true)
  })

  it("renames and reports the new location", async () => {
    const from = join(root, "two.txt")
    const to = join(root, "renamed.txt")
    await runtime.rename(from, to)
    expect((await runtime.pathInfo(from)).exists).toBe(false)
    expect((await runtime.pathInfo(to)).exists).toBe(true)
    expect((await readdir(root)).sort()).toEqual(["folder", "one.txt", "renamed.txt"])
    await runtime.rename(to, from)
  })

  it("sets both timestamps and reads them back", async () => {
    const target = join(root, "one.txt")
    const when = 1_600_000_000_000
    await runtime.setTimes(target, when, when)
    const info = await runtime.pathInfo(target)
    expect(Math.round(info.mtimeMs)).toBeCloseTo(when, 0)
    expect(Math.round(info.atimeMs)).toBeCloseTo(when, 0)
  })

})
