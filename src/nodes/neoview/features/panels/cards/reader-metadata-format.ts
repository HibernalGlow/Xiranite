export function formatBytes(bytes?: number): string {
  if (bytes === undefined) return "-"
  if (bytes < 1_024) return `${bytes} B`
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`
  if (bytes < 1_073_741_824) return `${(bytes / 1_048_576).toFixed(2)} MB`
  return `${(bytes / 1_073_741_824).toFixed(2)} GB`
}

export function formatStorageBytes(bytes?: number): string {
  if (bytes === undefined || !Number.isSafeInteger(bytes) || bytes < 0) return "—"
  if (bytes < 1_024) return `${bytes} B`
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(2)} KB`
  if (bytes < 1_073_741_824) return `${(bytes / 1_048_576).toFixed(2)} MB`
  return `${(bytes / 1_073_741_824).toFixed(2)} GB`
}

export function formatDate(timestamp?: number): string {
  if (timestamp === undefined || !Number.isFinite(timestamp)) return "—"
  const date = new Date(timestamp)
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("zh-CN")
}

export function formatTimeSource(source?: "filesystem" | "archive-entry" | "book-source"): string {
  if (source === "filesystem") return "文件系统"
  if (source === "archive-entry") return "压缩包条目"
  if (source === "book-source") return "书籍源文件"
  return "未知"
}

export function formatSourceKind(kind: string): string {
  if (kind === "directory") return "文件夹"
  if (kind === "archive") return "压缩包"
  if (kind === "document") return "文档"
  if (kind === "media") return "媒体"
  if (kind === "image") return "图片"
  return kind
}

export function formatMediaKind(kind: string): string {
  if (kind === "video") return "视频"
  if (kind === "animated-image") return "动态图"
  if (kind === "document-page") return "文档页"
  return "图片"
}
