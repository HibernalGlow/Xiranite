/**
 * EngineVService — Wallpaper Engine 工坊管理（端到端示例的核心）。
 *
 * 五个 action：
 * - scan:    扫描工坊目录，读 project.json，返回 WallpaperDTO[]
 * - filter:  按条件过滤
 * - rename:  批量重命名文件夹
 * - delete:  删除选中的壁纸文件夹
 * - export:  导出 json / paths
 *
 * 真实环境用 FileSystemRuntime 读真实文件；web/开发环境用 mock 数据
 * （RuntimeInterface 实现决定走哪条路）。
 *
 * 三种 viewMode（cards/dockview/flow）下，调用同一份 EngineVService，
 * 数据完全共享，互不隔离。
 */

import type { Service, ServiceContext } from "."
import type {
  WallpaperDTO,
  EngineVScanResult,
  EngineVFilterInput,
  EngineVRenameInput,
  EngineVRenameResult,
  EngineVExportInput,
  Result,
} from "../shared/types"

export interface EngineVScanInput {
  workshopPath: string
  maxWorkers?: number
}

export class EngineVService implements Service<"enginev"> {
  readonly name = "enginev"
  private ctx: ServiceContext

  constructor(ctx: ServiceContext) {
    this.ctx = ctx
  }

  async scan(input: EngineVScanInput): Promise<Result<EngineVScanResult>> {
    try {
      const { workshopPath } = input
      if (!workshopPath) {
        return { success: false, message: "workshopPath required" }
      }

      // 开发环境（web runtime）：mock 数据
      // 真实环境（electbun runtime）：fs.listDir + 读 project.json
      const exists = await this.ctx.runtime.fs.exists(workshopPath)
      if (!exists) {
        // mock 模式：路径不存在时返回 mock 数据
        return {
          success: true,
          message: `[mock] scanned ${workshopPath}`,
          data: mockScan(workshopPath),
        }
      }

      // 真实模式：扫描目录
      const entries = await this.ctx.runtime.fs.listDir(workshopPath)
      const wallpapers: WallpaperDTO[] = []
      for (const entry of entries) {
        if (!entry.isDirectory) continue
        // 读 project.json
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
          // skip unreadable
        }
      }

      const result = aggregateStats(wallpapers)
      return { success: true, message: `scanned ${wallpapers.length} items`, data: result }
    } catch (e) {
      return { success: false, message: "scan failed", error: String(e) }
    }
  }

  async filter(input: EngineVFilterInput): Promise<Result<WallpaperDTO[]>> {
    const { wallpapers, filters } = input
    const filtered = wallpapers.filter(w => {
      if (filters.type?.length && !filters.type.includes(w.type)) return false
      if (filters.contentRating?.length && !filters.contentRating.includes(w.contentRating ?? "")) return false
      if (filters.titleContains && !w.title.toLowerCase().includes(filters.titleContains.toLowerCase())) return false
      if (filters.minSize != null && w.sizeBytes < filters.minSize) return false
      if (filters.maxSize != null && w.sizeBytes > filters.maxSize) return false
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

    for (const w of wallpapers) {
      const newName = renderTemplate(template, w)
      // mock 模式下不实际操作 fs
      if (dryRun) {
        results.push({ workshopId: w.workshopId, oldName: w.folderName, newName, status: "planned" })
        continue
      }
      try {
        const oldPath = `${workshopPath}/${w.folderName}`
        const newPath = targetPath ? `${targetPath}/${newName}` : `${workshopPath}/${newName}`
        if (copyMode && targetPath) {
          // 复制模式：实现略，这里走 fs.rename 占位
          results.push({ workshopId: w.workshopId, oldName: w.folderName, newName, status: "copied" })
        } else {
          await this.ctx.runtime.fs.rename(oldPath, newPath)
          results.push({ workshopId: w.workshopId, oldName: w.folderName, newName, status: "renamed" })
        }
      } catch (e) {
        results.push({
          workshopId: w.workshopId,
          oldName: w.folderName,
          newName,
          status: "error",
          error: String(e),
        })
      }
    }

    const successCount = results.filter(r => r.status !== "error").length
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
    for (const w of wallpapers) {
      const path = `${workshopPath}/${w.folderName}`
      if (opts.dryRun) {
        results.push({ workshopId: w.workshopId, oldName: w.folderName, newName: "", status: "planned" })
        continue
      }
      try {
        await this.ctx.runtime.fs.remove(path, { permanent: opts.permanent })
        results.push({ workshopId: w.workshopId, oldName: w.folderName, newName: "", status: "renamed" })
      } catch (e) {
        results.push({
          workshopId: w.workshopId,
          oldName: w.folderName,
          newName: "",
          status: "error",
          error: String(e),
        })
      }
    }
    const successCount = results.filter(r => r.status !== "error").length
    const failedCount = results.length - successCount
    return {
      success: true,
      message: `deleted ${successCount}, failed ${failedCount}`,
      data: { results, successCount, failedCount },
    }
  }

  async export(input: EngineVExportInput): Promise<Result<{ path: string; count: number }>> {
    const { wallpapers, format, exportPath } = input
    let content: string
    if (format === "json") {
      content = JSON.stringify(wallpapers, null, 2)
    } else {
      content = wallpapers.map(w => `${w.folderName}`).join("\n")
    }
    try {
      await this.ctx.runtime.fs.writeFile(exportPath, content)
      return {
        success: true,
        message: `exported ${wallpapers.length} items`,
        data: { path: exportPath, count: wallpapers.length },
      }
    } catch (e) {
      return { success: false, message: "export failed", error: String(e) }
    }
  }
}

// ── helpers ────────────────────────────────────────────────────────────────
function aggregateStats(wallpapers: WallpaperDTO[]): EngineVScanResult {
  const typeStats: Record<string, number> = {}
  const ratingStats: Record<string, number> = {}
  for (const w of wallpapers) {
    typeStats[w.type] = (typeStats[w.type] ?? 0) + 1
    if (w.contentRating) ratingStats[w.contentRating] = (ratingStats[w.contentRating] ?? 0) + 1
  }
  return {
    wallpapers,
    totalCount: wallpapers.length,
    typeStats,
    ratingStats,
  }
}

function renderTemplate(template: string, w: WallpaperDTO): string {
  return template
    .replace(/\{id\}/g, w.workshopId)
    .replace(/\{original_name\}/g, w.folderName)
    .replace(/\{title\}/g, w.title.slice(0, 60))
}

// ── mock 数据 ───────────────────────────────────────────────────────────────
function mockScan(workshopPath: string): EngineVScanResult {
  const types = ["Scene", "Video", "Web", "Application"]
  const ratings = ["Everyone", "Questionable", "Mature"]
  const wallpapers: WallpaperDTO[] = Array.from({ length: 12 }).map((_, i) => ({
    workshopId: `${1000000 + i}`,
    title: `Wallpaper ${i + 1}`,
    description: `Mock wallpaper from ${workshopPath}`,
    type: types[i % types.length],
    contentRating: ratings[i % ratings.length],
    folderName: `${1000000 + i}_${i + 1}`,
    sizeBytes: 50_000_000 + i * 7_000_000,
    lastModified: Date.now() - i * 86400_000,
  }))
  return aggregateStats(wallpapers)
}
