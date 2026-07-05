import { describe, expect, test } from "bun:test"
import type { EngineVDirEntry, EngineVPathInfo, EngineVRuntime } from "./core.js"
import { filterWallpapers, generateNewName, runEngineV, scanWorkshop, validateTemplate } from "./core.js"

describe("enginev core", () => {
  test("scans Wallpaper Engine project folders", async () => {
    const runtime = createMemoryRuntime()
    runtime.json("/work/111/project.json", project("Ocean Loop", "Video", "Everyone"))
    runtime.file("/work/111/scene.mp4", 100)
    runtime.json("/work/222/project.json", project("Dark Room", "Scene", "Mature"))
    runtime.file("/work/222/scene.pkg", 50)
    runtime.file("/work/readme.txt", 10)

    const wallpapers = await scanWorkshop("/work", runtime)
    expect(wallpapers.map((item) => item.workshopId)).toEqual(["222", "111"])
    expect(wallpapers.find((item) => item.workshopId === "111")?.size).toBeGreaterThan(100)
  })

  test("filters and stats through runEngineV", async () => {
    const runtime = createMemoryRuntime()
    runtime.json("/work/111/project.json", project("Ocean Loop", "Video", "Everyone"))
    runtime.json("/work/222/project.json", project("Dark Room", "Scene", "Mature"))

    const result = await runEngineV({ action: "filter", path: "/work", filters: { contentRating: "Mature" } }, runtime)
    expect(result.success).toBe(true)
    expect(result.data?.filteredWallpapers.map((item) => item.workshopId)).toEqual(["222"])
    expect(result.data?.typeStats).toEqual({ Scene: 1, Video: 1 })
    expect(result.data?.ratingStats).toEqual({ Everyone: 1, Mature: 1 })
  })

  test("generates safe names and validates templates", async () => {
    const runtime = createMemoryRuntime()
    runtime.json("/work/111/project.json", { ...project("Ocean/Loop", "Video", "Everyone"), description: "abcdefghi" })
    const [wallpaper] = await scanWorkshop("/work", runtime)

    expect(generateNewName(wallpaper!, "{title}_{desc}_{id}", { descMaxLength: 4 })).toBe("Ocean_Loop_abcd..._111")
    expect(validateTemplate("{title}_{id}")).toEqual([])
    expect(validateTemplate("{missing}")).toContain("Unknown placeholder: {missing}")
  })

  test("plans and executes rename through injected runtime", async () => {
    const runtime = createMemoryRuntime()
    runtime.json("/work/111/project.json", project("Ocean Loop", "Video", "Everyone"))

    const dry = await runEngineV({ action: "rename", path: "/work", ids: "111", template: "{title}_{id}" }, runtime)
    expect(dry.data?.renameResults[0]?.status).toBe("planned")
    expect(dry.data?.totalCount).toBe(1)
    expect(dry.data?.typeStats).toEqual({ Video: 1 })
    expect(runtime.moves.length).toBe(0)

    const executed = await runEngineV({ action: "rename", path: "/work", ids: "111", template: "{title}_{id}", dryRun: false }, runtime)
    expect(executed.success).toBe(true)
    expect(executed.data?.renameResults[0]?.status).toBe("renamed")
    expect(runtime.moves[0]).toEqual(["/work/111", "/work/Ocean Loop_111"])
  })

  test("delete dry-run and export work with provided wallpapers", async () => {
    const runtime = createMemoryRuntime()
    runtime.json("/work/111/project.json", project("Ocean Loop", "Video", "Everyone"))
    const scan = await runEngineV({ action: "scan", path: "/work" }, runtime)
    const wallpapers = scan.data?.wallpapers ?? []

    const deletion = await runEngineV({ action: "delete", wallpapers, ids: "111" }, runtime)
    expect(deletion.data?.deleteResults[0]?.status).toBe("planned")
    expect(runtime.removes.length).toBe(0)

    const exported = await runEngineV({ action: "export", wallpapers, exportPath: "/out/wallpapers.txt", exportFormat: "paths" }, runtime)
    expect(exported.success).toBe(true)
    expect(runtime.writes["/out/wallpapers.txt"]).toContain("/work/111")
  })
})

type MemoryItem = { type: "dir" | "file"; size: number; text?: string; createdMs: number; modifiedMs: number }

function createMemoryRuntime() {
  const items: Record<string, MemoryItem> = { "/": dirItem() }
  const runtime: EngineVRuntime & {
    writes: Record<string, string>
    moves: string[][]
    removes: string[][]
    file: (path: string, size?: number) => void
    json: (path: string, data: unknown) => void
  } = {
    writes: {},
    moves: [],
    removes: [],
    file(path: string, size = 1) {
      ensureDir(dirname(path))
      items[normalize(path)] = { type: "file", size, createdMs: 1_700_000_000_000, modifiedMs: 1_700_000_000_000 }
    },
    json(path: string, data: unknown) {
      const text = JSON.stringify(data)
      ensureDir(dirname(path))
      items[normalize(path)] = { type: "file", size: text.length, text, createdMs: 1_700_000_000_000, modifiedMs: 1_700_000_000_000 }
    },
    async pathInfo(path): Promise<EngineVPathInfo> {
      const item = items[normalize(path)]
      return {
        path: normalize(path),
        exists: Boolean(item),
        isFile: item?.type === "file",
        isDirectory: item?.type === "dir",
        size: item?.size ?? 0,
        createdMs: item?.createdMs ?? 0,
        modifiedMs: item?.modifiedMs ?? 0,
      }
    },
    async listDir(path): Promise<EngineVDirEntry[]> {
      const root = normalize(path)
      return Object.entries(items)
        .filter(([itemPath]) => itemPath !== root && dirname(itemPath) === root)
        .map(([itemPath, item]) => ({ name: basename(itemPath), path: itemPath, isFile: item.type === "file", isDirectory: item.type === "dir", size: item.size }))
        .sort((a, b) => a.name.localeCompare(b.name))
    },
    async readJson(path) {
      const item = items[normalize(path)]
      if (!item?.text) throw new Error(`missing json: ${path}`)
      return JSON.parse(item.text) as unknown
    },
    async writeText(path, content) {
      runtime.writes[normalize(path)] = content
      runtime.file(path, content.length)
    },
    async ensureDir(path) {
      ensureDir(path)
    },
    async movePath(source, target) {
      runtime.moves.push([normalize(source), normalize(target)])
      moveTree(source, target)
    },
    async copyDir(source, target) {
      for (const [path, item] of Object.entries(items)) {
        if (path === normalize(source) || path.startsWith(`${normalize(source)}/`)) {
          const next = normalize(target) + path.slice(normalize(source).length)
          items[next] = { ...item }
        }
      }
    },
    async removePath(path, options) {
      runtime.removes.push([normalize(path), options?.trash ? "trash" : "delete"])
      for (const key of Object.keys(items)) if (key === normalize(path) || key.startsWith(`${normalize(path)}/`)) delete items[key]
    },
    join: (...parts) => normalize(parts.filter(Boolean).join("/")),
    dirname,
    basename,
    resolve: normalize,
  }

  function ensureDir(path: string) {
    const normalized = normalize(path)
    if (items[normalized]) return
    ensureDir(dirname(normalized))
    items[normalized] = dirItem()
  }

  function moveTree(source: string, target: string) {
    const from = normalize(source)
    const to = normalize(target)
    const copies: Array<[string, MemoryItem]> = []
    for (const [path, item] of Object.entries(items)) {
      if (path === from || path.startsWith(`${from}/`)) copies.push([to + path.slice(from.length), { ...item }])
    }
    for (const key of Object.keys(items)) if (key === from || key.startsWith(`${from}/`)) delete items[key]
    for (const [path, item] of copies) items[path] = item
  }

  return runtime
}

function project(title: string, type: string, contentrating: string) {
  return { title, type, contentrating, description: "demo", tags: ["Demo"], file: "scene.mp4", preview: "preview.jpg" }
}

function dirItem(): MemoryItem {
  return { type: "dir", size: 0, createdMs: 1_700_000_000_000, modifiedMs: 1_700_000_000_000 }
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
