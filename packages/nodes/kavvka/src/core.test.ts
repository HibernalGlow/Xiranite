import { afterEach, describe, expect, test } from "vitest"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { createNodeKavvkaRuntime } from "./platform.js"
import { generateCzkawkaPath, parseKavvkaKeywords, parseKavvkaPaths, runKavvka } from "./core.js"

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe("kavvka core", () => {
  test("parses path and keyword text", () => {
    expect(parseKavvkaPaths(" \"a\"\n b ; c ")).toEqual(["a", "b", "c"])
    expect(parseKavvkaKeywords("gallery, CG\nartbook")).toEqual(["gallery", "CG", "artbook"])
    expect(generateCzkawkaPath("C:\\a\\b", "C:\\a\\#compare")).toBe("C:/a/b;C:/a/#compare")
  })

  test("scans keyword folders while skipping hidden and compare folders", async () => {
    const root = await tempRoot()
    await mkdir(join(root, "artist gallery"), { recursive: true })
    await mkdir(join(root, "#compare", "hidden gallery"), { recursive: true })
    await mkdir(join(root, "nested", "artbook set"), { recursive: true })

    const result = await runKavvka({
      action: "scan",
      scanRoots: [root],
      keywords: ["gallery", "artbook"],
      scanDepth: 2,
    }, createNodeKavvkaRuntime())

    expect(result.success).toBe(true)
    expect(result.data?.matchedPaths.map((path) => path.replace(/\\/g, "/")).sort()).toEqual([
      join(root, "artist gallery").replace(/\\/g, "/"),
      join(root, "nested", "artbook set").replace(/\\/g, "/"),
    ].sort())
  })

  test("plans sibling moves into artist compare folder", async () => {
    const root = await tempRoot()
    const artist = join(root, "[artist] bundle")
    const source = join(artist, "gallery")
    const sibling = join(artist, "old scan")
    await mkdir(source, { recursive: true })
    await mkdir(sibling, { recursive: true })

    const result = await runKavvka({
      action: "plan",
      paths: [source],
      dryRun: true,
      strictArtist: true,
    }, createNodeKavvkaRuntime())

    expect(result.success).toBe(true)
    expect(result.data?.allCombinedPaths[0]?.replace(/\\/g, "/")).toBe(`${source.replace(/\\/g, "/")};${join(artist, "#compare").replace(/\\/g, "/")}`)
    expect(result.data?.processResults[0]?.movedFolders).toEqual([
      { source: resolve(sibling), target: resolve(join(artist, "#compare", "old scan")), success: true },
    ])
  })

  test("process moves sibling folders and records successful moves", async () => {
    const root = await tempRoot()
    const artist = join(root, "[artist] bundle")
    const source = join(artist, "gallery")
    const sibling = join(artist, "old scan")
    await mkdir(source, { recursive: true })
    await mkdir(sibling, { recursive: true })
    await writeFile(join(sibling, "image.txt"), "x")

    const result = await runKavvka({
      action: "process",
      paths: [source],
      strictArtist: true,
    }, createNodeKavvkaRuntime())

    expect(result.success).toBe(true)
    expect(result.data?.movedCount).toBe(1)
    expect((await createNodeKavvkaRuntime().pathInfo(sibling)).exists).toBe(false)
    expect((await createNodeKavvkaRuntime().pathInfo(join(artist, "#compare", "old scan"))).exists).toBe(true)
  })
})

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "xiranite-kavvka-"))
  tempDirs.push(dir)
  return dir
}
