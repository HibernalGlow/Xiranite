import { describe, expect, test, vi } from "vitest"
import { compressionRatio, discoverImages, normalizeXlchemyInput, runXlchemy, type XlchemyRuntime } from "./core.js"

describe("xlchemy core contract", () => {
  test("uses the standard Q60 effort 6 defaults", () => {
    expect(normalizeXlchemyInput({})).toMatchObject({ quality: 60, effort: 6 })
  })

  test("discovers every format exposed by the GUI filter tags", async () => {
    const runtime = fakeRuntime()
    runtime.listDir = async () => ["jxl", "jpg", "jpeg", "jfif", "jif", "jpe", "png", "apng", "gif", "webp", "jp2", "bmp", "ico", "tiff", "tif", "avif", "psd", "psb", "clip"].map((extension) => ({ path: `/photos/input.${extension}`, name: `input.${extension}`, isFile: true, isDirectory: false }))
    const discovered = await discoverImages(["/photos"], true, runtime)
    expect(discovered).toHaveLength(19)
  })

  test("composites PSD input before passing it to the selected encoder", async () => {
    const runtime = fakeRuntime()
    const result = await runXlchemy(normalizeXlchemyInput({ action: "convert", paths: ["/photos/art.psd"], format: "WebP", outputMode: "source", overwrite: true, preserveMetadata: false }), runtime)
    expect(result.success).toBe(true)
    expect(runtime.commands.slice(0, 2)).toEqual([
      { command: "/bin/magick", args: ["/photos/art.psd[0]", "-alpha", "on", "/photos/art[PSD].webp.xlchemy-layered.png"] },
      { command: "/bin/cwebp", args: ["/photos/art[PSD].webp.xlchemy-layered.png", "-o", "/photos/art[PSD].webp", "-q", "60", "-m", "6"] },
    ])
  })

  test("converts CLIP through an intermediate PSD before encoding", async () => {
    const runtime = fakeRuntime()
    const result = await runXlchemy(normalizeXlchemyInput({ action: "convert", paths: ["/photos/drawing.clip"], format: "PNG", outputMode: "source", overwrite: true, preserveMetadata: false }), runtime)
    expect(result.success).toBe(true)
    expect(runtime.commands.slice(0, 3)).toEqual([
      { command: "clip-to-psd-native", args: ["/photos/drawing.clip", "/photos/drawing[CLIP].png.xlchemy-clip.psd"] },
      { command: "/bin/magick", args: ["/photos/drawing[CLIP].png.xlchemy-clip.psd", "-background", "none", "-layers", "merge", "/photos/drawing[CLIP].png.xlchemy-layered.png"] },
      { command: "/bin/magick", args: ["/photos/drawing[CLIP].png.xlchemy-layered.png", "-define", "png:compression-level=6", "/photos/drawing[CLIP].png"] },
    ])
  })

  test("applies custom filename affixes before existing-file policy", async () => {
    const runtime = fakeRuntime()
    const pathInfo = runtime.pathInfo
    runtime.pathInfo = async (path) => path === "/photos/pre-art-post.webp"
      ? { path, exists: true, isFile: true, isDirectory: false, size: 10, atimeMs: 0, mtimeMs: 0 }
      : pathInfo(path)
    const result = await runXlchemy(normalizeXlchemyInput({ action: "plan", paths: ["/photos/art.psd"], format: "WebP", outputMode: "source", filenameRules: [{ id: "custom", enabled: true, inputExtensions: ["psd"], outputFormats: ["WebP"], outputModes: ["source"], matchTarget: "filename", matcher: "glob", pattern: "art.*", prefix: "pre-", suffix: "-post" }], existingPolicy: "rename" }), runtime)
    expect(result.data?.files[0]?.outputPath).toBe("/photos/pre-art-post_1.webp")
  })
  test("normalizes paths and clamps encoder controls", () => {
    expect(normalizeXlchemyInput({
      paths: [" D:/images/a.png ", "D:/images/a.png", ""],
      quality: 120,
      effort: 0,
      threads: 200,
    })).toMatchObject({
      paths: ["D:/images/a.png"],
      quality: 100,
      effort: 1,
      threads: 64,
      format: "JPEG XL",
      outputMode: "source",
    })
  })

  test("reports saved storage as a bounded percentage", () => {
    expect(compressionRatio({ inputBytes: 1_000, outputBytes: 425 })).toBe(57.5)
    expect(compressionRatio({ inputBytes: 0, outputBytes: 0 })).toBe(0)
    expect(compressionRatio({ inputBytes: 100, outputBytes: 200 })).toBe(0)
  })

  test("discovers folders and preserves their relative structure in plans", async () => {
    const runtime = fakeRuntime()
    const result = await runXlchemy({
      action: "plan", paths: ["/photos"], format: "AVIF", lossless: false, quality: 82, effort: 7, threads: 4,
      outputMode: "directory", outputDir: "/output", preserveMetadata: true, preserveStructure: true, overwrite: false, recursive: true,
    }, runtime)
    expect(result.success).toBe(true)
    expect(result.data?.files.map((file) => file.outputPath)).toEqual(["/output/a.avif", "/output/events/b.avif"])
  })

  test("does not stat every output path when replace policy makes existence irrelevant", async () => {
    const runtime = fakeRuntime()
    const pathInfo = vi.fn(runtime.pathInfo)
    runtime.pathInfo = pathInfo

    const result = await runXlchemy(normalizeXlchemyInput({ action: "plan", paths: ["/photos/a.png"], format: "WebP", existingPolicy: "replace", excludedFormats: [] }), runtime)

    expect(result.success).toBe(true)
    expect(result.data?.files[0]).toMatchObject({ outputPath: "/photos/a.webp", status: "planned" })
    expect(pathInfo).not.toHaveBeenCalledWith("/photos/a.webp")
  })

  test("skips animated WebP while keeping static WebP in the same plan", async () => {
    const runtime = fakeRuntime()
    const inputs = new Set(["/photos/still.webp", "/photos/motion.webp", "/photos/still.png"])
    runtime.listDir = async () => [...inputs].map((path) => ({ path, name: path.split("/").at(-1)!, isFile: true, isDirectory: false }))
    runtime.pathInfo = async (path) => ({ path, exists: path === "/photos" || inputs.has(path), isFile: inputs.has(path), isDirectory: path === "/photos", size: 100, atimeMs: 10, mtimeMs: 20 })
    runtime.isAnimatedImage = async (path) => path.endsWith("motion.webp")

    const result = await runXlchemy(normalizeXlchemyInput({ action: "plan", paths: ["/photos"], format: "PNG", outputMode: "directory", outputDir: "/output", excludedFormats: [] }), runtime)

    expect(result.success).toBe(true)
    expect(result.data).toMatchObject({ inputCount: 3, skippedCount: 1, errorCount: 0 })
    expect(result.data?.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourcePath: "/photos/still.webp", status: "planned" }),
      expect.objectContaining({ sourcePath: "/photos/motion.webp", status: "skipped", error: "animated_image" }),
      expect.objectContaining({ sourcePath: "/photos/still.png", status: "planned" }),
    ]))
  })

  test("does not probe animated APNG, AVIF, or JXL inputs by default", async () => {
    const runtime = fakeRuntime()
    const inputs = new Set(["/photos/animated.apng", "/photos/animated.avif", "/photos/animated.jxl"])
    runtime.listDir = async () => [...inputs].map((path) => ({ path, name: path.split("/").at(-1)!, isFile: true, isDirectory: false }))
    runtime.pathInfo = async (path) => ({ path, exists: path === "/photos" || inputs.has(path), isFile: inputs.has(path), isDirectory: path === "/photos", size: 100, atimeMs: 10, mtimeMs: 20 })
    runtime.isAnimatedImage = vi.fn(async () => false)

    const result = await runXlchemy(normalizeXlchemyInput({ action: "plan", paths: ["/photos"], format: "TIFF", excludedFormats: [] }), runtime)

    expect(result.success).toBe(true)
    expect(result.data?.inputCount).toBe(3)
    expect(runtime.isAnimatedImage).not.toHaveBeenCalled()
  })

  test("can explicitly enable APNG, AVIF, and JXL animation detection", async () => {
    const runtime = fakeRuntime()
    const inputs = new Set(["/photos/animated.apng", "/photos/animated.avif", "/photos/animated.jxl"])
    runtime.listDir = async () => [...inputs].map((path) => ({ path, name: path.split("/").at(-1)!, isFile: true, isDirectory: false }))
    runtime.pathInfo = async (path) => ({ path, exists: path === "/photos" || inputs.has(path), isFile: inputs.has(path), isDirectory: path === "/photos", size: 100, atimeMs: 10, mtimeMs: 20 })
    runtime.isAnimatedImage = vi.fn(async () => true)

    const result = await runXlchemy(normalizeXlchemyInput({ action: "plan", paths: ["/photos"], format: "TIFF", excludedFormats: [], animationDetectionFormats: ["png", "avif", "jxl"] }), runtime)

    expect(result.success).toBe(true)
    expect(result.data).toMatchObject({ inputCount: 3, skippedCount: 3, errorCount: 0 })
    expect(runtime.isAnimatedImage).toHaveBeenCalledTimes(3)
  })

  test("runs a native encoder and records the output size", async () => {
    const runtime = fakeRuntime()
    const result = await runXlchemy({
      action: "convert", paths: ["/photos/a.png"], format: "WebP", lossless: false, quality: 80, effort: 6, threads: 2,
      outputMode: "source", preserveMetadata: false, preserveStructure: true, overwrite: true, recursive: true,
    }, runtime)
    expect(result.success).toBe(true)
    expect(runtime.commands[0]).toEqual({ command: "/bin/cwebp", args: ["/photos/a.png", "-o", "/photos/a.webp", "-q", "80", "-m", "6"] })
    expect(result.data?.files[0]).toMatchObject({ status: "converted", outputBytes: 400 })
  })

  test("uses current source size for keep-if-larger without preserving timestamps", async () => {
    const runtime = fakeRuntime()
    const originalPathInfo = runtime.pathInfo
    const originalRunCommand = runtime.runCommand
    let encoded = false
    runtime.pathInfo = async (path) => path === "/photos/a.png" && encoded
      ? { path, exists: true, isFile: true, isDirectory: false, size: 300, atimeMs: 30, mtimeMs: 40 }
      : originalPathInfo(path)
    runtime.runCommand = async (command, args, isCancelled) => {
      const result = await originalRunCommand(command, args, isCancelled)
      encoded = true
      return result
    }
    runtime.setTimes = vi.fn(async () => undefined)

    const result = await runXlchemy(normalizeXlchemyInput({
      action: "convert",
      paths: ["/photos/a.png"],
      format: "WebP",
      outputMode: "source",
      existingPolicy: "replace",
      preserveMetadata: false,
      preserveTimestamps: false,
      keepIfLarger: true,
      copyIfLarger: false,
    }), runtime)

    expect(result.success).toBe(true)
    expect(result.data?.files[0]).toMatchObject({ status: "skipped", outputBytes: 0, error: "output_not_smaller" })
    expect(runtime.setTimes).not.toHaveBeenCalled()
  })

  test("emits incremental result snapshots while converting", async () => {
    const events: Array<{ progress?: number; data?: unknown }> = []
    const result = await runXlchemy({
      action: "convert", paths: ["/photos/a.png"], format: "WebP", lossless: false, quality: 80, effort: 6, threads: 2,
      outputMode: "source", preserveMetadata: false, preserveStructure: true, overwrite: true, recursive: true,
    }, fakeRuntime(), (event) => events.push(event))
    expect(result.success).toBe(true)
    expect(events.find((event) => (event.data as { kind?: string } | undefined)?.kind === "xlchemy-live-result")?.data).toMatchObject({
      result: { convertedCount: 1, files: [{ sourcePath: "/photos/a.png", status: "converted" }] },
    })
  })

  test("streams large EFU inputs with bounded result and event details", async () => {
    const runtime = fakeRuntime()
    const originalPathInfo = runtime.pathInfo
    runtime.pathInfo = async (path) => /^\/bulk\/\d+\.png$/.test(path)
      ? { path, exists: true, isFile: true, isDirectory: false, size: 100, atimeMs: 0, mtimeMs: 0 }
      : originalPathInfo(path)
    let efuPasses = 0
    runtime.streamEfuPaths = async function* () {
      efuPasses += 1
      for (let index = 0; index < 2_500; index += 1) yield `/bulk/${index}.png`
    }
    const events: Array<{ data?: unknown; message?: string; progress?: number }> = []
    const result = await runXlchemy(normalizeXlchemyInput({ action: "plan", paths: [], efuFiles: ["/lists/large.efu"], format: "WebP" }), runtime, (event) => events.push(event))
    const snapshots = events.flatMap((event) => (event.data as { kind?: string; result?: { files: unknown[] } } | undefined)?.kind === "xlchemy-live-result" ? [event.data as { result: { files: unknown[] } }] : [])
    expect(result.success).toBe(true)
    expect(result.data).toMatchObject({
      inputCount: 2_500,
      detailsTruncated: true,
      inputAnalysis: {
        totalFiles: 2_500,
        totalSize: 250_000,
        minSize: 100,
        medianSize: 100,
        maxSize: 100,
        formats: [{ key: "png", count: 2_500, size: 250_000 }],
        folders: [{ key: "bulk", count: 2_500, size: 250_000 }],
        sampled: true,
      },
    })
    expect(result.data?.files).toHaveLength(1_000)
    expect(result.data?.files.at(-1)?.sourcePath).toBe("/bulk/2499.png")
    expect(efuPasses).toBe(1)
    expect(snapshots.length).toBeLessThan(10)
    expect(Math.max(...snapshots.map((snapshot) => snapshot.result.files.length))).toBeLessThanOrEqual(20)
    expect(events.some((event) => typeof event.progress === "number" && event.progress > 0 && event.progress < 100)).toBe(true)
    expect(events.map((event) => event.message)).toEqual(expect.arrayContaining([
      expect.stringMatching(/^Task configured: plan;/),
      expect.stringMatching(/^Bounded state: final details 1000,/),
      expect.stringMatching(/^EFU stream opened: large\.efu;/),
      expect.stringMatching(/^EFU stream completed: large\.efu; read 2500, accepted 2500, filtered 0/),
      expect.stringMatching(/^Result state: retained 1000\/2500/),
    ]))
  })

  test("reports filtered extensions when an EFU contains no supported images", async () => {
    const runtime = fakeRuntime()
    runtime.streamEfuPaths = async function* () {
      yield "/archives/a.zip"
      yield "/archives/b.ZIP"
    }
    const events: Array<{ message?: string }> = []

    const result = await runXlchemy(normalizeXlchemyInput({
      action: "convert",
      paths: [],
      efuFiles: ["/lists/archives.efu"],
      format: "AVIF",
      avifEncoder: "slimg",
    }), runtime, (event) => events.push(event))

    expect(result).toMatchObject({
      success: false,
      message: "No supported images were found. EFU read 2 path(s), accepted 0, and filtered 2 (.zip: 2).",
    })
    expect(events.map((event) => event.message)).toEqual(expect.arrayContaining([
      expect.stringMatching(/^Input stream completed after \d+\.\d{2}s without supported images\. No supported images were found\. EFU read 2 path\(s\), accepted 0, and filtered 2 \(\.zip: 2\)\.$/),
    ]))
  })

  test("bounds input analysis folder state while retaining exact totals", async () => {
    const runtime = fakeRuntime()
    const originalPathInfo = runtime.pathInfo
    runtime.pathInfo = async (path) => /^\/many\/folder-\d+\/image\.png$/.test(path)
      ? { path, exists: true, isFile: true, isDirectory: false, size: 10, atimeMs: 0, mtimeMs: 0 }
      : originalPathInfo(path)
    runtime.streamEfuPaths = async function* () {
      for (let index = 0; index < 100; index += 1) yield `/many/folder-${index}/image.png`
    }

    const result = await runXlchemy(normalizeXlchemyInput({ action: "plan", paths: [], efuFiles: ["/lists/folders.efu"], format: "WebP", excludedFormats: [] }), runtime)

    expect(result.data?.inputAnalysis).toMatchObject({ totalFiles: 100, totalSize: 1_000, sampled: true })
    expect(result.data?.inputAnalysis?.folders).toHaveLength(64)
    expect(result.data?.inputAnalysis?.folders).toContainEqual({ key: "其他", count: 37, size: 370 })
  })

  test("starts ordered EFU conversion before EOF without a counting pass", async () => {
    const runtime = fakeRuntime()
    const originalPathInfo = runtime.pathInfo
    runtime.pathInfo = async (path) => /^\/stream\/\d+\.png$/.test(path)
      ? { path, exists: true, isFile: true, isDirectory: false, size: 100, atimeMs: 0, mtimeMs: 0 }
      : originalPathInfo(path)
    const originalRunCommand = runtime.runCommand
    let efuPasses = 0
    let firstEncodeAtYield = 0
    let yielded = 0
    runtime.streamEfuPaths = async function* () {
      efuPasses += 1
      for (let index = 0; index < 256; index += 1) {
        if (index === 128 && firstEncodeAtYield === 0) throw new Error("EFU reached the second ordering window before conversion started")
        yielded += 1
        yield `/stream/${index}.png`
      }
    }
    runtime.runCommand = async (command, args, isCancelled) => {
      if (firstEncodeAtYield === 0) firstEncodeAtYield = yielded
      return originalRunCommand(command, args, isCancelled)
    }

    const result = await runXlchemy(normalizeXlchemyInput({
      action: "convert",
      paths: [],
      efuFiles: ["/lists/large.efu"],
      format: "WebP",
      threads: 4,
      processingOrder: "size-desc",
      excludedFormats: [],
      overwrite: true,
      preserveMetadata: false,
    }), runtime)

    expect(result.success).toBe(true)
    expect(result.data).toMatchObject({ inputCount: 256, convertedCount: 256 })
    expect(efuPasses).toBe(1)
    expect(firstEncodeAtYield).toBeGreaterThan(0)
    expect(firstEncodeAtYield).toBeLessThan(256)
  })

  test("streams directory entries into conversion before enumeration completes", async () => {
    const runtime = fakeRuntime()
    const originalPathInfo = runtime.pathInfo
    runtime.pathInfo = async (path) => path === "/stream-folder"
      ? { path, exists: true, isFile: false, isDirectory: true, size: 0, atimeMs: 0, mtimeMs: 0 }
      : /^\/stream-folder\/\d+\.png$/.test(path)
        ? { path, exists: true, isFile: true, isDirectory: false, size: 100, atimeMs: 0, mtimeMs: 0 }
        : originalPathInfo(path)
    const originalRunCommand = runtime.runCommand
    let firstEncodeAtYield = 0
    let yielded = 0
    runtime.listDir = vi.fn(async () => { throw new Error("materialized directory listing used") })
    runtime.streamDir = async function* () {
      for (let index = 0; index < 128; index += 1) {
        if (index === 64 && firstEncodeAtYield === 0) throw new Error("directory enumeration outran conversion")
        yielded += 1
        yield { path: `/stream-folder/${index}.png`, name: `${index}.png`, isFile: true, isDirectory: false }
      }
    }
    runtime.runCommand = async (command, args, isCancelled) => {
      if (firstEncodeAtYield === 0) firstEncodeAtYield = yielded
      return originalRunCommand(command, args, isCancelled)
    }

    const result = await runXlchemy(normalizeXlchemyInput({
      action: "convert",
      paths: ["/stream-folder"],
      format: "WebP",
      threads: 4,
      excludedFormats: [],
      overwrite: true,
      preserveMetadata: false,
    }), runtime)

    expect(result.success).toBe(true)
    expect(result.data).toMatchObject({ inputCount: 128, convertedCount: 128 })
    expect(runtime.listDir).not.toHaveBeenCalled()
    expect(firstEncodeAtYield).toBeGreaterThan(0)
    expect(firstEncodeAtYield).toBeLessThan(128)
  })

  test("does not feed source-mode outputs or internal artifacts back into an open directory stream", async () => {
    const runtime = fakeRuntime()
    const originalPathInfo = runtime.pathInfo
    runtime.pathInfo = async (path) => path === "/source-loop"
      ? { path, exists: true, isFile: false, isDirectory: true, size: 0, atimeMs: 0, mtimeMs: 0 }
      : path === "/source-loop/a.png"
        ? { path, exists: true, isFile: true, isDirectory: false, size: 100, atimeMs: 0, mtimeMs: 0 }
        : originalPathInfo(path)
    runtime.listDir = vi.fn(async () => { throw new Error("materialized directory listing used") })
    runtime.streamDir = async function* () {
      yield { path: "/source-loop/a.png", name: "a.png", isFile: true, isDirectory: false }
      yield { path: "/source-loop/a.avif", name: "a.avif", isFile: true, isDirectory: false }
      yield { path: "/source-loop/a.avif.xlchemy-input.png", name: "a.avif.xlchemy-input.png", isFile: true, isDirectory: false }
    }

    const result = await runXlchemy(normalizeXlchemyInput({
      action: "convert", paths: ["/source-loop"], format: "AVIF", avifEncoder: "slimg",
      threads: 4, outputMode: "source", excludedFormats: [], overwrite: true, preserveMetadata: false,
    }), runtime)

    expect(result.success).toBe(true)
    expect(result.data).toMatchObject({ inputCount: 1, convertedCount: 1, errorCount: 0 })
    expect(runtime.commands).toEqual([{ command: "slimg-cffi", args: ["/source-loop/a.png", "/source-loop/a.avif", "60"] }])
    expect(runtime.listDir).not.toHaveBeenCalled()
  })

  test("does not recurse into a generated output directory nested below an input root", async () => {
    const runtime = fakeRuntime()
    const originalPathInfo = runtime.pathInfo
    runtime.pathInfo = async (path) => path === "/nested-source"
      ? { path, exists: true, isFile: false, isDirectory: true, size: 0, atimeMs: 0, mtimeMs: 0 }
      : path === "/nested-source/a.png"
        ? { path, exists: true, isFile: true, isDirectory: false, size: 100, atimeMs: 0, mtimeMs: 0 }
        : originalPathInfo(path)
    const openedDirectories: string[] = []
    runtime.listDir = vi.fn(async () => { throw new Error("materialized directory listing used") })
    runtime.streamDir = async function* (path) {
      openedDirectories.push(path)
      if (path === "/nested-source") {
        yield { path: "/nested-source/a.png", name: "a.png", isFile: true, isDirectory: false }
        yield { path: "/nested-source/output", name: "output", isFile: false, isDirectory: true }
      } else if (path === "/nested-source/output") {
        yield { path: "/nested-source/output/a.avif", name: "a.avif", isFile: true, isDirectory: false }
      }
    }

    const result = await runXlchemy(normalizeXlchemyInput({
      action: "convert", paths: ["/nested-source"], format: "AVIF", avifEncoder: "slimg",
      threads: 4, outputMode: "directory", outputDir: "/nested-source/output", excludedFormats: [], overwrite: true, preserveMetadata: false,
    }), runtime)

    expect(result.success).toBe(true)
    expect(result.data).toMatchObject({ inputCount: 1, convertedCount: 1, errorCount: 0 })
    expect(openedDirectories).toEqual(["/nested-source"])
    expect(runtime.listDir).not.toHaveBeenCalled()
  })

  test("diagnoses PATH tools without requiring input files or leaking probe arguments", async () => {
    const runtime = fakeRuntime()
    runtime.resolveCommand = async (candidates) => candidates[0] === "oxipng" ? undefined : `/bin/${candidates[0]}`
    runtime.runCommand = async (command, args) => {
      runtime.commands.push({ command, args })
      return command.endsWith("cjpegli")
        ? { exitCode: 1, stdout: "", stderr: "Unknown argument: --version" }
        : { exitCode: 0, stdout: `${command} 1.0`, stderr: "" }
    }
    const result = await runXlchemy(normalizeXlchemyInput({ action: "diagnose", paths: [] }), runtime)
    expect(result.success).toBe(true)
    expect(result.data?.environment?.find((tool) => tool.id === "oxipng")).toMatchObject({ available: false, runnable: false })
    expect(result.data?.environment?.find((tool) => tool.id === "cjpegli")).toMatchObject({ available: true, runnable: true })
    expect(result.data?.environment?.find((tool) => tool.id === "slimg")).toMatchObject({ available: true, runnable: true })
    expect(result.data?.environment?.find((tool) => tool.id === "slimg-cffi")).toMatchObject({ available: true, runnable: true })
    expect(result.data?.environment?.some((tool) => "versionArgs" in tool)).toBe(false)
  })

  test("uses the slimg DLL runtime instead of passing slimg to avifenc", async () => {
    const runtime = fakeRuntime()
    const result = await runXlchemy(normalizeXlchemyInput({ action: "convert", paths: ["/photos/a.png"], format: "AVIF", avifEncoder: "slimg", threads: 8, outputMode: "source", overwrite: true, preserveMetadata: false }), runtime)
    expect(result.success).toBe(true)
    expect(runtime.commands).toEqual([{ command: "slimg-cffi", args: ["/photos/a.png", "/photos/a.avif", "60"] }])
    expect(result.data?.files[0]).toMatchObject({ status: "converted", outputBytes: 350 })
  })

  test("uses the slimg CLI when that backend is selected", async () => {
    const runtime = fakeRuntime()
    const result = await runXlchemy(normalizeXlchemyInput({ action: "convert", paths: ["/photos/a.png"], format: "AVIF", avifEncoder: "slimg", slimgBackend: "cli", threads: 8, outputMode: "source", overwrite: true, preserveMetadata: false }), runtime)
    expect(result.success).toBe(true)
    expect(runtime.commands).toEqual([{ command: "/bin/slimg", args: ["convert", "--format", "avif", "--quality", "60", "--output", "/photos/a.avif", "--overwrite", "--jobs", "1", "/photos/a.png"] }])
    expect(result.data?.files[0]).toMatchObject({ status: "converted", outputBytes: 350 })
  })

  test("passes only planned files to slimg when a directory contains excluded and completed files", async () => {
    const runtime = fakeRuntime()
    const sources = new Set(["/photos/selected.png", "/photos/completed.png", "/photos/excluded.webp"])
    const originalPathInfo = runtime.pathInfo
    runtime.listDir = async () => [...sources].map((path) => ({
      path,
      name: path.split("/").at(-1)!,
      isFile: true,
      isDirectory: false,
    }))
    runtime.pathInfo = async (path) => {
      if (sources.has(path)) return { path, exists: true, isFile: true, isDirectory: false, size: 1_000, atimeMs: 0, mtimeMs: 0 }
      if (path === "/photos/completed.avif") return { path, exists: true, isFile: true, isDirectory: false, size: 350, atimeMs: 0, mtimeMs: 0 }
      return originalPathInfo(path)
    }
    const events: Array<{ message?: string }> = []

    const result = await runXlchemy(normalizeXlchemyInput({
      action: "convert",
      paths: ["/photos"],
      format: "AVIF",
      avifEncoder: "slimg",
      threads: 4,
      outputMode: "source",
      existingPolicy: "skip",
      preserveMetadata: false,
      excludedFormats: ["webp"],
    }), runtime, (event) => events.push(event))

    const slimgCommands = runtime.commands.filter((item) => item.command === "slimg-cffi")
    expect(result.success).toBe(true)
    expect(result.data).toMatchObject({ inputCount: 2, convertedCount: 1, skippedCount: 1 })
    expect(slimgCommands).toHaveLength(1)
    expect(slimgCommands[0]?.args[0]).toBe("/photos/selected.png")
    expect(slimgCommands[0]?.args).not.toContain("/photos")
    expect(events.find((event) => event.message?.startsWith("Batch scheduler:"))?.message).toContain("one single-threaded CFFI call per worker")
  })

  test("plans skip-policy files concurrently without a global rename lock", async () => {
    const runtime = fakeRuntime()
    const inputs = new Set(Array.from({ length: 8 }, (_, index) => `/parallel/${index}.png`))
    const outputs = new Set<string>()
    let activeSourceReads = 0
    let peakSourceReads = 0
    runtime.pathInfo = async (path) => {
      if (inputs.has(path)) {
        activeSourceReads += 1
        peakSourceReads = Math.max(peakSourceReads, activeSourceReads)
        await new Promise((resolve) => setTimeout(resolve, 5))
        activeSourceReads -= 1
        return { path, exists: true, isFile: true, isDirectory: false, size: 1_000, atimeMs: 0, mtimeMs: 0 }
      }
      if (outputs.has(path)) return { path, exists: true, isFile: true, isDirectory: false, size: 350, atimeMs: 0, mtimeMs: 0 }
      return { path, exists: false, isFile: false, isDirectory: false, size: 0, atimeMs: 0, mtimeMs: 0 }
    }
    runtime.runCommand = async (command, args) => {
      runtime.commands.push({ command, args })
      outputs.add(args[args.indexOf("--output") + 1]!)
      await new Promise((resolve) => setTimeout(resolve, 5))
      return { exitCode: 0, stdout: "", stderr: "" }
    }
    runtime.convertWithSlimg = async (_source, target) => {
      outputs.add(target)
      await new Promise((resolve) => setTimeout(resolve, 5))
    }

    const result = await runXlchemy(normalizeXlchemyInput({
      action: "convert",
      paths: [...inputs],
      format: "AVIF",
      avifEncoder: "slimg",
      threads: 8,
      outputMode: "source",
      existingPolicy: "skip",
      preserveMetadata: false,
      excludedFormats: [],
    }), runtime)

    expect(result.success).toBe(true)
    expect(peakSourceReads).toBeGreaterThan(1)
    expect(result.data?.convertedCount).toBe(8)
  })

  test("requests one CPU unit for each in-process slimg DLL worker and releases the lease", async () => {
    const runtime = fakeRuntime()
    const release = vi.fn()
    runtime.acquireWorker = vi.fn(async () => ({ threads: 1, release }))
    const events: Array<{ message: string }> = []
    const result = await runXlchemy(normalizeXlchemyInput({
      action: "convert",
      paths: ["/photos/a.png"],
      format: "AVIF",
      avifEncoder: "slimg",
      threads: 8,
      outputMode: "source",
      overwrite: true,
      preserveMetadata: false,
    }), runtime, (event) => events.push(event))
    expect(result.success).toBe(true)
    expect(runtime.acquireWorker).toHaveBeenCalledWith(1, 432, undefined)
    expect(runtime.commands).toEqual([{ command: "slimg-cffi", args: ["/photos/a.png", "/photos/a.avif", "60"] }])
    expect(release).toHaveBeenCalledOnce()
    expect(events.find((event) => event.message.startsWith("Global resource admission:"))?.message).toContain("approximately 432 MiB")
  })

  test("distributes the original thread budget across concurrent AOM workers", async () => {
    const runtime = fakeRuntime()
    const originalPathInfo = runtime.pathInfo
    runtime.pathInfo = async (path) => /^\/batch\/[abc]\.png$/.test(path)
      ? { path, exists: true, isFile: true, isDirectory: false, size: 1_000, atimeMs: 0, mtimeMs: 0 }
      : originalPathInfo(path)
    const originalRunCommand = runtime.runCommand
    let activeEncoders = 0
    let peakActiveEncoders = 0
    runtime.runCommand = async (command, args, isCancelled) => {
      activeEncoders += 1
      peakActiveEncoders = Math.max(peakActiveEncoders, activeEncoders)
      await new Promise((resolve) => setTimeout(resolve, 10))
      try { return await originalRunCommand(command, args, isCancelled) }
      finally { activeEncoders -= 1 }
    }
    const events: Array<{ type: string; message: string }> = []
    const result = await runXlchemy(normalizeXlchemyInput({
      action: "convert",
      paths: ["/batch/a.png", "/batch/b.png", "/batch/c.png"],
      format: "AVIF",
      avifEncoder: "aom",
      quality: 60,
      effort: 6,
      threads: 6,
      outputMode: "source",
      overwrite: true,
      preserveMetadata: false,
      excludedFormats: [],
    }), runtime, (event) => events.push(event))
    expect(result.success).toBe(true)
    expect(peakActiveEncoders).toBe(3)
    expect(runtime.commands.filter((item) => item.command.endsWith("avifenc"))).toHaveLength(3)
    expect(runtime.commands.some((item) => item.command === "slimg-cffi")).toBe(false)
    expect(runtime.commands.filter((item) => item.command.endsWith("avifenc")).every((item) => item.args.includes("2"))).toBe(true)
    expect(events.find((event) => event.message.startsWith("Batch scheduler:"))?.message).toContain("3 worker(s); CPU thread budget 6; encoder threads 2 each")
    expect(events.find((event) => event.message.startsWith("Batch completed"))?.message).toContain("peak active files 3")
  })

  test("runs one single-threaded slimg DLL call per CPU unit", async () => {
    const runtime = fakeRuntime()
    const inputs = Array.from({ length: 30 }, (_, index) => `/slimg/${index}.png`)
    runtime.ensureDir = vi.fn(runtime.ensureDir)
    const originalPathInfo = runtime.pathInfo
    runtime.pathInfo = async (path) => inputs.includes(path)
      ? { path, exists: true, isFile: true, isDirectory: false, size: 1_000, atimeMs: 0, mtimeMs: 0 }
      : originalPathInfo(path)
    const release = vi.fn()
    const acquireWorker = vi.fn(async (threads: number) => ({ threads, release }))
    runtime.acquireWorker = acquireWorker
    let activeEncoders = 0
    let peakActiveEncoders = 0
    const originalConvertWithSlimg = runtime.convertWithSlimg!
    runtime.convertWithSlimg = async (source, target, quality) => {
      activeEncoders += 1
      peakActiveEncoders = Math.max(peakActiveEncoders, activeEncoders)
      await new Promise((resolve) => setTimeout(resolve, 10))
      try { return await originalConvertWithSlimg(source, target, quality) }
      finally { activeEncoders -= 1 }
    }

    const events: Array<{ message: string }> = []
    const result = await runXlchemy(normalizeXlchemyInput({
      action: "convert",
      paths: inputs,
      format: "AVIF",
      avifEncoder: "slimg",
      quality: 64,
      effort: 6,
      threads: 22,
      outputMode: "source",
      overwrite: true,
      preserveMetadata: false,
      excludedFormats: [],
    }), runtime, (event) => events.push(event))

    const commands = runtime.commands.filter((item) => item.command === "slimg-cffi")
    expect(result.success).toBe(true)
    expect(peakActiveEncoders).toBe(16)
    expect(acquireWorker).toHaveBeenCalledTimes(30)
    expect(acquireWorker.mock.calls.every(([threads]) => threads === 1)).toBe(true)
    expect(commands).toHaveLength(30)
    expect(runtime.ensureDir).toHaveBeenCalledOnce()
    expect(runtime.ensureDir).toHaveBeenCalledWith("/slimg")
    expect(events.find((event) => event.message.startsWith("Batch scheduler:"))?.message).toContain("16 worker(s); CPU thread budget 22; encoder threads 1 each")
    expect(events.find((event) => event.message.startsWith("Batch completed"))?.message).toContain("peak active files 16; peak active encoders 16")
    expect(release).toHaveBeenCalledTimes(30)
  })

  test("caps in-flight files while preserving a large encoder thread budget", async () => {
    const runtime = fakeRuntime()
    const originalPathInfo = runtime.pathInfo
    runtime.pathInfo = async (path) => /^\/guarded\/\d+\.png$/.test(path)
      ? { path, exists: true, isFile: true, isDirectory: false, size: 1_000, atimeMs: 0, mtimeMs: 0 }
      : originalPathInfo(path)
    runtime.streamEfuPaths = async function* () {
      for (let index = 0; index < 32; index += 1) yield `/guarded/${index}.png`
    }
    const checkMemory = vi.fn()
    runtime.checkMemory = checkMemory
    const originalRunCommand = runtime.runCommand
    let activeEncoders = 0
    let peakActiveEncoders = 0
    runtime.runCommand = async (command, args, isCancelled) => {
      activeEncoders += 1
      peakActiveEncoders = Math.max(peakActiveEncoders, activeEncoders)
      await new Promise((resolve) => setTimeout(resolve, 10))
      try { return await originalRunCommand(command, args, isCancelled) }
      finally { activeEncoders -= 1 }
    }

    const events: Array<{ message: string }> = []
    const result = await runXlchemy(normalizeXlchemyInput({
      action: "convert",
      paths: [],
      efuFiles: ["/lists/guarded.efu"],
      format: "AVIF",
      avifEncoder: "aom",
      threads: 60,
      outputMode: "source",
      overwrite: true,
      preserveMetadata: false,
      excludedFormats: [],
    }), runtime, (event) => events.push(event))

    const commands = runtime.commands.filter((item) => item.command.endsWith("avifenc"))
    const firstWaveJobs = commands.slice(0, 16).map((item) => Number(item.args[item.args.indexOf("-j") + 1]))
    expect(result.success).toBe(true)
    expect(peakActiveEncoders).toBe(16)
    expect(firstWaveJobs.reduce((sum, jobs) => sum + jobs, 0)).toBe(60)
    expect(events.find((event) => event.message.startsWith("Batch scheduler:"))?.message).toContain("16 worker(s); CPU thread budget 60")
    expect(checkMemory).toHaveBeenCalled()
  })

  test("serializes colliding outputs and preserves rename and skip policies", async () => {
    for (const existingPolicy of ["rename", "skip"] as const) {
      const runtime = fakeRuntime()
      const inputs = new Set(["/batch/same.png", "/batch/same.jpg"])
      const originalPathInfo = runtime.pathInfo
      runtime.pathInfo = async (path) => inputs.has(path)
        ? { path, exists: true, isFile: true, isDirectory: false, size: 1_000, atimeMs: 0, mtimeMs: 0 }
        : originalPathInfo(path)
      const originalRunCommand = runtime.runCommand
      runtime.runCommand = async (command, args, isCancelled) => {
        await new Promise((resolve) => setTimeout(resolve, 5))
        return originalRunCommand(command, args, isCancelled)
      }
      const result = await runXlchemy(normalizeXlchemyInput({
        action: "convert",
        paths: [...inputs],
        format: "AVIF",
        avifEncoder: "aom",
        threads: 2,
        outputMode: "source",
        existingPolicy,
        preserveMetadata: false,
        excludedFormats: [],
      }), runtime)
      expect(result.success).toBe(true)
      if (existingPolicy === "rename") {
        expect(result.data?.files.map((file) => file.outputPath).sort()).toEqual(["/batch/same.avif", "/batch/same_1.avif"])
        expect(result.data).toMatchObject({ convertedCount: 2, skippedCount: 0 })
      } else expect(result.data).toMatchObject({ convertedCount: 1, skippedCount: 1 })
    }
  })

  test("uses FFmpeg SVT-AV1 for SVT AVIF encoding", async () => {
    const runtime = fakeRuntime()
    const result = await runXlchemy(normalizeXlchemyInput({ action: "convert", paths: ["/photos/a.png"], format: "AVIF", avifEncoder: "svt", quality: 60, effort: 7, threads: 4, outputMode: "source", overwrite: true, preserveMetadata: false }), runtime)
    expect(result.success).toBe(true)
    expect(runtime.commands.at(-1)).toEqual({ command: "/bin/ffmpeg", args: ["-hide_banner", "-loglevel", "error", "-y", "-i", "/photos/a.png", "-frames:v", "1", "-c:v", "libsvtav1", "-preset", "4", "-crf", "25", "-threads", "4", "-pix_fmt", "yuv420p", "-f", "avif", "/photos/a.avif"] })
    expect(runtime.commands.some((item) => item.command === "slimg-cffi")).toBe(false)
  })

  test("passes AVIF chroma subsampling through to the SVT pixel format", async () => {
    const runtime = fakeRuntime()
    const result = await runXlchemy(normalizeXlchemyInput({ action: "convert", paths: ["/photos/a.png"], format: "AVIF", avifEncoder: "svt", avifBitDepth: "10", chromaSubsampling: "444", outputMode: "source", overwrite: true, preserveMetadata: false }), runtime)
    expect(result.success).toBe(true)
    expect(runtime.commands.at(-1)?.args).toContain("yuv444p10le")
  })

  test("applies original dynamic RAM rules to high-memory SVT encoding", async () => {
    const runtime = fakeRuntime()
    const runCommand = runtime.runCommand
    runtime.runCommand = async (command, args) => args[0] === "identify"
      ? (runtime.commands.push({ command, args }), { exitCode: 0, stdout: "4000 2200", stderr: "" })
      : runCommand(command, args)
    const result = await runXlchemy(normalizeXlchemyInput({ action: "convert", paths: ["/photos/a.png"], format: "AVIF", avifEncoder: "svt", threads: 16, outputMode: "source", overwrite: true, preserveMetadata: false }), runtime)
    expect(result.success).toBe(true)
    expect(runtime.commands[0]?.args[0]).toBe("identify")
    expect(runtime.commands.at(-1)?.args).toContain("4")
    expect(runtime.commands.at(-1)?.args.slice(-7, -5)).toEqual(["-threads", "4"])
  })

  test("runs JPEG XL effort 7 and 9 and keeps the smaller intelligent-effort result", async () => {
    const runtime = fakeRuntime()
    const result = await runXlchemy(normalizeXlchemyInput({ action: "convert", paths: ["/photos/a.png"], format: "JPEG XL", intelligentEffort: true, quality: 60, effort: 4, outputMode: "source", overwrite: true, preserveMetadata: false, ramOptimizer: "disabled" }), runtime)
    expect(result.success).toBe(true)
    expect(runtime.commands).toHaveLength(2)
    expect(runtime.commands[0]?.args).toContain("7")
    expect(runtime.commands[1]?.args).toContain("9")
    expect(result.data?.files[0]).toMatchObject({ outputPath: "/photos/a.jxl", outputBytes: 150, status: "converted" })
  })

  test("uses effort 9 directly for lossless intelligent JPEG XL", async () => {
    const runtime = fakeRuntime()
    const result = await runXlchemy(normalizeXlchemyInput({ action: "convert", paths: ["/photos/a.png"], format: "JPEG XL", intelligentEffort: true, lossless: true, effort: 4, outputMode: "source", overwrite: true, preserveMetadata: false, ramOptimizer: "disabled" }), runtime)
    expect(result.success).toBe(true)
    expect(runtime.commands).toHaveLength(1)
    expect(runtime.commands[0]?.args).toContain("9")
  })

  test("accepts JXL input for JPEG reconstruction even when JXL is globally excluded", async () => {
    const runtime = fakeRuntime()
    const result = await runXlchemy(normalizeXlchemyInput({ action: "convert", paths: ["/photos/a.jxl"], format: "JPEG Reconstruction", outputMode: "source", overwrite: true, preserveMetadata: false }), runtime)
    expect(result.success).toBe(true)
    expect(runtime.commands.at(-1)).toEqual({ command: "/bin/djxl", args: ["--num_threads", "4", "/photos/a.jxl", "/photos/a.jpg"] })
  })

  test("decodes JPEG XL without reconstruction data to PNG only when fallback is enabled", async () => {
    const runtime = fakeRuntime()
    const runCommand = runtime.runCommand
    runtime.runCommand = async (command, args) => command.endsWith("jxlinfo") ? (runtime.commands.push({ command, args }), { exitCode: 0, stdout: "JPEG XL image, no reconstruction payload", stderr: "" }) : runCommand(command, args)
    const fallback = await runXlchemy(normalizeXlchemyInput({ action: "convert", paths: ["/photos/a.jxl"], format: "JPEG Reconstruction", jxlPngFallback: true, outputMode: "source", overwrite: true, preserveMetadata: false }), runtime)
    expect(fallback.success).toBe(true)
    expect(fallback.data?.files[0]).toMatchObject({ outputPath: "/photos/a.png", status: "converted" })
    const rejected = await runXlchemy(normalizeXlchemyInput({ action: "convert", paths: ["/photos/a.jxl"], format: "JPEG Reconstruction", jxlPngFallback: false, outputMode: "source", overwrite: true, preserveMetadata: false }), runtime)
    expect(rejected.success).toBe(false)
    expect(rejected.message).toContain("Enable PNG fallback")
  })

  test("normalizes lossless JPEG input before transcoding in always mode", async () => {
    const runtime = fakeRuntime()
    const result = await runXlchemy(normalizeXlchemyInput({ action: "convert", paths: ["/photos/events/b.jpg"], format: "Lossless JPEG Transcoding", jxlNormalize: true, jxlNormalizeWhen: "always", outputMode: "source", overwrite: true, preserveMetadata: false }), runtime)
    expect(result.success).toBe(true)
    expect(runtime.commands[0]).toEqual({ command: "/bin/jpegtran", args: ["-copy", "all", "-optimize", "-outfile", "/photos/events/b.jxl.xlchemy-normalized.jpg", "/photos/events/b.jpg"] })
    expect(runtime.commands[1]?.args.at(-2)).toBe("/photos/events/b.jxl.xlchemy-normalized.jpg")
  })

  test("normalizes and retries lossless JPEG only after an initial failure in on-fail mode", async () => {
    const runtime = fakeRuntime()
    const runCommand = runtime.runCommand
    let cjxlAttempts = 0
    runtime.runCommand = async (command, args) => {
      if (command.endsWith("cjxl") && cjxlAttempts++ === 0) { runtime.commands.push({ command, args }); return { exitCode: 1, stdout: "", stderr: "unsupported JPEG structure" } }
      return runCommand(command, args)
    }
    const result = await runXlchemy(normalizeXlchemyInput({ action: "convert", paths: ["/photos/events/b.jpg"], format: "Lossless JPEG Transcoding", jxlNormalize: true, jxlNormalizeWhen: "on-fail", outputMode: "source", overwrite: true, preserveMetadata: false }), runtime)
    expect(result.success).toBe(true)
    expect(runtime.commands.map((item) => item.command)).toEqual(["/bin/cjxl", "/bin/jpegtran", "/bin/cjxl"])
    expect(runtime.commands[2]?.args.at(-2)).toBe("/photos/events/b.jxl.xlchemy-normalized.jpg")
  })

  test("reconstructs and checksum-verifies lossless JPEG transcoding", async () => {
    const runtime = fakeRuntime()
    const result = await runXlchemy(normalizeXlchemyInput({ action: "convert", paths: ["/photos/events/b.jpg"], format: "Lossless JPEG Transcoding", jxlVerify: true, outputMode: "source", overwrite: true, preserveMetadata: false }), runtime)
    expect(result.success).toBe(true)
    expect(runtime.commands.at(-1)).toEqual({ command: "/bin/djxl", args: ["--num_threads", "4", "/photos/events/b.jxl", "/photos/events/b.jxl.verify.jpg"] })
  })

  test("uses encoder feedback for target file size downscaling", async () => {
    const runtime = fakeRuntime()
    const result = await runXlchemy(normalizeXlchemyInput({ action: "convert", paths: ["/photos/a.png"], format: "WebP", outputMode: "source", overwrite: true, preserveMetadata: false, downscale: { enabled: true, mode: "file-size", width: 1920, height: 1080, percent: 50, fileSizeKb: 0.1, shortestSide: 1080, longestSide: 1920, megapixels: 2.1, resample: "lanczos" } }), runtime)
    expect(result.success).toBe(true)
    expect(runtime.commands.filter((item) => item.command.endsWith("magick")).length).toBeGreaterThanOrEqual(3)
    expect(runtime.commands.some((item) => item.args.includes("66%"))).toBe(true)
    expect(runtime.commands.some((item) => item.args.includes("33%"))).toBe(true)
    expect(runtime.commands.some((item) => item.args.some((arg) => arg.startsWith("jpeg:extent=")))).toBe(false)
  })

  test("preserves spaces inside custom ExifTool argument values", async () => {
    const runtime = fakeRuntime()
    const result = await runXlchemy(normalizeXlchemyInput({ action: "convert", paths: ["/photos/a.png"], format: "WebP", outputMode: "source", overwrite: true, metadataMode: "exiftool-custom", exiftoolCustomArgs: '-overwrite_original -Artist="Custom metadata" "$dst"' }), runtime)
    expect(result.success).toBe(true)
    expect(runtime.commands.at(-1)?.args).toEqual(["-overwrite_original", "-Artist=Custom metadata", "/photos/a.webp"])
  })

  test("keeps a successful conversion when best-effort encoder metadata copy is unsupported", async () => {
    const runtime = fakeRuntime()
    const runCommand = runtime.runCommand
    runtime.runCommand = async (command, args) => command.endsWith("exiftool")
      ? (runtime.commands.push({ command, args }), { exitCode: 1, stdout: "", stderr: "target format is read-only" })
      : runCommand(command, args)
    const events: NodeRunEvent[] = []
    const result = await runXlchemy(normalizeXlchemyInput({ action: "convert", paths: ["/photos/a.png"], format: "JPEG XL", outputMode: "source", overwrite: true, metadataMode: "encoder-preserve" }), runtime, (event) => events.push(event))
    expect(result.success).toBe(true)
    expect(result.data?.files[0]).toMatchObject({ status: "converted" })
    expect(events).toContainEqual(expect.objectContaining({ type: "log", message: expect.stringContaining("Metadata copy skipped") }))
  })

  test("uses the recycle bin instead of permanent deletion when trash mode is selected", async () => {
    const runtime = fakeRuntime()
    const result = await runXlchemy(normalizeXlchemyInput({ action: "convert", paths: ["/photos/a.png"], format: "WebP", outputMode: "source", overwrite: true, preserveMetadata: false, deleteOriginal: true, deleteOriginalMode: "trash" }), runtime)
    expect(result.success).toBe(true)
    expect(runtime.commands.at(-1)).toEqual({ command: "trash", args: ["/photos/a.png"] })
  })

  test("defaults unified original deletion to the recycle bin for legacy inputs", async () => {
    const runtime = fakeRuntime()
    runtime.deleteFile = vi.fn(async () => undefined)
    const result = await runXlchemy({
      action: "convert", paths: ["/photos/a.png"], format: "WebP", outputMode: "source", overwrite: true,
      preserveMetadata: false, preserveStructure: true, recursive: true, deleteOriginal: true,
    }, runtime)
    expect(result.success).toBe(true)
    expect(runtime.deleteFile).toHaveBeenCalledWith("/photos/a.png", "trash")
  })

  test("encodes the lossless comparison pool and keeps only the smallest real output", async () => {
    const runtime = fakeRuntime()
    const result = await runXlchemy(normalizeXlchemyInput({ action: "convert", paths: ["/photos/a.png"], format: "Smallest Lossless", outputMode: "source", overwrite: true, preserveMetadata: false, smallestFormatPool: { png: true, webp: true, jxl: true } }), runtime)
    expect(result.success).toBe(true)
    expect(result.data?.files[0]).toMatchObject({ outputPath: "/photos/a.jxl", outputBytes: 200, status: "converted" })
    expect(runtime.commands.slice(0, 3).map((command) => command.command)).toEqual(["/bin/magick", "/bin/cwebp", "/bin/cjxl"])
  })

  test("materializes, converts and cleans up an inline clipboard image", async () => {
    const runtime = fakeRuntime()
    const cleanup = vi.fn(async () => undefined)
    const streamEfuPaths = vi.fn(async function* () { yield "/photos/events/b.jpg" })
    runtime.streamEfuPaths = streamEfuPaths
    runtime.createTemporaryFile = async (extension, base64) => {
      expect(extension).toBe(".png")
      expect(base64).toBe("cG5n")
      return "/photos/a.png"
    }
    runtime.readFileBase64 = async (path) => {
      expect(path).toBe("/exports/a.png")
      return "d2VicA=="
    }
    runtime.cleanupTemporaryFile = cleanup

    const result = await runXlchemy(normalizeXlchemyInput({ action: "convert", paths: [], format: "PNG", quality: 72, outputMode: "source", overwrite: false, preserveMetadata: false }), runtime)
    const clipboardResult = await runXlchemy({ ...normalizeXlchemyInput({ action: "convert", paths: ["/photos/events/b.jpg"], efuFiles: ["/lists/large.efu"], format: "PNG", quality: 72, outputMode: "directory", outputDir: "/exports", preserveMetadata: false }), inlineSource: { base64: "cG5n", mimeType: "image/png" } }, runtime)

    expect(result.success).toBe(false)
    expect(clipboardResult.success).toBe(true)
    expect(clipboardResult.data?.clipboardOutput).toEqual({ base64: "d2VicA==", mimeType: "image/png" })
    expect(clipboardResult.data?.inputCount).toBe(1)
    expect(streamEfuPaths).not.toHaveBeenCalled()
    expect(cleanup).toHaveBeenCalledWith("/photos/a.png")
  })
})

function fakeRuntime(): XlchemyRuntime & { commands: Array<{ command: string; args: string[] }> } {
  const files = new Map<string, { size: number; directory?: boolean }>([["/photos", { size: 0, directory: true }], ["/photos/events", { size: 0, directory: true }], ["/photos/a.png", { size: 1000 }], ["/photos/a.jxl", { size: 700 }], ["/photos/art.psd", { size: 3000 }], ["/photos/drawing.clip", { size: 4000 }], ["/photos/events/b.jpg", { size: 2000 }]])
  const runtime: XlchemyRuntime & { commands: Array<{ command: string; args: string[] }> } = {
    commands: [],
    pathInfo: async (path) => { const item = files.get(path); return { path, exists: Boolean(item), isFile: Boolean(item && !item.directory), isDirectory: Boolean(item?.directory), size: item?.size ?? 0, atimeMs: 10, mtimeMs: 20 } },
    listDir: async (path) => path === "/photos" ? [{ path: "/photos/a.png", name: "a.png", isFile: true, isDirectory: false }, { path: "/photos/events", name: "events", isFile: false, isDirectory: true }] : path === "/photos/events" ? [{ path: "/photos/events/b.jpg", name: "b.jpg", isFile: true, isDirectory: false }] : [],
    ensureDir: async () => undefined, copyFile: async () => undefined, removeFile: async (path) => { files.delete(path) }, trashFile: async (path) => { runtime.commands.push({ command: "trash", args: [path] }) }, renameFile: async (source, target) => { const item = files.get(source); if (item) { files.set(target, item); files.delete(source) } }, setTimes: async () => undefined, hashFile: async () => "matching-checksum",
    runCommand: async (command, args) => { runtime.commands.push({ command, args }); if (command.endsWith("jxlinfo")) return { exitCode: 0, stdout: "JPEG bitstream reconstruction data available", stderr: "" }; const output = args.includes("-outfile") ? args[args.indexOf("-outfile") + 1]! : args.includes("--output") ? args[args.indexOf("--output") + 1]! : args.includes("-o") ? args[args.indexOf("-o") + 1]! : args.at(-1)!; const size = command.endsWith("slimg") ? 350 : output.includes(".effort-9.jxl") ? 150 : output.includes(".smallest.jxl") ? 200 : output.includes(".smallest.webp") ? 300 : 400; files.set(output, { size }); return { exitCode: 0, stdout: "", stderr: "" } },
    resolveCommand: async (candidates) => `/bin/${candidates[0]}`,
    isAnimatedImage: async () => false,
    probeSlimg: async () => ({ id: "slimg-cffi", label: "slimg CFFI", purpose: "slimg DLL AVIF encoding", path: "/lib/slimg_cffi.dll", available: true, runnable: true }),
    convertWithSlimg: async (source, target, quality) => { runtime.commands.push({ command: "slimg-cffi", args: [source, target, String(quality)] }); files.set(target, { size: 350 }) },
    convertClipToPsd: async (source, target) => { runtime.commands.push({ command: "clip-to-psd-native", args: [source, target] }); files.set(target, { size: 1200 }) },
    join: (...parts) => parts.filter((part) => part && part !== ".").join("/").replace(/\/+/g, "/"), dirname: (path) => path.includes("/") ? path.replace(/\/[^/]+$/, "") || "/" : ".", basename: (path) => path.split("/").at(-1) ?? path, extname: (path) => /\.[^.]+$/.exec(path)?.[0] ?? "", relative: (from, to) => to.startsWith(`${from}/`) ? to.slice(from.length + 1) : to,
  }
  return runtime
}
