export type ReaderBookInformationLanguage = "en" | "zh"

export interface ReaderBookInformationInput {
  displayName: string
  translatedTitle?: string
  sourceKind?: "directory" | "archive" | "document" | "media" | "image" | "path"
  sourceFormat?: string
  currentPage: number
  pageCount: number
}

export interface ReaderBookInformationProjection {
  displayTitle: string
  originalTitle?: string
  typeLabel: string
  currentPage: number
  pageCount: number
  pageText: string
  progressPercent?: number
  progressText: string
}

export function projectReaderBookInformation(
  input: ReaderBookInformationInput,
  language: ReaderBookInformationLanguage = "zh",
): ReaderBookInformationProjection {
  const displayName = input.displayName.trim() || (language === "zh" ? "未命名" : "Untitled")
  const translatedTitle = input.translatedTitle?.trim()
  const displayTitle = translatedTitle || displayName
  const originalTitle = translatedTitle && translatedTitle !== displayName ? displayName : undefined
  const pageCount = boundedInteger(input.pageCount, 0, Number.MAX_SAFE_INTEGER)
  const currentPage = pageCount > 0 ? boundedInteger(input.currentPage, 1, pageCount) : 0
  const progressPercent = pageCount > 0 ? currentPage / pageCount * 100 : undefined
  return {
    displayTitle,
    originalTitle,
    typeLabel: bookTypeLabel(input.sourceKind, input.sourceFormat, language),
    currentPage,
    pageCount,
    pageText: `${currentPage} / ${pageCount}`,
    progressPercent,
    progressText: progressPercent === undefined ? "—" : `${progressPercent.toFixed(1)}%`,
  }
}

function bookTypeLabel(kind: ReaderBookInformationInput["sourceKind"], format: string | undefined, language: ReaderBookInformationLanguage): string {
  const normalizedFormat = format?.trim().toLowerCase()
  if (kind === "document" && normalizedFormat === "pdf") return "PDF"
  if (kind === "document" && normalizedFormat === "epub") return "EPUB"
  if (language === "zh") {
    if (kind === "directory") return "文件夹"
    if (kind === "archive") return "压缩包"
    if (kind === "document") return "文档"
    if (kind === "media") return "媒体"
    if (kind === "image") return "图片"
    if (kind === "path") return "文件"
    return "未知"
  }
  if (kind === "directory") return "Folder"
  if (kind === "archive") return "Archive"
  if (kind === "document") return "Document"
  if (kind === "media") return "Media"
  if (kind === "image") return "Image"
  if (kind === "path") return "File"
  return "Unknown"
}

function boundedInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)))
}
