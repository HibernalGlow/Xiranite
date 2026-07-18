import { describe, expect, test, vi } from "vitest"
import { compressionRatio, discoverImages, normalizeXlchemyInput, runXlchemy, type XlchemyRuntime } from "./core.js"

describe("xlchemy core contract", () => {
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
      { command: "/bin/magick", args: ["/photos/drawing[CLIP].png.xlchemy-layered.png", "-define", "png:compression-level=7", "/photos/drawing[CLIP].png"] },
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

  test("emits incremental result snapshots while converting", async () => {
    const events: Array<{ data?: unknown }> = []
    const result = await runXlchemy({
      action: "convert", paths: ["/photos/a.png"], format: "WebP", lossless: false, quality: 80, effort: 6, threads: 2,
      outputMode: "source", preserveMetadata: false, preserveStructure: true, overwrite: true, recursive: true,
    }, fakeRuntime(), (event) => events.push(event))
    expect(result.success).toBe(true)
    expect(events.find((event) => (event.data as { kind?: string } | undefined)?.kind === "xlchemy-live-result")?.data).toMatchObject({
      result: { convertedCount: 1, files: [{ sourcePath: "/photos/a.png", status: "converted" }] },
    })
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
    expect(result.data?.environment?.find((tool) => tool.id === "slimg-cffi")).toMatchObject({ available: true, runnable: true })
    expect(result.data?.environment?.some((tool) => "versionArgs" in tool)).toBe(false)
  })

  test("uses the slimg DLL runtime instead of passing slimg to avifenc", async () => {
    const runtime = fakeRuntime()
    const result = await runXlchemy(normalizeXlchemyInput({ action: "convert", paths: ["/photos/a.png"], format: "AVIF", avifEncoder: "slimg", outputMode: "source", overwrite: true, preserveMetadata: false }), runtime)
    expect(result.success).toBe(true)
    expect(runtime.commands).toEqual([{ command: "slimg-cffi", args: ["/photos/a.png", "/photos/a.avif", "60"] }])
    expect(result.data?.files[0]).toMatchObject({ status: "converted", outputBytes: 350 })
  })

  test("uses FFmpeg SVT-AV1 for SVT AVIF encoding", async () => {
    const runtime = fakeRuntime()
    const result = await runXlchemy(normalizeXlchemyInput({ action: "convert", paths: ["/photos/a.png"], format: "AVIF", avifEncoder: "svt", quality: 60, effort: 7, threads: 4, outputMode: "source", overwrite: true, preserveMetadata: false }), runtime)
    expect(result.success).toBe(true)
    expect(runtime.commands.at(-1)).toEqual({ command: "/bin/ffmpeg", args: ["-hide_banner", "-loglevel", "error", "-y", "-i", "/photos/a.png", "-frames:v", "1", "-c:v", "libsvtav1", "-preset", "4", "-crf", "25", "-threads", "4", "-pix_fmt", "yuv420p", "-f", "avif", "/photos/a.avif"] })
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
    runtime.createTemporaryFile = async (extension, base64) => {
      expect(extension).toBe(".png")
      expect(base64).toBe("cG5n")
      return "/photos/a.png"
    }
    runtime.readFileBase64 = async (path) => {
      expect(path).toBe("/photos/output/a.png")
      return "d2VicA=="
    }
    runtime.cleanupTemporaryFile = cleanup

    const result = await runXlchemy(normalizeXlchemyInput({ action: "convert", paths: [], format: "PNG", quality: 72, outputMode: "source", overwrite: false, preserveMetadata: false }), runtime)
    const clipboardResult = await runXlchemy({ ...normalizeXlchemyInput({ action: "convert", paths: [], format: "PNG", quality: 72, outputMode: "source", preserveMetadata: false }), inlineSource: { base64: "cG5n", mimeType: "image/png" } }, runtime)

    expect(result.success).toBe(false)
    expect(clipboardResult.success).toBe(true)
    expect(clipboardResult.data?.clipboardOutput).toEqual({ base64: "d2VicA==", mimeType: "image/png" })
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
    runCommand: async (command, args) => { runtime.commands.push({ command, args }); if (command.endsWith("jxlinfo")) return { exitCode: 0, stdout: "JPEG bitstream reconstruction data available", stderr: "" }; const output = args.includes("-outfile") ? args[args.indexOf("-outfile") + 1]! : args.includes("-o") ? args[args.indexOf("-o") + 1]! : args.at(-1)!; const size = output.includes(".effort-9.jxl") ? 150 : output.includes(".smallest.jxl") ? 200 : output.includes(".smallest.webp") ? 300 : 400; files.set(output, { size }); return { exitCode: 0, stdout: "", stderr: "" } },
    resolveCommand: async (candidates) => `/bin/${candidates[0]}`,
    probeSlimg: async () => ({ id: "slimg-cffi", label: "slimg CFFI", purpose: "slimg DLL AVIF 编码", path: "/lib/slimg_cffi.dll", available: true, runnable: true }),
    convertWithSlimg: async (source, target, quality) => { runtime.commands.push({ command: "slimg-cffi", args: [source, target, String(quality)] }); files.set(target, { size: 350 }) },
    convertClipToPsd: async (source, target) => { runtime.commands.push({ command: "clip-to-psd-native", args: [source, target] }); files.set(target, { size: 1200 }) },
    join: (...parts) => parts.filter((part) => part && part !== ".").join("/").replace(/\/+/g, "/"), dirname: (path) => path.includes("/") ? path.replace(/\/[^/]+$/, "") || "/" : ".", basename: (path) => path.split("/").at(-1) ?? path, extname: (path) => /\.[^.]+$/.exec(path)?.[0] ?? "", relative: (from, to) => to.startsWith(`${from}/`) ? to.slice(from.length + 1) : to,
  }
  return runtime
}
