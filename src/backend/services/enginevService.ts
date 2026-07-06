import type { Service, ServiceContext } from "."
import type {
  EngineVExportInput,
  EngineVFilterInput,
  EngineVRenameInput,
  EngineVRenameResult,
  EngineVScanResult,
  Result,
  WallpaperDTO,
} from "../shared/types"

export interface EngineVScanInput {
  workshopPath: string
  maxWorkers?: number
}

export class EngineVService implements Service<"enginev"> {
  readonly name = "enginev"
  private readonly ctx: ServiceContext

  constructor(ctx: ServiceContext) {
    this.ctx = ctx
  }

  async scan(input: EngineVScanInput): Promise<Result<EngineVScanResult>> {
    try {
      const { workshopPath } = input
      if (!workshopPath) {
        return { success: false, message: "workshopPath required" }
      }

      const exists = await this.ctx.runtime.fs.exists(workshopPath)
      if (!exists) {
        return {
          success: true,
          message: `[mock] scanned ${workshopPath}`,
          data: mockScan(workshopPath),
        }
      }

      const entries = await this.ctx.runtime.fs.listDir(workshopPath)
      const wallpapers: WallpaperDTO[] = []

      for (const entry of entries) {
        if (!entry.isDirectory) continue

        const projectJsonPath = `${entry.path}/project.json`
        if (!(await this.ctx.runtime.fs.exists(projectJsonPath))) continue

        try {
          const raw = await this.ctx.runtime.fs.readFileText(projectJsonPath)
          const meta = JSON.parse(raw)
          wallpapers.push({
            workshopId: String(meta.workshopid ?? meta.id ?? entry.name),
            title: String(meta.title ?? entry.name),
            description: meta.description,
            type: String(meta.type ?? "Unknown"),
            contentRating: meta.contentrating?.tags?.join(", ") ?? meta.contentrating,
            folderName: entry.name,
            sizeBytes: entry.sizeBytes,
            lastModified: entry.lastModified,
          })
        } catch {
          // Skip unreadable or invalid project.json files.
        }
      }

      const result = aggregateStats(wallpapers)
      return { success: true, message: `scanned ${wallpapers.length} items`, data: result }
    } catch (error) {
      return { success: false, message: "scan failed", error: String(error) }
    }
  }

  async filter(input: EngineVFilterInput): Promise<Result<WallpaperDTO[]>> {
    const { wallpapers, filters } = input
    const filtered = wallpapers.filter((wallpaper) => {
      if (filters.type?.length && !filters.type.includes(wallpaper.type)) return false
      if (filters.contentRating?.length && !filters.contentRating.includes(wallpaper.contentRating ?? "")) return false
      if (filters.titleContains && !wallpaper.title.toLowerCase().includes(filters.titleContains.toLowerCase())) return false
      if (filters.minSize != null && wallpaper.sizeBytes < filters.minSize) return false
      if (filters.maxSize != null && wallpaper.sizeBytes > filters.maxSize) return false
      return true
    })
    return { success: true, message: `filtered ${filtered.length}/${wallpapers.length}`, data: filtered }
  }

  async rename(
    input: EngineVRenameInput,
    workshopPath: string,
  ): Promise<Result<EngineVRenameResult>> {
    const { wallpapers, template, dryRun, copyMode, targetPath } = input
    const results: EngineVRenameResult["results"] = []

    for (const wallpaper of wallpapers) {
      const newName = renderTemplate(template, wallpaper)
      if (dryRun) {
        results.push({ workshopId: wallpaper.workshopId, oldName: wallpaper.folderName, newName, status: "planned" })
        continue
      }

      try {
        const oldPath = `${workshopPath}/${wallpaper.folderName}`
        const newPath = targetPath ? `${targetPath}/${newName}` : `${workshopPath}/${newName}`
        if (copyMode && targetPath) {
          results.push({ workshopId: wallpaper.workshopId, oldName: wallpaper.folderName, newName, status: "copied" })
        } else {
          await this.ctx.runtime.fs.rename(oldPath, newPath)
          results.push({ workshopId: wallpaper.workshopId, oldName: wallpaper.folderName, newName, status: "renamed" })
        }
      } catch (error) {
        results.push({
          workshopId: wallpaper.workshopId,
          oldName: wallpaper.folderName,
          newName,
          status: "error",
          error: String(error),
        })
      }
    }

    const successCount = results.filter((result) => result.status !== "error").length
    const failedCount = results.length - successCount
    return {
      success: true,
      message: `renamed ${successCount}, failed ${failedCount}`,
      data: { results, successCount, failedCount },
    }
  }

  async delete(
    wallpapers: WallpaperDTO[],
    workshopPath: string,
    opts: { dryRun?: boolean; permanent?: boolean } = {},
  ): Promise<Result<EngineVRenameResult>> {
    const results: EngineVRenameResult["results"] = []

    for (const wallpaper of wallpapers) {
      const path = `${workshopPath}/${wallpaper.folderName}`
      if (opts.dryRun) {
        results.push({ workshopId: wallpaper.workshopId, oldName: wallpaper.folderName, newName: "", status: "planned" })
        continue
      }

      try {
        await this.ctx.runtime.fs.remove(path, { permanent: opts.permanent })
        results.push({ workshopId: wallpaper.workshopId, oldName: wallpaper.folderName, newName: "", status: "renamed" })
      } catch (error) {
        results.push({
          workshopId: wallpaper.workshopId,
          oldName: wallpaper.folderName,
          newName: "",
          status: "error",
          error: String(error),
        })
      }
    }

    const successCount = results.filter((result) => result.status !== "error").length
    const failedCount = results.length - successCount
    return {
      success: true,
      message: `deleted ${successCount}, failed ${failedCount}`,
      data: { results, successCount, failedCount },
    }
  }

  async export(input: EngineVExportInput): Promise<Result<{ path: string; count: number }>> {
    const { wallpapers, format, exportPath } = input
    const content = format === "json"
      ? JSON.stringify(wallpapers, null, 2)
      : wallpapers.map((wallpaper) => wallpaper.folderName).join("\n")

    try {
      await this.ctx.runtime.fs.writeFile(exportPath, content)
      return {
        success: true,
        message: `exported ${wallpapers.length} items`,
        data: { path: exportPath, count: wallpapers.length },
      }
    } catch (error) {
      return { success: false, message: "export failed", error: String(error) }
    }
  }
}

function aggregateStats(wallpapers: WallpaperDTO[]): EngineVScanResult {
  const typeStats: Record<string, number> = {}
  const ratingStats: Record<string, number> = {}

  for (const wallpaper of wallpapers) {
    typeStats[wallpaper.type] = (typeStats[wallpaper.type] ?? 0) + 1
    if (wallpaper.contentRating) {
      ratingStats[wallpaper.contentRating] = (ratingStats[wallpaper.contentRating] ?? 0) + 1
    }
  }

  return {
    wallpapers,
    totalCount: wallpapers.length,
    typeStats,
    ratingStats,
  }
}

function renderTemplate(template: string, wallpaper: WallpaperDTO): string {
  return template
    .replace(/\{id\}/g, wallpaper.workshopId)
    .replace(/\{original_name\}/g, wallpaper.folderName)
    .replace(/\{title\}/g, wallpaper.title.slice(0, 60))
}

function mockScan(workshopPath: string): EngineVScanResult {
  const types = ["Scene", "Video", "Web", "Application"]
  const ratings = ["Everyone", "Questionable", "Mature"]
  const wallpapers: WallpaperDTO[] = Array.from({ length: 12 }).map((_, index) => ({
    workshopId: `${1000000 + index}`,
    title: `Wallpaper ${index + 1}`,
    description: `Mock wallpaper from ${workshopPath}`,
    type: types[index % types.length],
    contentRating: ratings[index % ratings.length],
    folderName: `${1000000 + index}_${index + 1}`,
    sizeBytes: 50_000_000 + index * 7_000_000,
    lastModified: Date.now() - index * 86400_000,
  }))
  return aggregateStats(wallpapers)
}
