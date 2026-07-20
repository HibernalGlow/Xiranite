export const READER_DIRECTORY_ENTRY_KINDS = ["directory", "archive", "video", "image", "other"] as const
export type ReaderDirectoryEntryKind = typeof READER_DIRECTORY_ENTRY_KINDS[number]

/** Coarse listing filters. `library` hides non-reader "other" files such as JSON. */
export const READER_DIRECTORY_FILTERS = [
  "all",
  "library",
  "archive",
  "directory",
  "video",
  "image",
  "other",
] as const
export type ReaderDirectoryFilter = typeof READER_DIRECTORY_FILTERS[number]
export type ReaderDirectoryEntryType = ReaderDirectoryEntryKind

const LIBRARY_KINDS = new Set<ReaderDirectoryEntryKind>(["directory", "archive", "video", "image"])

export function readerDirectoryEntryMatchesFilter(
  type: ReaderDirectoryEntryType,
  filter: ReaderDirectoryFilter,
): boolean {
  if (filter === "all") return true
  if (filter === "library") return LIBRARY_KINDS.has(type)
  return type === filter
}

export function assertReaderDirectoryFilter(value: string): asserts value is ReaderDirectoryFilter {
  if (!(READER_DIRECTORY_FILTERS as readonly string[]).includes(value)) {
    throw new Error(`Reader directory filter is invalid: ${value}`)
  }
}

export function readerDirectoryFilterLabel(filter: ReaderDirectoryFilter): string {
  switch (filter) {
    case "all":
      return "全部类型"
    case "library":
      return "可读内容"
    case "archive":
      return "压缩包"
    case "directory":
      return "文件夹"
    case "video":
      return "视频"
    case "image":
      return "图片"
    case "other":
      return "其它文件"
  }
}

export function readerDirectoryFilterHint(filter: ReaderDirectoryFilter): string {
  switch (filter) {
    case "all":
      return "包含 JSON 等其它文件"
    case "library":
      return "文件夹 · 压缩包 · 视频 · 图片"
    case "archive":
      return "cbz / zip / rar / 7z 等"
    case "directory":
      return "仅显示子目录"
    case "video":
      return "mp4 / mkv / webm 等"
    case "image":
      return "jpg / png / webp / jxl 等"
    case "other":
      return "JSON · txt · 配置等"
  }
}
