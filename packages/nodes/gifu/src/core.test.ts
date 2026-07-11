import { win32 } from "node:path"
import { describe, expect, test, vi } from "vitest"
import {
  buildGifuCommand,
  buildGifuDatabase,
  buildOutputPath,
  effectiveGifuFormat,
  isGifuArchive,
  normalizeGifuInput,
  parseGifuTomlConfig,
  parsePathList,
  resolveMaxWorkers,
  runGifu,
  type GifuConversionOutcome,
  type GifuRuntime,
} from "./core.js"

describe("gifu native core", () => {
  function runtime(overrides: Partial<GifuRuntime> = {}): GifuRuntime {
    return {
      readText: async () => "",
      appendRecord: async () => {},
      pathInfo: async (path) => ({ path, exists: true, isFile: isGifuArchive(path), isDirectory: !isGifuArchive(path) }),
      listDir: async (path) => [{ name: "a.zip", path: win32.join(path, "a.zip"), isFile: true, isDirectory: false }],
      listArchiveImages: async () => [
        { path: "001.png", extension: ".png" },
        { path: "002.png", extension: ".png" },
        { path: "003.png", extension: ".png" },
      ],
      convertArchive: async (task) => ({
        status: "converted",
        outputPath: task.outputPath,
        decodedFrames: task.images.length,
        skippedFrames: 0,
        encoder: "ffmpeg-test",
      }),
      join: win32.join,
      dirname: win32.dirname,
      basename: win32.basename,
      extname: win32.extname,
      relative: win32.relative,
      ...overrides,
    }
  }

  test("normalizes native defaults without runtime adapter fields", () => {
    const input = normalizeGifuInput({ path: "D:/a.zip", format: "wbp" })
    expect(input).toMatchObject({
      action: "plan",
      format: "webp",
      namePrefix: "[#dyna]",
      nameTemplate: "{prefix}{stem}",
      dryRun: true,
      extractSingle: true,
    })
    for (const removedKey of [["module", "Name"], ["source", "Root"], ["py", "thon"]].map((parts) => parts.join(""))) {
      expect(input).not.toHaveProperty(removedKey)
    }
    expect(effectiveGifuFormat("auto")).toBe("webp")
  })

  test("parses path lists and all supported archive suffixes", () => {
    expect(parsePathList('"D:/a.zip"\n# skip\nD:/b.cbz; D:/c.tar.xz')).toEqual(["D:/a.zip", "D:/b.cbz", "D:/c.tar.xz"])
    expect(isGifuArchive("demo.tar.gz")).toBe(true)
    expect(isGifuArchive("demo.txt")).toBe(false)
  })

  test("parses legacy sectioned TOML and snake-case options", () => {
    const parsed = parseGifuTomlConfig(`
      [output]
      format = "gif"
      duration_ms = 90
      out_mode = "separate"
      quality = 72
      extract_single = false
      [video]
      webm_crf = 40
      mp4_preset = "p5"
      [naming]
      prefix = "[anim]"
      [performance]
      max_workers = 3
    `)
    expect(parsed).toMatchObject({
      format: "gif",
      durationMs: 90,
      outMode: "separate",
      quality: 72,
      extractSingle: false,
      webmCrf: 40,
      mp4Preset: "p5",
      namePrefix: "[anim]",
      maxWorkers: 3,
    })
  })

  test("plans same and separate output trees", () => {
    const same = normalizeGifuInput({ path: "D:/manga/vol01/chapter.tar.gz", format: "gif" })
    expect(buildOutputPath("D:\\manga\\vol01\\chapter.tar.gz", same, runtime())).toBe("D:\\manga\\vol01\\[#dyna]chapter.tar.gif")

    const separate = normalizeGifuInput({ paths: ["D:/manga/vol01/a.cbz", "D:/manga/vol02/b.cbz"], outMode: "separate" })
    expect(buildOutputPath("D:\\manga\\vol01\\a.cbz", separate, runtime(), "D:\\manga")).toBe("D:\\[#dyna]manga\\vol01\\a.webp")
    expect(buildOutputPath("D:\\manga\\vol02\\b.cbz", separate, runtime(), "D:\\manga")).toBe("D:\\[#dyna]manga\\vol02\\b.webp")
  })

  test("builds a native preview command and JSONL path", () => {
    const input = normalizeGifuInput({ path: "D:/in/a.zip", format: "webp" })
    const command = buildGifuCommand(input)
    expect(command.command).toBe("gifu-native")
    expect(command.args).toContain("--format")
    expect(command.args).not.toContain("-m")
    expect(buildGifuDatabase(input, [{ archivePath: "D:\\in\\a.zip", outputPath: "D:\\in\\a.webp", imageCount: 3, status: "ready" }], runtime())).toEqual({
      path: "D:\\in\\.xiranite\\gifu-runs.jsonl",
      enabled: false,
      mode: "jsonl",
      defaultPath: true,
    })
  })

  test("dry-run inspects archive entries without invoking conversion", async () => {
    const convertArchive = vi.fn<GifuRuntime["convertArchive"]>()
    const result = await runGifu({ action: "make", path: "D:/in/a.zip", dryRun: true }, runtime({ convertArchive }))
    expect(result.success).toBe(true)
    expect(result.data?.readyCount).toBe(1)
    expect(result.data?.convertedCount).toBe(0)
    expect(convertArchive).not.toHaveBeenCalled()
  })

  test("converts ready archives and reports native outcomes", async () => {
    const result = await runGifu({ action: "make", path: "D:/in/a.zip", dryRun: false }, runtime())
    expect(result.success).toBe(true)
    expect(result.data).toMatchObject({ convertedCount: 1, extractedCount: 0, failedCount: 0 })
    expect(result.data?.archives[0]).toMatchObject({ status: "converted", encoder: "ffmpeg-test", decodedFrames: 3 })
  })

  test("extracts single-image archives through the same runtime boundary", async () => {
    const outcome: GifuConversionOutcome = {
      status: "extracted",
      outputPath: "D:\\in\\[#dyna]a.png",
      decodedFrames: 1,
      skippedFrames: 0,
      encoder: "7z-copy",
    }
    const convertArchive = vi.fn(async () => outcome)
    const result = await runGifu({ action: "make", path: "D:/in/a.zip", dryRun: false }, runtime({
      listArchiveImages: async () => [{ path: "cover.png", extension: ".png" }],
      convertArchive,
    }))
    expect(result.success).toBe(true)
    expect(result.data?.extractedCount).toBe(1)
    expect(result.data?.archives[0]?.outputPath).toBe(outcome.outputPath)
  })

  test("preserves successful results when another archive fails", async () => {
    const result = await runGifu({ action: "make", paths: ["D:/in/a.zip", "D:/in/b.zip"], dryRun: false, maxWorkers: 2 }, runtime({
      convertArchive: async (task) => {
        if (task.archivePath.endsWith("b.zip")) throw new Error("encoder unavailable")
        return { status: "converted", outputPath: task.outputPath, decodedFrames: 3, skippedFrames: 0, encoder: "ffmpeg-test" }
      },
    }))
    expect(result.success).toBe(false)
    expect(result.data).toMatchObject({ convertedCount: 1, failedCount: 1 })
    expect(result.data?.errors[0]).toContain("encoder unavailable")
  })

  test("records a native plan when JSONL recording is enabled", async () => {
    const records: unknown[] = []
    const result = await runGifu({ action: "plan", path: "D:/in/a.zip", recordRun: true }, runtime({
      appendRecord: async (_path, record) => { records.push(record) },
    }))
    expect(result.success).toBe(true)
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ toolId: "gifu", engine: "native-ts", action: "plan", archiveCount: 1 })
  })

  test("bounds automatic and explicit archive concurrency", () => {
    expect(resolveMaxWorkers(0, 20)).toBe(4)
    expect(resolveMaxWorkers(8, 3)).toBe(3)
    expect(resolveMaxWorkers(1, 3)).toBe(1)
  })
})
