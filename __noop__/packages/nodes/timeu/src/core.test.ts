import { describe, expect, test } from "vitest"
import type { TimeuRuntime, TimeuTimestampRecord } from "./core.js"
import { dumpTimestampRecords, mergeTimestampRecords, runTimeu } from "./core.js"

describe("timeu core", () => {
  test("backs up timestamps into a JSON record file", async () => {
    const writes: Record<string, string> = {}
    const runtime = fakeRuntime({ files: { "/root/a.txt": stamp(1000, 2000) }, writes })

    const result = await runTimeu({ action: "backup", paths: ["/root/a.txt"], recordPath: "/root/timeu.json", dryRun: false }, runtime)

    expect(result.success).toBe(true)
    expect(result.data?.backupCount).toBe(1)
    expect(JSON.parse(writes["/root/timeu.json"] ?? "[]")[0]).toMatchObject({ path: "/root/a.txt", atimeMs: 1000, mtimeMs: 2000 })
  })

  test("restores atime and mtime from stored records", async () => {
    const applied: Array<[string, number, number]> = []
    const record = [{ path: "/root/a.txt", atimeMs: 11, mtimeMs: 22, ctimeMs: 33, birthtimeMs: 44, backedUpAt: "2026-01-01T00:00:00.000Z" }]
    const runtime = fakeRuntime({
      files: { "/root/a.txt": stamp(1000, 2000) },
      reads: { "/root/timeu.json": dumpTimestampRecords(record) },
      onSetTimes: (...args) => applied.push(args),
    })

    const result = await runTimeu({ action: "restore", paths: ["/root/a.txt"], recordPath: "/root/timeu.json", dryRun: false }, runtime)

    expect(result.success).toBe(true)
    expect(result.data?.restoredCount).toBe(1)
    expect(applied).toEqual([["/root/a.txt", 11, 22]])
  })

  test("reports missing restore targets as skipped", async () => {
    const record = [{ path: "/root/missing.txt", atimeMs: 11, mtimeMs: 22, ctimeMs: 33, birthtimeMs: 44, backedUpAt: "2026-01-01T00:00:00.000Z" }]
    const runtime = fakeRuntime({ reads: { "/root/timeu.json": dumpTimestampRecords(record) } })

    const result = await runTimeu({ action: "restore", paths: ["/root/missing.txt"], recordPath: "/root/timeu.json" }, runtime)

    expect(result.success).toBe(true)
    expect(result.data?.skippedCount).toBe(1)
    expect(result.data?.plan[0]?.reason).toBe("path_missing")
  })

  test("merges records by path", () => {
    const existing = [{ path: "/root/a.txt", atimeMs: 1, mtimeMs: 2, ctimeMs: 3, birthtimeMs: 4, backedUpAt: "old" }]
    const current = [{ path: "/root/a.txt", atimeMs: 5, mtimeMs: 6, ctimeMs: 7, birthtimeMs: 8, backedUpAt: "new" }]

    expect(mergeTimestampRecords(existing, current, new Date("2026-01-01T00:00:00.000Z"))).toEqual([
      { path: "/root/a.txt", atimeMs: 5, mtimeMs: 6, ctimeMs: 7, birthtimeMs: 8, backedUpAt: "2026-01-01T00:00:00.000Z" },
    ])
  })
})

function fakeRuntime(options: {
  files?: Record<string, Omit<TimeuTimestampRecord, "path" | "backedUpAt">>
  directories?: Record<string, string[]>
  reads?: Record<string, string>
  writes?: Record<string, string>
  onSetTimes?: (path: string, atimeMs: number, mtimeMs: number) => void
}): TimeuRuntime {
  const files = options.files ?? {}
  const directories = options.directories ?? {}
  return {
    pathInfo: async (path) => {
      const file = files[path]
      return {
        path,
        exists: Boolean(file) || Boolean(directories[path]),
        isFile: Boolean(file),
        isDirectory: Boolean(directories[path]),
        atimeMs: file?.atimeMs ?? 0,
        mtimeMs: file?.mtimeMs ?? 0,
        ctimeMs: file?.ctimeMs ?? 0,
        birthtimeMs: file?.birthtimeMs ?? 0,
      }
    },
    listDir: async (path) => (directories[path] ?? []).map((child) => ({ name: basename(child), path: child, isFile: Boolean(files[child]), isDirectory: Boolean(directories[child]) })),
    readText: async (path) => options.reads?.[path] ?? null,
    writeText: async (path, content) => { if (options.writes) options.writes[path] = content },
    ensureDir: async () => undefined,
    setTimes: async (path, atimeMs, mtimeMs) => options.onSetTimes?.(path, atimeMs, mtimeMs),
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    join: (...parts) => parts.join("/").replace(/\/+/g, "/"),
    dirname: (path) => path.replace(/[/\\][^/\\]+$/, "") || ".",
    basename,
  }
}

function stamp(atimeMs: number, mtimeMs: number) {
  return { atimeMs, mtimeMs, ctimeMs: mtimeMs + 1, birthtimeMs: mtimeMs + 2 }
}

function basename(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}
