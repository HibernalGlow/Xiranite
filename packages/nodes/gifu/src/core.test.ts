import { describe, expect, test } from "vitest"
import { buildGifuCommand, isGifuArchive, normalizeGifuInput, parsePathList, runGifu } from "./core.js"
import type { GifuRuntime } from "./core.js"

describe("gifu core", () => {
  test("parses paths and archive names", () => {
    expect(parsePathList('"D:/a.zip"\n# skip\nD:/b.cbz')).toEqual(["D:/a.zip", "D:/b.cbz"])
    expect(isGifuArchive("demo.tar.gz")).toBe(true)
    expect(isGifuArchive("demo.txt")).toBe(false)
  })

  test("builds Python module command", () => {
    const input = normalizeGifuInput({ action: "make", path: "D:/a.zip", sourceRoot: "D:/src", format: "webp" })
    const plan = buildGifuCommand(input)
    expect(plan.command).toBe("python")
    expect(plan.args.slice(0, 3)).toEqual(["-m", "gifu", "make"])
    expect(plan.env?.PYTHONPATH).toBe("D:/src")
  })

  test("inspects archives through injected runtime", async () => {
    const runtime: GifuRuntime = {
      pathInfo: async (path) => ({ path, exists: true, isFile: path.endsWith(".zip"), isDirectory: !path.endsWith(".zip") }),
      listDir: async (path) => [{ name: "a.zip", path: `${path}/a.zip`, isFile: true, isDirectory: false }],
      countArchiveImages: async () => 3,
      runCommand: async () => ({ code: 0, stdout: "", stderr: "" }),
      join: (...parts) => parts.join("/"),
      dirname: (path) => path.slice(0, path.lastIndexOf("/")),
      basename: (path) => path.slice(path.lastIndexOf("/") + 1),
      extname: (path) => path.slice(path.lastIndexOf(".")),
    }
    const result = await runGifu({ path: "D:/in" }, runtime)
    expect(result.success).toBe(true)
    expect(result.data?.readyCount).toBe(1)
  })
})
