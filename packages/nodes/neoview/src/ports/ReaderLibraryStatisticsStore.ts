export interface ReaderLibraryStatistics {
  recentCount: number
  bookmarkCount: number
  bookmarkListCount: number
  mediaProgressCount: number
}

/** Bounded aggregate view of the Reader library; it must not enumerate records. */
export interface ReaderLibraryStatisticsStore {
  getLibraryStatistics(): Promise<ReaderLibraryStatistics>
}
