import type { ArchiveThumbnail, ArchiveThumbnailOptions, ArcThumbInfo } from "@xiranite/arcthumb-native"
import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"

export type ArcThumbAction = "inspect" | "render"
export type ArcThumbFormat = NonNullable<ArchiveThumbnailOptions["format"]>
export interface ArcThumbInput { action?: ArcThumbAction; paths?: string[]; listText?: string; recursive?: boolean; maxDimension?: number; format?: ArcThumbFormat; quality?: number; sortOrder?: ArchiveThumbnailOptions["sortOrder"]; coverMode?: ArchiveThumbnailOptions["coverMode"]; outputDir?: string; write?: boolean; overwrite?: boolean }
export interface ArcThumbItem { path: string; status: "ready" | "written" | "skipped" | "error"; width?: number; height?: number; bytes?: number; sourceName?: string; contentKind?: string; mimeType?: string; outputPath?: string; previewDataUrl?: string; reason?: string }
export interface ArcThumbData { info: ArcThumbInfo; items: ArcThumbItem[]; readyCount: number; writtenCount: number; skippedCount: number; errorCount: number }
export type ArcThumbResult = NodeRunResult<ArcThumbData>
export interface ArcThumbRuntime {
  info: () => ArcThumbInfo
  createArchiveThumbnail: (options: ArchiveThumbnailOptions) => Promise<ArchiveThumbnail>
  pathInfo: (path: string) => Promise<{ path: string; exists: boolean; isFile: boolean; isDirectory: boolean }>
  listDir: (path: string) => Promise<Array<{ path: string; isFile: boolean; isDirectory: boolean }>>
  writeFile: (path: string, data: Uint8Array) => Promise<void>
  mkdir: (path: string) => Promise<void>
  dirname: (path: string) => string; basename: (path: string) => string; extname: (path: string) => string; join: (...parts: string[]) => string
}

const MAX_PREVIEW_BYTES = 512 * 1024
const formats = new Set([".zip", ".cbz", ".rar", ".cbr", ".7z", ".cb7", ".cbt", ".epub", ".fb2", ".mobi", ".azw", ".azw3"])

export function normalizeArcThumbInput(input: ArcThumbInput): Required<ArcThumbInput> {
  const paths = [...new Set([...(input.paths ?? []), ...String(input.listText ?? "").split(/[\r\n;]+/)].map((path) => path.trim()).filter(Boolean))]
  return { action: input.action ?? "inspect", paths, listText: input.listText ?? "", recursive: input.recursive ?? true, maxDimension: bounded(input.maxDimension, 512, 16, 4096), format: input.format ?? "webp", quality: bounded(input.quality, 85, 1, 100), sortOrder: input.sortOrder ?? "natural", coverMode: input.coverMode ?? "prefer", outputDir: String(input.outputDir ?? "").trim(), write: input.write ?? false, overwrite: input.overwrite ?? false }
}

export async function runArcThumb(input: ArcThumbInput, runtime: ArcThumbRuntime, onEvent: (event: NodeRunEvent) => void = () => {}): Promise<ArcThumbResult> {
  const options = normalizeArcThumbInput(input)
  const info = runtime.info()
  if (!options.paths.length) return failure("At least one archive or ebook path is required.", info)
  const paths = await collectPaths(options.paths, options.recursive, runtime)
  const items: ArcThumbItem[] = []
  for (const [index, path] of paths.entries()) {
    onEvent({ type: "progress", progress: Math.round(index / Math.max(paths.length, 1) * 100), message: `Rendering ${runtime.basename(path)}.` })
    if (!isArcThumbInput(path, runtime)) { items.push({ path, status: "skipped", reason: "unsupported_extension" }); continue }
    try {
      const thumbnail = await runtime.createArchiveThumbnail({ path, maxDimension: options.maxDimension, format: options.format, quality: options.quality, sortOrder: options.sortOrder, coverMode: options.coverMode })
      const outputPath = outputFor(path, options, runtime)
      const item: ArcThumbItem = { path, status: "ready", width: thumbnail.width, height: thumbnail.height, bytes: thumbnail.data.length, sourceName: thumbnail.sourceName, contentKind: thumbnail.contentKind, mimeType: thumbnail.mimeType, outputPath, previewDataUrl: thumbnail.data.length <= MAX_PREVIEW_BYTES ? `data:${thumbnail.mimeType};base64,${thumbnail.data.toString("base64")}` : undefined }
      if (options.action === "render" && options.write) {
        const target = outputPath!
        const existing = await runtime.pathInfo(target)
        if (existing.exists && !options.overwrite) item.status = "skipped", item.reason = "target_exists"
        else { await runtime.mkdir(runtime.dirname(target)); await runtime.writeFile(target, thumbnail.data); item.status = "written" }
      }
      items.push(item)
    } catch (error) { items.push({ path, status: "error", reason: error instanceof Error ? error.message : String(error) }) }
  }
  onEvent({ type: "progress", progress: 100, message: "ArcThumb complete." })
  const data = summarize(info, items)
  return { success: data.errorCount === 0, message: `ArcThumb processed ${items.length} item(s).`, data }
}

async function collectPaths(paths: string[], recursive: boolean, runtime: ArcThumbRuntime): Promise<string[]> {
  const result: string[] = []
  for (const path of paths) { const info = await runtime.pathInfo(path); if (info.isFile || !info.exists) result.push(info.path); else if (info.isDirectory) for (const child of await runtime.listDir(info.path)) { if (child.isFile) result.push(child.path); else if (recursive) result.push(...await collectPaths([child.path], true, runtime)) } }
  return [...new Set(result)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))
}
function isArcThumbInput(path: string, runtime: Pick<ArcThumbRuntime, "extname">) { return formats.has(runtime.extname(path).toLowerCase()) }
function outputFor(path: string, input: Required<ArcThumbInput>, runtime: Pick<ArcThumbRuntime, "basename" | "dirname" | "extname" | "join">) { const name = runtime.basename(path); const stem = name.slice(0, Math.max(0, name.length - runtime.extname(name).length)); return runtime.join(input.outputDir || runtime.dirname(path), `${stem}.cover.${input.format === "jpeg" ? "jpg" : input.format}`) }
function summarize(info: ArcThumbInfo, items: ArcThumbItem[]): ArcThumbData { return { info, items, readyCount: items.filter((item) => item.status === "ready").length, writtenCount: items.filter((item) => item.status === "written").length, skippedCount: items.filter((item) => item.status === "skipped").length, errorCount: items.filter((item) => item.status === "error").length } }
function failure(message: string, info: ArcThumbInfo): ArcThumbResult { return { success: false, message, data: summarize(info, [{ path: "", status: "error", reason: message }]) } }
function bounded(value: unknown, fallback: number, min: number, max: number) { const result = Number(value); return Number.isFinite(result) ? Math.max(min, Math.min(max, Math.round(result))) : fallback }
