import { describe, expect, test } from "bun:test"
import type { RepackuCompressionResult, RepackuDirEntry, RepackuPathInfo, RepackuRuntime } from "./core.js"
import { analyzeFolderStructure, parseRepackuConfig, runRepacku } from "./core.js"

describe("repacku core", () => {
  test("analyzes folder compression modes", async () => {
    const runtime = createMemoryRuntime()
    runtime.file("/root/book/001.jpg", 100)
    runtime.file("/root/book/002.png", 100)
    runtime.file("/root/mixed/001.jpg", 100)
    runtime.file("/root/mixed/info.txt", 10)
    runtime.file("/root/archive/source.zip", 100)
    runtime.file("/root/archive/001.jpg", 100)
    runtime.file("/root/archive/002.jpg", 100)
    runtime.file("/root/tiny/one.jpg", 100)

    const tree = await analyzeFolderStructure("/root", runtime, { targetFileTypes: ["image"] })
    expect(tree?.compressMode).toBe("skip")
    const modes = Object.fromEntries((tree?.children ?? []).map((child) => [child.name, child.compressMode]))
    expect(modes.book).toBe("entire")
    expect(modes.mixed).toBe("skip")
    expect(modes.archive).toBe("selective")
    expect(modes.tiny).toBe("skip")
  })

  test("writes config and plans full dry run", async () => {
    const runtime = createMemoryRuntime()
    runtime.file("/root/book/001.jpg", 100)
    runtime.file("/root/book/002.png", 100)
    runtime.file("/root/archive/source.zip", 100)
    runtime.file("/root/archive/001.jpg", 100)
    runtime.file("/root/archive/002.jpg", 100)

    const result = await runRepacku({ action: "full", path: "/root", types: "image", dryRun: true }, runtime)
    expect(result.success).toBe(true)
    expect(result.data?.configPath).toBe("/root/root_config.json")
    expect(parseRepackuConfig(runtime.writes["/root/root_config.json"] ?? "").folderTree.name).toBe("root")
    expect(result.data?.plannedCount).toBe(2)
    expect(result.data?.operations.map((item) => item.mode).sort()).toEqual(["entire", "selective"])
  })

  test("compresses from config through injected runtime", async () => {
    const runtime = createMemoryRuntime()
    runtime.file("/root/book/001.jpg", 100)
    runtime.file("/root/book/002.png", 100)
    await runRepacku({ action: "analyze", path: "/root", types: "image" }, runtime)

    const result = await runRepacku({ action: "compress", configPath: "/root/root_config.json" }, runtime)
    expect(result.success).toBe(true)
    expect(result.data?.compressedCount).toBe(1)
    expect(runtime.compressCalls[0]).toEqual(["whole", "/root/book", "/root/book.zip"])
  })

  test("single-pack skips folders that already contain archives and packs loose images", async () => {
    const runtime = createMemoryRuntime()
    runtime.file("/pack/clean/001.jpg", 100)
    runtime.file("/pack/clean/002.jpg", 100)
    runtime.file("/pack/has-archive/source.zip", 100)
    runtime.file("/pack/a.jpg", 100)
    runtime.file("/pack/b.png", 100)

    const result = await runRepacku({ action: "single-pack", path: "/pack" }, runtime)
    expect(result.success).toBe(true)
    expect(result.data?.compressedCount).toBe(2)
    expect(result.data?.skippedCount).toBe(1)
    expect(runtime.compressCalls).toContainEqual(["whole", "/pack/clean", "/pack/clean.zip"])
    expect(runtime.compressCalls).toContainEqual(["files", "/pack", "/pack/pack.zip", ".avif,.bmp,.gif,.ico,.jpeg,.jpg,.jxl,.png,.psd,.raw,.sha1,.svg,.tiff,.webp"])
  })

  test("gallery-pack finds marked folders", async () => {
    const runtime = createMemoryRuntime()
    runtime.file("/g/alpha. \u753b\u96c6/a.jpg", 100)
    runtime.file("/g/alpha. \u753b\u96c6/b.jpg", 100)

    const result = await runRepacku({ action: "gallery-pack", path: "/g" }, runtime)
    expect(result.success).toBe(true)
    expect(result.data?.galleryCount).toBe(1)
    expect(result.data?.compressedCount).toBe(1)
  })
})

type MemoryItem = { type: "dir" | "file"; size: number }

function createMemoryRuntime() {
  const items: Record<string, MemoryItem> = { "/": { type: "dir", size: 0 } }
  const runtime: RepackuRuntime & {
    writes: Record<string, string>
    compressCalls: string[][]
    file: (path: string, size?: number) => void
  } = {
    writes: {},
    compressCalls: [],
    file(path: string, size = 1) {
      ensureDir(dirname(path))
      items[normalize(path)] = { type: "file", size }
    },
    async pathInfo(path): Promise<RepackuPathInfo> {
      const item = items[normalize(path)]
      return {
        path: normalize(path),
        exists: Boolean(item),
        isFile: item?.type === "file",
        isDirectory: item?.type === "dir",
        size: item?.size ?? 0,
      }
    },
    async listDir(path): Promise<RepackuDirEntry[]> {
      const root = normalize(path)
      return Object.entries(items)
        .filter(([itemPath]) => itemPath !== root && dirname(itemPath) === root)
        .map(([itemPath, item]) => ({
          name: basename(itemPath),
          path: itemPath,
          isFile: item.type === "file",
          isDirectory: item.type === "dir",
          size: item.size,
        }))
        .sort((a, b) => a.name.localeCompare(b.name))
    },
    async readText(path) {
      const text = runtime.writes[normalize(path)]
      if (text === undefined) throw new Error(`missing text: ${path}`)
      return text
    },
    async writeText(path, content) {
      runtime.writes[normalize(path)] = content
      runtime.file(path, content.length)
    },
    async ensureDir(path) {
      ensureDir(path)
    },
    async compressWholeFolder(sourcePath, targetPath): Promise<RepackuCompressionResult> {
      runtime.compressCalls.push(["whole", normalize(sourcePath), normalize(targetPath)])
      runtime.file(targetPath, 50)
      return { success: true, originalSize: 100, compressedSize: 50 }
    },
    async compressFiles(sourcePath, targetPath, extensions): Promise<RepackuCompressionResult> {
      runtime.compressCalls.push(["files", normalize(sourcePath), normalize(targetPath), [...extensions].sort().join(",")])
      runtime.file(targetPath, 40)
      return { success: true, originalSize: 100, compressedSize: 40 }
    },
    join: (...parts) => normalize(parts.filter(Boolean).join("/")),
    dirname,
    basename,
    extname,
    resolve: normalize,
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  }

  function ensureDir(path: string) {
    const normalized = normalize(path)
    if (items[normalized]) return
    ensureDir(dirname(normalized))
    items[normalized] = { type: "dir", size: 0 }
  }

  return runtime
}

function normalize(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "")
  return normalized || "/"
}

function dirname(path: string): string {
  const normalized = normalize(path)
  if (normalized === "/") return "/"
  const index = normalized.lastIndexOf("/")
  return index <= 0 ? "/" : normalized.slice(0, index)
}

function basename(path: string): string {
  const normalized = normalize(path)
  if (normalized === "/") return ""
  return normalized.slice(normalized.lastIndexOf("/") + 1)
}

function extname(path: string): string {
  const name = basename(path)
  const index = name.lastIndexOf(".")
  return index > 0 ? name.slice(index) : ""
}
