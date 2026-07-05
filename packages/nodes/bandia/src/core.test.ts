import { describe, expect, test } from "bun:test"
import type { BandiaRuntime, BandiaCommandResult, BandiaFileStat } from "./core.js"
import { parseBandiaPaths, parsePathMappings, runBandia } from "./core.js"

describe("bandia core", () => {
  test("parses archive paths and mappings", () => {
    expect(parseBandiaPaths('"C:/a/foo.zip"\nnot archive\nD:/bar.7z')).toEqual(["C:/a/foo.zip", "D:/bar.7z"])
    expect(parsePathMappings('C:/a/foo.zip=>C:/a/foo\n{"mappings":[{"archive_path":"D:/b.7z","extracted_path":"D:/b"}]}').length).toBe(1)
    expect(parsePathMappings('{"mappings":[{"archive_path":"D:/b.7z","extracted_path":"D:/b"}]}')).toEqual([{ archivePath: "D:/b.7z", extractedPath: "D:/b" }])
  })

  test("plans normal extract without executing Bandizip", async () => {
    const runtime = createMemoryRuntime({
      "C:/in/book.zip": fileStat(100),
    })
    const result = await runBandia({
      action: "extract",
      paths: ["C:/in/book.zip"],
      extractMode: "normal",
      outputPrefix: "[x] ",
      dryRun: true,
    }, runtime)

    expect(result.success).toBe(true)
    expect(result.data?.extractedCount).toBe(1)
    expect(result.data?.pathMappings[0]).toEqual({ archivePath: "C:/in/book.zip", extractedPath: "C:/in/[x] book" })
    expect(result.data?.results[0]?.command).toContain("-o:C:/in/[x] book")
  })

  test("uses archive listing for auto extract output", async () => {
    const runtime = createMemoryRuntime({
      "C:/in/book.zip": fileStat(100),
    }, {
      "bz l C:/in/book.zip": { code: 0, stdout: "2024 00 0 0 book/page.jpg", stderr: "" },
    })
    const result = await runBandia({
      action: "extract",
      paths: ["C:/in/book.zip"],
      dryRun: true,
    }, runtime)

    expect(result.data?.pathMappings[0]?.extractedPath).toBe("C:/in/book")
  })

  test("compresses mappings through injected runtime", async () => {
    const runtime = createMemoryRuntime({
      "C:/work/book": directoryStat(),
    })
    const result = await runBandia({
      action: "compress",
      mappings: [{ archivePath: "C:/out/book.zip", extractedPath: "C:/work/book" }],
      deleteSource: false,
    }, runtime)

    expect(result.success).toBe(true)
    expect(result.data?.compressedCount).toBe(1)
    expect(runtime.commands[0]).toEqual(["bz", "a", "-y", "book.zip", "book", "cwd=C:/work"])
  })

  test("exports EFU rows", async () => {
    const runtime = createMemoryRuntime({
      "C:/work/book": directoryStat(),
      "C:/work/book/page.jpg": fileStat(42),
    })
    const result = await runBandia({
      action: "export_efu",
      paths: ["C:/work/book/page.jpg"],
      efuOutputPath: "C:/tmp/out.efu",
    }, runtime)

    expect(result.success).toBe(true)
    expect(runtime.writes["C:/tmp/out.efu"]).toContain("Filename")
    expect(runtime.writes["C:/tmp/out.efu"]).toContain("page.jpg")
  })
})

function createMemoryRuntime(files: Record<string, BandiaFileStat>, commandResults: Record<string, BandiaCommandResult> = {}) {
  const runtime: BandiaRuntime & { commands: string[][]; writes: Record<string, string> } = {
    commands: [],
    writes: {},
    findBandizip: async () => "bz",
    async runCommand(command, args, options) {
      runtime.commands.push([command, ...args, ...(options?.cwd ? [`cwd=${options.cwd}`] : [])])
      return commandResults[[command, ...args].join(" ")] ?? { code: 0, stdout: "", stderr: "", durationMs: 5 }
    },
    exists: async (path) => Boolean(files[path]),
    stat: async (path) => files[path] ?? null,
    ensureDir: async (path) => {
      files[path] = directoryStat()
    },
    removePath: async (path) => {
      delete files[path]
    },
    writeText: async (path, content) => {
      runtime.writes[path] = content
    },
    tempDir: () => "C:/tmp",
    dirname: (path) => path.replace(/[\\/][^\\/]*$/, "") || ".",
    basename: (path) => path.split(/[\\/]/).pop() ?? path,
    extname: (path) => {
      const name = path.split(/[\\/]/).pop() ?? path
      const index = name.lastIndexOf(".")
      return index >= 0 ? name.slice(index) : ""
    },
    join: (...parts) => parts.filter(Boolean).join("/").replace(/\/+/g, "/").replace("C:/", "C:/"),
    resolve: (path) => path,
  }
  return runtime
}

function fileStat(size: number): BandiaFileStat {
  return { exists: true, isDirectory: false, size, mtimeMs: 1_700_000_000_000, ctimeMs: 1_700_000_000_000 }
}

function directoryStat(): BandiaFileStat {
  return { exists: true, isDirectory: true, size: 0, mtimeMs: 1_700_000_000_000, ctimeMs: 1_700_000_000_000 }
}
