import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, test } from "vitest"

import {
  createNodeBitvRuntime,
  discoverVideos,
  transferFileExclusive,
} from "./platform.js"

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (resolve(root).startsWith(resolve(tmpdir()))) await rm(root, { recursive: true, force: true })
  }
})

describe("native BitV Node platform", () => {
  test("discovers supported videos deterministically and respects recursive mode", async () => {
    const root = await tempRoot()
    await mkdir(join(root, "nested"), { recursive: true })
    await writeFile(join(root, "z.mp4"), "z")
    await writeFile(join(root, "ignore.txt"), "x")
    await writeFile(join(root, "nested", "a.mkv"), "a")

    const flat = await discoverVideos([root], false, root)
    const recursive = await discoverVideos([root, join(root, "z.mp4")], true, root)

    expect(flat.files.map((file) => file.relativePath)).toEqual(["z.mp4"])
    expect(recursive.files.map((file) => file.relativePath)).toEqual([join("nested", "a.mkv"), "z.mp4"])
    expect(recursive.files).toHaveLength(2)
  })

  test("copy and move choose numbered destinations instead of overwriting", async () => {
    const root = await tempRoot()
    const sourceCopy = join(root, "copy.mp4")
    const sourceMove = join(root, "move.mp4")
    const desiredCopy = join(root, "sorted", "copy.mp4")
    const desiredMove = join(root, "sorted", "move.mp4")
    await mkdir(join(root, "sorted"), { recursive: true })
    await writeFile(sourceCopy, "new-copy")
    await writeFile(sourceMove, "new-move")
    await writeFile(desiredCopy, "existing-copy")
    await writeFile(desiredMove, "existing-move")

    const copied = await transferFileExclusive(sourceCopy, desiredCopy, "copy")
    const moved = await transferFileExclusive(sourceMove, desiredMove, "move")

    expect(copied).toBe(join(root, "sorted", "copy (1).mp4"))
    expect(moved).toBe(join(root, "sorted", "move (1).mp4"))
    expect(await readFile(desiredCopy, "utf8")).toBe("existing-copy")
    expect(await readFile(desiredMove, "utf8")).toBe("existing-move")
    expect(await readFile(copied, "utf8")).toBe("new-copy")
    expect(await readFile(moved, "utf8")).toBe("new-move")
    await expect(stat(sourceMove)).rejects.toMatchObject({ code: "ENOENT" })
  })

  test("report writes are collision-safe too", async () => {
    const root = await tempRoot()
    const runtime = createNodeBitvRuntime({ cwd: root, now: () => new Date("2026-07-11T00:00:00Z") })

    const first = await runtime.writeJson("analysis.json", { value: 1 })
    const second = await runtime.writeJson("analysis.json", { value: 2 })

    expect(first).toBe(join(root, "analysis.json"))
    expect(second).toBe(join(root, "analysis (1).json"))
    expect(JSON.parse(await readFile(first, "utf8"))).toEqual({ value: 1 })
    expect(JSON.parse(await readFile(second, "utf8"))).toEqual({ value: 2 })
  })
})

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "bitv-native-"))
  roots.push(root)
  return root
}
