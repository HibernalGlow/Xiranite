import { describe, expect, test, vi } from "vitest"
import { normalizeXlchemyInput, runXlchemy, type XlchemyRuntime } from "./core.js"

describe("xlchemy dynar target", () => {
  test("upgrades the prior built-in rule to include the .wbp marker", () => {
    const options = normalizeXlchemyInput({
      filenameRules: [{ id: "builtin-dynar", enabled: true, inputExtensions: [], outputFormats: ["dynar"], outputModes: [], matchTarget: "filename", matcher: "regex", pattern: "^(?!\\\\[#dyna\\\\])", prefix: "[#dyna]", suffix: "" }],
    })

    expect(options.filenameRules[0]).toMatchObject({ id: "builtin-dynar", prefix: "[#dyna]", suffix: ".wbp" })
  })

  test("renames GIFs without probing and detected animations with the default marker", async () => {
    const runtime = dynarRuntime(["/photos/motion.webp", "/photos/loop.gif", "/photos/still.webp", "/photos/still.png"])
    runtime.isAnimatedImage = vi.fn(async (path) => path.endsWith("motion.webp"))

    const result = await runXlchemy(normalizeXlchemyInput({
      action: "convert",
      paths: ["/photos/motion.webp", "/photos/loop.gif", "/photos/still.webp", "/photos/still.png"],
      format: "dynar",
      outputMode: "source",
      excludedFormats: ["webp"],
    }), runtime)

    expect(result.success).toBe(true)
    expect(result.data).toMatchObject({ inputCount: 4, convertedCount: 0, renamedCount: 2, skippedCount: 2, errorCount: 0 })
    expect(result.data?.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourcePath: "/photos/motion.webp", outputPath: "/photos/[#dyna]motion.webp.wbp", status: "renamed" }),
      expect.objectContaining({ sourcePath: "/photos/loop.gif", outputPath: "/photos/[#dyna]loop.gif.wbp", status: "renamed" }),
      expect.objectContaining({ sourcePath: "/photos/still.webp", status: "skipped", error: "not_animated" }),
      expect.objectContaining({ sourcePath: "/photos/still.png", status: "skipped", error: "animation_detection_disabled" }),
    ]))
    expect(runtime.renameFile).toHaveBeenCalledWith("/photos/motion.webp", "/photos/[#dyna]motion.webp.wbp")
    expect(runtime.renameFile).toHaveBeenCalledWith("/photos/loop.gif", "/photos/[#dyna]loop.gif.wbp")
    expect(runtime.isAnimatedImage).not.toHaveBeenCalledWith("/photos/loop.gif")
    expect(runtime.runCommand).not.toHaveBeenCalled()
    expect(runtime.resolveCommand).not.toHaveBeenCalled()
  })

  test("uses dynar-scoped filename rules around the source extension and marker", async () => {
    const runtime = dynarRuntime(["/photos/motion.avif"])
    runtime.isAnimatedImage = vi.fn(async () => true)
    const result = await runXlchemy(normalizeXlchemyInput({
      action: "plan",
      paths: ["/photos/motion.avif"],
      format: "dynar",
      outputMode: "source",
      animationDetectionFormats: ["avif"],
      filenameRules: [{ id: "custom-dynar", enabled: true, inputExtensions: ["avif"], outputFormats: ["dynar"], outputModes: ["source"], matchTarget: "filename", matcher: "glob", pattern: "motion.*", prefix: "animated-", suffix: "-loop" }],
    }), runtime)

    expect(result.data?.files[0]).toMatchObject({ outputPath: "/photos/animated-motion.avif-loop.wbp", status: "planned" })
    expect(runtime.renameFile).not.toHaveBeenCalled()
  })

  test("does not apply the built-in prefix twice while upgrading its extension marker", async () => {
    const runtime = dynarRuntime(["/photos/[#dyna]motion.webp"])
    runtime.isAnimatedImage = vi.fn(async () => true)
    const result = await runXlchemy(normalizeXlchemyInput({ action: "convert", paths: ["/photos/[#dyna]motion.webp"], format: "dynar" }), runtime)

    expect(result.data?.files[0]).toMatchObject({ outputPath: "/photos/[#dyna]motion.webp.wbp", status: "renamed" })
    expect(runtime.renameFile).toHaveBeenCalledWith("/photos/[#dyna]motion.webp", "/photos/[#dyna]motion.webp.wbp")
  })
})

function dynarRuntime(inputPaths: string[]): XlchemyRuntime {
  const files = new Map(inputPaths.map((path) => [path, { size: 100 }]))
  const renameFile = vi.fn(async (source: string, target: string) => {
    const file = files.get(source)
    if (!file) throw new Error(`Missing source: ${source}`)
    files.delete(source)
    files.set(target, file)
  })
  return {
    pathInfo: async (path) => { const file = files.get(path); return { path, exists: Boolean(file), isFile: Boolean(file), isDirectory: false, size: file?.size ?? 0, atimeMs: 10, mtimeMs: 20 } },
    listDir: async () => [],
    ensureDir: async () => undefined,
    copyFile: async () => undefined,
    removeFile: async (path) => { files.delete(path) },
    renameFile,
    setTimes: async () => undefined,
    runCommand: vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" })),
    resolveCommand: vi.fn(async () => undefined),
    join: (...parts) => parts.filter((part) => part && part !== ".").join("/").replace(/\/+/g, "/"),
    dirname: (path) => path.replace(/\/[^/]+$/, "") || "/",
    basename: (path) => path.split("/").at(-1) ?? path,
    extname: (path) => /\.[^.]+$/.exec(path)?.[0] ?? "",
    relative: (from, to) => to.startsWith(`${from}/`) ? to.slice(from.length + 1) : to,
    isAnimatedImage: async () => false,
  }
}
