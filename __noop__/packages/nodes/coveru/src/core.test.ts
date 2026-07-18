import { describe, expect, test } from "vitest"
import type { CoveruRuntime } from "./core.js"
import { runCoveru, selectCoverEntry } from "./core.js"

describe("coveru core", () => {
  test("plans the preferred cover entry from a zip archive", async () => {
    const runtime = fakeRuntime({
      files: new Set(["/in/book.zip"]),
      archiveEntries: {
        "/in/book.zip": [
          { name: "002.jpg", path: "pages/002.jpg", size: 20, compressedSize: 10, method: 8 },
          { name: "cover.webp", path: "cover.webp", size: 20, compressedSize: 10, method: 8 },
        ],
      },
    })

    const result = await runCoveru({ action: "plan", paths: ["/in/book.zip"], dryRun: true }, runtime)

    expect(result.success).toBe(true)
    expect(result.data?.candidates[0]).toMatchObject({
      sourceEntry: "cover.webp",
      outputPath: "/in/book.webp",
      status: "ready",
    })
  })

  test("extracts ready candidates with the injected runtime", async () => {
    const extracted: Array<[string, string, string]> = []
    const runtime = fakeRuntime({
      files: new Set(["/in/book.zip"]),
      archiveEntries: {
        "/in/book.zip": [{ name: "cover.jpg", path: "cover.jpg", size: 20, compressedSize: 10, method: 8 }],
      },
      onExtract: (...args) => extracted.push(args),
    })

    const result = await runCoveru({ action: "extract", paths: ["/in/book.zip"], dryRun: false, outputDir: "/out", outputMode: "directory" }, runtime)

    expect(result.success).toBe(true)
    expect(result.data?.extractedCount).toBe(1)
    expect(extracted).toEqual([["/in/book.zip", "cover.jpg", "/out/book.jpg"]])
  })

  test("reports unsupported archives without falling back to external tools", async () => {
    const runtime = fakeRuntime({ files: new Set(["/in/book.rar"]) })

    const result = await runCoveru({ action: "plan", paths: ["/in/book.rar"] }, runtime)

    expect(result.success).toBe(true)
    expect(result.data?.unsupportedCount).toBe(1)
    expect(result.data?.candidates[0]?.reason).toBe("unsupported_archive")
  })

  test("selects cover-like names ahead of numeric pages", () => {
    const runtime = pathOnlyRuntime()
    const selected = selectCoverEntry([
      { name: "001.jpg", path: "001.jpg", size: 1, compressedSize: 1, method: 0 },
      { name: "front.png", path: "art/front.png", size: 1, compressedSize: 1, method: 0 },
    ], ["front", "cover"], runtime)

    expect(selected.path).toBe("art/front.png")
  })
})

function fakeRuntime(options: {
  files: Set<string>
  directories?: Record<string, string[]>
  archiveEntries?: Record<string, Awaited<ReturnType<CoveruRuntime["listArchiveEntries"]>>>
  onExtract?: (archivePath: string, entryPath: string, outputPath: string) => void
}): CoveruRuntime {
  const pathRuntime = pathOnlyRuntime()
  return {
    ...pathRuntime,
    pathInfo: async (path) => ({
      path,
      exists: options.files.has(path) || Boolean(options.directories?.[path]),
      isFile: options.files.has(path),
      isDirectory: Boolean(options.directories?.[path]),
    }),
    listDir: async (path) => (options.directories?.[path] ?? []).map((child) => ({
      name: pathRuntime.basename(child),
      path: child,
      isFile: options.files.has(child),
      isDirectory: Boolean(options.directories?.[child]),
    })),
    listArchiveEntries: async (path) => options.archiveEntries?.[path] ?? [],
    copyFile: async () => undefined,
    extractArchiveEntry: async (archivePath, entryPath, outputPath) => options.onExtract?.(archivePath, entryPath, outputPath),
    ensureDir: async () => undefined,
  }
}

function pathOnlyRuntime(): Pick<CoveruRuntime, "join" | "dirname" | "basename" | "extname"> {
  return {
    join: (...parts) => parts.join("/").replace(/\/+/g, "/"),
    dirname: (path) => path.replace(/[/\\][^/\\]+$/, "") || ".",
    basename: (path) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path,
    extname: (path) => /(\.[^./\\]+)$/.exec(path)?.[1] ?? "",
  }
}
