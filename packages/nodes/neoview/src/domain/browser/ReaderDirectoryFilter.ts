export const READER_DIRECTORY_FILTERS = ["all", "archive", "directory", "video"] as const
export type ReaderDirectoryFilter = typeof READER_DIRECTORY_FILTERS[number]
export type ReaderDirectoryEntryType = Exclude<ReaderDirectoryFilter, "all"> | "other"

export function readerDirectoryEntryMatchesFilter(
  type: ReaderDirectoryEntryType,
  filter: ReaderDirectoryFilter,
): boolean {
  return filter === "all" || type === filter
}

export function assertReaderDirectoryFilter(value: string): asserts value is ReaderDirectoryFilter {
  if (!(READER_DIRECTORY_FILTERS as readonly string[]).includes(value)) {
    throw new Error(`Reader directory filter is invalid: ${value}`)
  }
}
