import { describe, expect, test } from "vitest"
import type { MvzCommandResult, MvzRuntime } from "./core.js"
import { groupByArchive, parseMvzEntries, parseMvzLine, runMvz } from "./core.js"

describe("mvz core", () => {
  test("parses compact and long findz lines", () => {
    expect(parseMvzLine("C:/packs/book.zip//page/001.jpg")).toEqual({
      archivePath: "C:/packs/book.zip",
      internalPath: "page/001.jpg",
      rawLine: "C:/packs/book.zip//page/001.jpg",
    })
    expect(parseMvzLine("2024-01-02 03:04:05 1.5K C:/packs/book.zip//page/002.jpg")?.internalPath).toBe("page/002.jpg")
    expect(parseMvzLine("not an archive entry")).toBeNull()
  })

  test("groups entries by archive", () => {
    const groups = groupByArchive(parseMvzEntries("a.zip//one.txt\na.zip//two.txt\nb.zip//one.txt"))
    expect(groups.size).toBe(2)
    expect(groups.get("a.zip")?.map((entry) => entry.internalPath)).toEqual(["one.txt", "two.txt"])
  })

  test("previews extract without requiring 7-Zip", async () => {
    const result = await runMvz({
      action: "extract",
      fileText: "C:/packs/book.zip//page/001.jpg\nC:/packs/book.zip//page/002.jpg",
      near: true,
      autoDir: true,
      dryRun: true,
    }, createMemoryRuntime())

    expect(result.success).toBe(true)
    expect(result.data?.totalArchives).toBe(1)
    expect(result.data?.preview[0]?.command).toContain("7z x C:/packs/book.zip")
    expect(result.data?.preview[0]?.output).toBe("C:/packs/book")
  })

  test("executes delete with injected runtime", async () => {
    const runtime = createMemoryRuntime({ "C:/packs/book.zip": true })
    const result = await runMvz({
      action: "delete",
      fileText: "C:/packs/book.zip//page/001.jpg",
    }, runtime)

    expect(result.success).toBe(true)
    expect(runtime.commands[0]).toEqual(["7z-real", "d", "C:/packs/book.zip", "page/001.jpg"])
  })

  test("previews move as extract then delete", async () => {
    const result = await runMvz({
      action: "move",
      fileText: "C:/packs/book.zip//page/001.jpg",
      output: "D:/out",
      near: false,
      autoDir: false,
      dryRun: true,
    }, createMemoryRuntime())

    expect(result.data?.preview.map((item) => item.action)).toEqual(["extract", "delete"])
    expect(result.data?.results[0]?.command).toContain("&&")
  })

  test("executes move without duplicating the 7-Zip command in args", async () => {
    const runtime = createMemoryRuntime({ "C:/packs/book.zip": true })
    const result = await runMvz({
      action: "move",
      fileText: "C:/packs/book.zip//page/001.jpg",
      output: "D:/out",
      near: false,
      autoDir: false,
    }, runtime)

    expect(result.success).toBe(true)
    expect(runtime.commands).toEqual([
      ["7z-real", "x", "C:/packs/book.zip", "-oD:/out", "-y", "page/001.jpg"],
      ["7z-real", "d", "C:/packs/book.zip", "page/001.jpg"],
    ])
  })

  test("previews regex rename pairs", async () => {
    const result = await runMvz({
      action: "rename",
      fileText: "C:/packs/book.zip//page/001.jpg",
      pattern: "^page/",
      replacement: "images/",
      dryRun: true,
    }, createMemoryRuntime())

    expect(result.success).toBe(true)
    expect(result.data?.preview[0]?.renames).toEqual([{ old: "page/001.jpg", next: "images/001.jpg" }])
  })
})

function createMemoryRuntime(existing: Record<string, boolean> = {}) {
  const runtime: MvzRuntime & { commands: string[][] } = {
    commands: [],
    find7z: async () => "7z-real",
    async runCommand(command: string, args: string[]): Promise<MvzCommandResult> {
      runtime.commands.push([command, ...args])
      return { code: 0, stdout: "", stderr: "", durationMs: 5 }
    },
    exists: async (path) => Boolean(existing[path]),
    ensureDir: async (path) => {
      existing[path] = true
    },
    dirname: (path) => path.replace(/[\\/][^\\/]*$/, "") || ".",
    basename: (path) => path.split(/[\\/]/).pop() ?? path,
    extname: (path) => {
      const name = path.split(/[\\/]/).pop() ?? path
      const index = name.lastIndexOf(".")
      return index >= 0 ? name.slice(index) : ""
    },
    join: (...parts) => parts.filter(Boolean).join("/").replace(/\/+/g, "/").replace("C:/", "C:/"),
  }
  return runtime
}
