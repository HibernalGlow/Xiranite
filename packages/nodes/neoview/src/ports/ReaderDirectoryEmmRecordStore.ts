export interface ReaderDirectoryEmmRecord {
  ratingData?: string
  emmJson?: string
}

export interface ReaderDirectoryEmmRecordStore {
  readonly directoryEmmAvailable: boolean
  readDirectoryEmmRecords(
    paths: readonly string[],
    signal?: AbortSignal,
  ): Promise<ReadonlyMap<string, ReaderDirectoryEmmRecord>>
}
