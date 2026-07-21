export type ReaderEmmRawFieldType = "string" | "number" | "boolean" | "bytes" | "datetime" | "timestamp" | "path" | "url"

export interface ReaderEmmRawField {
  key: string
  type: ReaderEmmRawFieldType
  value: string | number | boolean
}

export interface ReaderDirectoryEmmRecord {
  ratingData?: string
  emmJson?: string
  manualTags?: string
  rawFields?: readonly ReaderEmmRawField[]
}

export interface ReaderDirectoryEmmReadOptions {
  includeRaw?: boolean
}

export interface ReaderDirectoryEmmRecordStore {
  readonly directoryEmmAvailable: boolean
  readDirectoryEmmRecords(
    paths: readonly string[],
    signal?: AbortSignal,
    options?: ReaderDirectoryEmmReadOptions,
  ): Promise<ReadonlyMap<string, ReaderDirectoryEmmRecord>>
}
