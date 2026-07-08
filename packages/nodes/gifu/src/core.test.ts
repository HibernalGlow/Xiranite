import { describe, expect, test } from "vitest"
import { buildGifuCommand, buildGifuDatabase, buildGifuRunRecord, isGifuArchive, normalizeGifuInput, parseGifuTomlConfig, parsePathList, runGifu } from "./core.js"
import type { GifuRuntime } from "./core.js"

describe("gifu core", () => {
  function runtime(overrides: Partial<GifuRuntime> = {}): GifuRuntime {
    return {
      readText: async () => "",
      appendRecord: async () => {},
      pathInfo: async (path) => ({ path, exists: true, isFile: path.endsWith(".zip"), isDirectory: !path.endsWith(".zip") }),
      listDir: async (path) => [{ name: "a.zip", path: `${path}/a.zip`, isFile: true, isDirectory: false }],
      countArchiveImages: async () => 3,
      runCommand: async () => ({ code: 0, stdout: "", stderr: "" }),
      join: (...parts) => parts.join("/"),
      dirname: (path) => path.slice(0, path.lastIndexOf("/")),
      basename: (path) => path.slice(path.lastIndexOf("/") + 1),
      extname: (path) => path.slice(path.lastIndexOf(".")),
      ...overrides,
    }
  }

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

  test("parses TOML-like config", () => {
    expect(parseGifuTomlConfig('paths = ["D:/a.zip", "D:/b.cbz"]\nformat = "gif"\ndurationMs = 90\nrecordRun = true\n')).toMatchObject({
      paths: ["D:/a.zip", "D:/b.cbz"],
      format: "gif",
      durationMs: 90,
      recordRun: true,
    })
  })

  test("builds default JSONL database path", () => {
    const input = normalizeGifuInput({ path: "D:/in/a.zip" })
    const database = buildGifuDatabase(input, [
      { archivePath: "D:/in/a.zip", outputPath: "D:/in/a.webp", imageCount: 3, status: "ready" },
    ], { dirname: (path) => path.slice(0, path.lastIndexOf("/")), join: (...parts) => parts.join("/") })
    expect(database).toEqual({
      path: "D:/in/.xiranite/gifu-runs.jsonl",
      enabled: false,
      mode: "jsonl",
      defaultPath: true,
    })
  })

  test("summarizes run records", () => {
    const input = normalizeGifuInput({ path: "D:/in/a.zip", format: "webp", dryRun: true })
    const command = buildGifuCommand(input)
    const record = buildGifuRunRecord("plan", input, [
      { archivePath: "D:/in/a.zip", outputPath: "D:/in/a.webp", imageCount: 3, status: "ready" },
    ], command)
    expect(record).toMatchObject({
      toolId: "gifu",
      action: "plan",
      archiveCount: 1,
      readyCount: 1,
      success: true,
    })
  })

  test("inspects archives through injected runtime", async () => {
    const result = await runGifu({ path: "D:/in" }, runtime())
    expect(result.success).toBe(true)
    expect(result.data?.readyCount).toBe(1)
    expect(result.data?.database?.path).toBe("D:/in/.xiranite/gifu-runs.jsonl")
  })

  test("loads config and records plan output", async () => {
    const records: Array<{ path: string; record: unknown }> = []
    const result = await runGifu({ action: "plan", configText: 'path = "D:/in"\nrecordRun = true\n' }, runtime({
      appendRecord: async (path, record) => {
        records.push({ path, record })
      },
    }))
    expect(result.success).toBe(true)
    expect(result.data?.config?.keys).toEqual(["path", "recordRun"])
    expect(records).toHaveLength(1)
    expect(records[0]?.path).toBe("D:/in/.xiranite/gifu-runs.jsonl")
    expect(records[0]?.record).toMatchObject({ toolId: "gifu", action: "plan", archiveCount: 1 })
  })
})
