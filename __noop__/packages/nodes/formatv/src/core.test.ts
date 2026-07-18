import { expect, test } from "vitest"
import type { FormatvDirEntry, FormatvPathInfo, FormatvRuntime } from "./core.js"
import { DEFAULT_PREFIXES, isNovVideoFile, isVideoFile, runFormatv, scanFormatv } from "./core.js"

test("detects video and .nov video files", () => {
  expect(isVideoFile("a.mp4")).toBe(true)
  expect(isVideoFile("a.txt")).toBe(false)
  expect(isNovVideoFile("a.mp4.nov")).toBe(true)
  expect(isNovVideoFile("a.txt.nov")).toBe(false)
})

test("scans normal, .nov, and prefixed files", async () => {
  const runtime = createMemoryRuntime({
    "/v/a.mp4": { size: 10 },
    "/v/b.mkv.nov": { size: 11 },
    "/v/[#hb]c.mp4": { size: 12 },
    "/v/readme.txt": { size: 1 },
  })
  const scan = await scanFormatv(["/v"], false, DEFAULT_PREFIXES, runtime)
  expect(scan.normalFiles).toEqual(["/v/a.mp4"])
  expect(scan.novFiles).toEqual(["/v/b.mkv.nov"])
  expect(scan.prefixedFiles.hb).toEqual(["/v/[#hb]c.mp4"])
})

test("adds and removes .nov suffixes", async () => {
  const runtime = createMemoryRuntime({ "/v/a.mp4": { size: 10 } })
  const add = await runFormatv({ action: "add_nov", path: "/v" }, runtime)
  expect(add.data?.successCount).toBe(1)
  expect(runtime.files.has("/v/a.mp4.nov")).toBe(true)
  const remove = await runFormatv({ action: "remove_nov", path: "/v" }, runtime)
  expect(remove.data?.successCount).toBe(1)
  expect(runtime.files.has("/v/a.mp4")).toBe(true)
})

test("checks duplicates for prefixed files", async () => {
  const runtime = createMemoryRuntime({
    "/v/a.mp4": { size: 10 },
    "/v/[#hb]a.mp4": { size: 20 },
  })
  const result = await runFormatv({ action: "check_duplicates", path: "/v", prefixName: "hb" }, runtime)
  expect(result.data?.duplicateCount).toBe(1)
  expect(result.data?.duplicates).toEqual(["/v/a.mp4"])
  expect(result.data?.prefixedLarger[0].prefixedSize).toBe(20)
  expect(runtime.files.has("/v/formatv-hb-duplicates.json")).toBe(true)
})

function createMemoryRuntime(seed: Record<string, { size: number }>): FormatvRuntime & { files: Map<string, { size: number; content?: string }> } {
  const files = new Map<string, { size: number; content?: string }>(Object.entries(seed))
  const dirs = new Set<string>(["/"])
  for (const path of files.keys()) dirs.add(dirname(path))

  return {
    files,
    async pathInfo(path: string): Promise<FormatvPathInfo> {
      const file = files.get(path)
      return { path, exists: Boolean(file) || dirs.has(path), isFile: Boolean(file), isDirectory: dirs.has(path), size: file?.size ?? 0 }
    },
    async listDir(path: string): Promise<FormatvDirEntry[]> {
      const prefix = path.endsWith("/") ? path : `${path}/`
      const names = new Set<string>()
      for (const file of files.keys()) if (file.startsWith(prefix)) names.add(file.slice(prefix.length).split("/")[0])
      return [...names].map((name) => {
        const child = join(path, name)
        return { name, path: child, isFile: files.has(child), isDirectory: dirs.has(child) }
      })
    },
    async renamePath(source: string, target: string): Promise<void> {
      const file = files.get(source)
      if (!file) throw new Error("missing")
      files.delete(source)
      files.set(target, file)
      dirs.add(dirname(target))
    },
    async writeText(path: string, content: string): Promise<void> {
      files.set(path, { size: content.length, content })
      dirs.add(dirname(path))
    },
    join,
    dirname,
    basename,
  }
}

function join(...parts: string[]): string {
  return parts.join("/").replace(/\/+/g, "/")
}

function dirname(path: string): string {
  const index = path.lastIndexOf("/")
  return index <= 0 ? "/" : path.slice(0, index)
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1)
}
