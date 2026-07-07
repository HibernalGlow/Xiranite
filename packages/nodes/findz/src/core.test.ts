import { describe, expect, test } from "vitest"
import type { FindzDirEntry, FindzFileData, FindzFileStat, FindzRuntime } from "./core.js"
import { compileSqlFilter, formatFoundPath, formatSize, parseSize, runFindz } from "./core.js"

describe("findz core", () => {
  test("parses size values and SQL-like filters", () => {
    expect(parseSize("1.5K")).toBe(1536)
    expect(formatSize(1536)).toBe("1.5K")

    const filter = compileSqlFilter('ext IN ("jpg", "png") AND size BETWEEN 1K AND 2M AND archive <> ""')
    expect(filter.test(file({ name: "001.jpg", path: "page/001.jpg", size: 2048, container: "book.zip", archive: "zip" }))).toBe(true)
    expect(filter.test(file({ name: "001.txt", path: "page/001.txt", size: 2048, container: "book.zip", archive: "zip" }))).toBe(false)
  })

  test("searches filesystem entries with injected runtime", async () => {
    const runtime = createMemoryRuntime({
      "/root": dir(),
      "/root/a.jpg": bytes(2048),
      "/root/b.txt": bytes(5),
      "/root/sub": dir(),
      "/root/sub/c.png": bytes(1024),
    })

    const result = await runFindz({
      action: "search",
      path: "/root",
      where: 'ext IN ("jpg", "png")',
      noArchive: true,
    }, runtime)

    expect(result.success).toBe(true)
    expect(result.data?.totalCount).toBe(2)
    expect(result.data?.files.map((item) => item.name).sort()).toEqual(["a.jpg", "c.png"])
  })

  test("searches ZIP central directory entries", async () => {
    const runtime = createMemoryRuntime({
      "/root": dir(),
      "/root/book.zip": zip([
        { path: "page/001.jpg", size: 1000 },
        { path: "notes.txt", size: 10 },
      ]),
    })

    const result = await runFindz({
      action: "search",
      path: "/root",
      where: 'archive = "zip" AND ext = "jpg"',
    }, runtime)

    expect(result.success).toBe(true)
    expect(result.data?.archiveCount).toBe(1)
    expect(result.data?.files.map((item) => formatFoundPath(item))).toEqual(["/root/book.zip//page/001.jpg"])
  })

  test("archives-only returns archive files themselves", async () => {
    const runtime = createMemoryRuntime({
      "/root": dir(),
      "/root/book.zip": zip([{ path: "page/001.jpg", size: 1000 }]),
      "/root/readme.txt": bytes(2),
    })

    const result = await runFindz({
      action: "archives_only",
      path: "/root",
      where: "1",
    }, runtime)

    expect(result.data?.files.map((item) => item.path)).toEqual(["/root/book.zip"])
  })

  test("finds archives containing nested archives", async () => {
    const runtime = createMemoryRuntime({
      "/root": dir(),
      "/root/book.zip": zip([
        { path: "inner.zip", size: 400 },
        { path: "page/001.jpg", size: 1000 },
      ]),
    })

    const result = await runFindz({
      action: "nested",
      path: "/root",
    }, runtime)

    expect(result.success).toBe(true)
    expect(result.data?.nestedCount).toBe(1)
    expect(result.data?.files[0]?.path).toBe("/root/book.zip")
  })

  test("groups and refines results", async () => {
    const runtime = createMemoryRuntime({
      "/root": dir(),
      "/root/a.jpg": bytes(100),
      "/root/b.jpg": bytes(200),
      "/root/c.txt": bytes(20),
    })

    const result = await runFindz({
      action: "search",
      path: "/root",
      where: "1",
      noArchive: true,
      groupBy: "ext",
      refine: "count >= 2",
    }, runtime)

    expect(result.data?.groups.map((group) => group.key)).toEqual(["jpg"])
  })

  test("filters filesystem images by dimensions", async () => {
    const runtime = createMemoryRuntime({
      "/root": dir(),
      "/root/cover.png": png(1200, 630),
      "/root/icon.png": png(256, 256),
    })

    const result = await runFindz({
      action: "search",
      path: "/root",
      where: "width = 1200 AND height = 630",
      withImageMeta: true,
      noArchive: true,
    }, runtime)

    expect(result.data?.files.map((item) => item.name)).toEqual(["cover.png"])
  })
})

function file(patch: Partial<FindzFileData>): FindzFileData {
  return {
    name: "file.txt",
    path: "/file.txt",
    size: 1,
    sizeFormatted: "1",
    modTime: "2024-01-01T00:00:00.000Z",
    date: "2024-01-01",
    time: "00:00:00",
    type: "file",
    container: "",
    archive: "",
    ext: (patch.name ?? "file.txt").split(".").pop() ?? "",
    ext2: (patch.name ?? "file.txt").split(".").pop() ?? "",
    ...patch,
  }
}

type MemoryNode = { type: "dir"; mtimeMs?: number } | { type: "file"; content: Uint8Array; mtimeMs?: number }

function createMemoryRuntime(nodes: Record<string, MemoryNode>): FindzRuntime {
  const runtime: FindzRuntime = {
    cwd: "/root",
    stat: async (path) => statOf(nodes[path]),
    readDir: async (path) => readDir(nodes, path),
    readFile: async (path) => {
      const node = nodes[path]
      if (!node || node.type !== "file") throw new Error(`Not a file: ${path}`)
      return node.content
    },
    writeText: async (path, content) => {
      nodes[path] = { type: "file", content: new TextEncoder().encode(content) }
    },
    dirname: (path) => path.replace(/\/[^/]*$/, "") || "/",
    basename: (path) => path.split("/").pop() ?? path,
    extname: (path) => {
      const name = path.split("/").pop() ?? path
      const index = name.lastIndexOf(".")
      return index >= 0 ? name.slice(index) : ""
    },
    join: (...parts) => parts.join("/").replace(/\/+/g, "/"),
    resolve: (path) => path,
  }
  return runtime
}

function statOf(node: MemoryNode | undefined): FindzFileStat | null {
  if (!node) return null
  return {
    exists: true,
    isDirectory: node.type === "dir",
    isFile: node.type === "file",
    size: node.type === "file" ? node.content.length : 0,
    mtimeMs: node.mtimeMs ?? Date.UTC(2024, 0, 1),
  }
}

function readDir(nodes: Record<string, MemoryNode>, path: string): FindzDirEntry[] {
  const prefix = path.endsWith("/") ? path : `${path}/`
  const children = new Set<string>()
  for (const key of Object.keys(nodes)) {
    if (!key.startsWith(prefix) || key === path) continue
    const rest = key.slice(prefix.length)
    if (!rest || rest.includes("/")) continue
    children.add(key)
  }
  return [...children].map((child) => {
    const node = nodes[child]!
    return {
      name: child.split("/").pop() ?? child,
      path: child,
      isDirectory: node.type === "dir",
      isFile: node.type === "file",
      stat: statOf(node) ?? undefined,
    }
  })
}

function dir(): MemoryNode {
  return { type: "dir" }
}

function bytes(size: number): MemoryNode {
  return { type: "file", content: new Uint8Array(size) }
}

function png(width: number, height: number): MemoryNode {
  const data = new Uint8Array(32)
  data.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const view = new DataView(data.buffer)
  view.setUint32(16, width, false)
  view.setUint32(20, height, false)
  return { type: "file", content: data }
}

function zip(entries: Array<{ path: string; size: number }>): MemoryNode {
  const encoder = new TextEncoder()
  const centralParts: Uint8Array[] = []
  let centralSize = 0
  for (const entry of entries) {
    const name = encoder.encode(entry.path)
    const header = new Uint8Array(46 + name.length)
    const view = new DataView(header.buffer)
    view.setUint32(0, 0x02014b50, true)
    view.setUint16(8, 0x800, true)
    view.setUint32(24, entry.size, true)
    view.setUint16(28, name.length, true)
    header.set(name, 46)
    centralParts.push(header)
    centralSize += header.length
  }
  const eocd = new Uint8Array(22)
  const eocdView = new DataView(eocd.buffer)
  eocdView.setUint32(0, 0x06054b50, true)
  eocdView.setUint16(8, entries.length, true)
  eocdView.setUint16(10, entries.length, true)
  eocdView.setUint32(12, centralSize, true)
  eocdView.setUint32(16, 0, true)
  const output = new Uint8Array(centralSize + eocd.length)
  let offset = 0
  for (const part of centralParts) {
    output.set(part, offset)
    offset += part.length
  }
  output.set(eocd, offset)
  return { type: "file", content: output }
}
