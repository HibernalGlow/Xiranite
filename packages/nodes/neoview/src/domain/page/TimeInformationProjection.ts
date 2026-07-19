import type { ReaderPageTimeSource } from "./page.js"

export type ReaderTimeInformationLanguage = "en" | "zh"

export interface ReaderTimeInformationProjection {
  createdText: string
  modifiedText: string
  accessedText: string
  sourceLabel: string
}

export interface ReaderTimeInformationInput {
  source?: ReaderPageTimeSource | "book-source"
  createdAtMs?: number
  modifiedAtMs?: number
  accessedAtMs?: number
}

export function resolveReaderTimeInformation(
  page: ReaderTimeInformationInput | undefined,
  book: ReaderTimeInformationInput | undefined,
): ReaderTimeInformationInput | undefined {
  if (page && hasReaderTimeInformation(page)) return page
  if (!book) return page
  return { ...book, source: "book-source" }
}

export function projectReaderTimeInformation(
  timestamps: ReaderTimeInformationInput | undefined,
  language: ReaderTimeInformationLanguage = "zh",
): ReaderTimeInformationProjection {
  return {
    createdText: formatReaderTimestamp(timestamps?.createdAtMs, language),
    modifiedText: formatReaderTimestamp(timestamps?.modifiedAtMs, language),
    accessedText: formatReaderTimestamp(timestamps?.accessedAtMs, language),
    sourceLabel: timeSourceLabel(timestamps?.source, language),
  }
}

export function formatReaderTimestamp(value: number | undefined, language: ReaderTimeInformationLanguage = "zh"): string {
  if (!Number.isFinite(value)) return "—"
  const date = new Date(value!)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleString(language === "zh" ? "zh-CN" : "en-US")
}

function hasReaderTimeInformation(value: ReaderTimeInformationInput): boolean {
  return value.source !== undefined
    || value.createdAtMs !== undefined
    || value.modifiedAtMs !== undefined
    || value.accessedAtMs !== undefined
}

function timeSourceLabel(source: ReaderTimeInformationInput["source"], language: ReaderTimeInformationLanguage): string {
  if (language === "zh") {
    if (source === "filesystem") return "文件系统"
    if (source === "archive-entry") return "压缩包条目"
    if (source === "book-source") return "书籍源文件"
    return "未知"
  }
  if (source === "filesystem") return "File system"
  if (source === "archive-entry") return "Archive entry"
  if (source === "book-source") return "Book source"
  return "Unknown"
}
